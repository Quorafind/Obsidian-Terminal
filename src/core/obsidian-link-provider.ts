import { App, WorkspaceLeaf, HoverParent, debounce } from "obsidian";
import { HoverPopover } from "obsidian";
import type { Terminal as XTerminal, ILinkProvider, ILink } from "@xterm/xterm";

/**
 * Obsidian internal link pattern: [[filename]], [[filename#heading]], [[filename|alias]], [[filename#heading|alias]]
 */
const OBSIDIAN_LINK_REGEX = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/**
 * Interface for parsed Obsidian link
 */
export interface ObsidianLink {
	fullMatch: string;
	filename: string;
	heading?: string;
	alias?: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Parse Obsidian links from a text string
 */
export function parseObsidianLinks(text: string): ObsidianLink[] {
	const links: ObsidianLink[] = [];
	let match: RegExpExecArray | null;

	OBSIDIAN_LINK_REGEX.lastIndex = 0;

	while ((match = OBSIDIAN_LINK_REGEX.exec(text)) !== null) {
		links.push({
			fullMatch: match[0],
			filename: match[1].trim(),
			heading: match[2]?.trim(),
			alias: match[3]?.trim(),
			startIndex: match.index,
			endIndex: match.index + match[0].length,
		});
	}

	return links;
}

/**
 * Build link text for Obsidian API
 */
export function buildLinkText(link: ObsidianLink): string {
	let linkText = link.filename;
	if (link.heading) {
		linkText += `#${link.heading}`;
	}
	return linkText;
}

/**
 * Open an Obsidian internal link
 */
export async function openObsidianLink(
	app: App,
	link: ObsidianLink,
	sourcePath?: string,
): Promise<void> {
	const linkText = buildLinkText(link);
	await app.workspace.openLinkText(linkText, sourcePath ?? "", false);
}

/**
 * xterm.js Link Provider for Obsidian internal links (kept for reference)
 */
export class ObsidianLinkProvider implements ILinkProvider {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	provideLinks(
		bufferLineNumber: number,
		callback: (links: ILink[] | undefined) => void,
	): void {
		callback(undefined);
	}

	static createProvider(terminal: XTerminal, app: App): ILinkProvider {
		return {
			provideLinks(
				bufferLineNumber: number,
				callback: (links: ILink[] | undefined) => void,
			): void {
				try {
					const buffer = terminal.buffer.active;
					const line = buffer.getLine(bufferLineNumber);
					if (!line) {
						callback(undefined);
						return;
					}

					const text = line.translateToString(true);
					const parsedLinks = parseObsidianLinks(text);

					if (parsedLinks.length === 0) {
						callback(undefined);
						return;
					}

					const links: ILink[] = parsedLinks.map((link) => ({
						range: {
							start: {
								x: link.startIndex + 1,
								y: bufferLineNumber + 1,
							},
							end: {
								x: link.endIndex + 1,
								y: bufferLineNumber + 1,
							},
						},
						text: link.fullMatch,
						activate: () => {
							openObsidianLink(app, link).catch(console.error);
						},
					}));

					callback(links);
				} catch (error) {
					console.error("Error providing Obsidian links:", error);
					callback(undefined);
				}
			},
		};
	}
}

/**
 * Universal link detector for all terminal renderers
 * Uses Obsidian's native HoverPopover for link preview
 */
export class GhosttyLinkDetector implements HoverParent {
	private app: App;
	private terminal: any;
	private shadowContainer: HTMLElement;
	private leaf: WorkspaceLeaf;
	private currentHoverLink: ObsidianLink | null = null;
	private disposables: Array<() => void> = [];

	// HoverParent interface
	hoverPopover: HoverPopover | null = null;

	constructor(
		app: App,
		terminal: any,
		shadowContainer: HTMLElement,
		leaf: WorkspaceLeaf,
	) {
		this.app = app;
		this.terminal = terminal;
		this.shadowContainer = shadowContainer;
		this.leaf = leaf;
	}

	initialize(): void {
		this.setupEventListeners();
	}

	private setupEventListeners(): void {
		const onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
		const onClick = (e: MouseEvent) => this.handleClick(e);

		this.shadowContainer.addEventListener("mousemove", onMouseMove);
		this.shadowContainer.addEventListener("click", onClick);

		this.disposables.push(() => {
			this.shadowContainer.removeEventListener("mousemove", onMouseMove);
			this.shadowContainer.removeEventListener("click", onClick);
		});
	}

	private handleMouseMove(e: MouseEvent): void {
		const link = this.getLinkAtPosition(e);

		if (link) {
			// Check if we're still on the same link
			if (
				this.currentHoverLink &&
				this.currentHoverLink.fullMatch === link.fullMatch &&
				this.currentHoverLink.startIndex === link.startIndex
			) {
				return;
			}

			this.currentHoverLink = link;
			this.shadowContainer.style.cursor = "pointer";
			this.debounceHoverPopover(link, e.target as HTMLElement, e);
		} else {
			if (this.currentHoverLink) {
				this.currentHoverLink = null;
				this.shadowContainer.style.cursor = "";
			}
		}
	}

	private debounceHoverPopover = debounce(
		(link: ObsidianLink, targetEl: HTMLElement, event: MouseEvent) => {
			this.showHoverPopover(link, targetEl, event);
		},
		300,
	);

	private showHoverPopover(
		link: ObsidianLink,
		targetEl: HTMLElement,
		event: MouseEvent,
	): void {
		const linkText = buildLinkText(link);
		const file = this.app.metadataCache.getFirstLinkpathDest(linkText, "");

		if (file) {
			// Trigger Obsidian's native page preview
			this.app.workspace.trigger("hover-link", {
				event: event,
				source: "terminal",
				hoverParent: this,
				targetEl: undefined,
				linktext: linkText,
				sourcePath: file.path,
			});
		}
	}

	private handleClick(e: MouseEvent): void {
		const isModifierPressed = e.ctrlKey || e.metaKey;
		if (!isModifierPressed) return;

		const link = this.getLinkAtPosition(e);
		if (link) {
			e.preventDefault();
			e.stopPropagation();
			openObsidianLink(this.app, link).catch(console.error);
		}
	}

	private getLinkAtPosition(e: MouseEvent): ObsidianLink | null {
		const coords = this.getTerminalCoords(e);
		if (!coords) return null;

		const { col, row } = coords;
		const lineText = this.getLineText(row);
		if (!lineText) return null;

		const links = parseObsidianLinks(lineText);

		for (const link of links) {
			if (col >= link.startIndex && col < link.endIndex) {
				return link;
			}
		}

		return null;
	}

	private getTerminalCoords(
		e: MouseEvent,
	): { col: number; row: number } | null {
		const rect = this.shadowContainer.getBoundingClientRect();
		const CONTAINER_PADDING = 8;

		const x = e.clientX - rect.left - CONTAINER_PADDING;
		const y = e.clientY - rect.top - CONTAINER_PADDING;

		if (x < 0 || y < 0) return null;

		const cols = this.terminal.cols ?? 80;
		const rows = this.terminal.rows ?? 24;

		const contentWidth = rect.width - CONTAINER_PADDING * 2;
		const contentHeight = rect.height - CONTAINER_PADDING * 2;

		if (contentWidth <= 0 || contentHeight <= 0) return null;

		const cellWidth = contentWidth / cols;
		const cellHeight = contentHeight / rows;

		const col = Math.floor(x / cellWidth);
		const row = Math.floor(y / cellHeight);

		return {
			col: Math.min(col, cols - 1),
			row: Math.min(row, rows - 1),
		};
	}

	private getLineText(row: number): string | null {
		const term = this.terminal as any;

		if (term.buffer?.active) {
			const buffer = term.buffer.active;
			const absoluteRow = buffer.baseY + row;
			const line = buffer.getLine(absoluteRow);
			if (line) {
				return line.translateToString(true);
			}
		}

		// Fallback for Ghostty WASM
		if (term.wasmTerm) {
			const dims = term.wasmTerm.getDimensions();
			const scrollbackLen = term.wasmTerm.getScrollbackLength();

			if (row < scrollbackLen) {
				const cells = term.wasmTerm.getScrollbackLine(row);
				if (cells) return this.cellsToString(cells);
			} else {
				const screenRow = row - scrollbackLen;
				if (screenRow < dims.rows) {
					const cells = term.wasmTerm.getLine(screenRow);
					if (cells) return this.cellsToString(cells);
				}
			}
		}

		return null;
	}

	private cellsToString(cells: any[]): string {
		let str = "";
		for (const cell of cells) {
			if (cell.codepoint > 0) {
				str += String.fromCodePoint(cell.codepoint);
			} else if (cell.width > 0) {
				str += " ";
			}
		}
		return str;
	}

	dispose(): void {
		for (const dispose of this.disposables) {
			dispose();
		}
		this.disposables = [];
	}
}
