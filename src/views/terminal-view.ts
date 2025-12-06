import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import {
	init as initGhostty,
	Terminal as GhosttyTerminal,
	FitAddon as GhosttyFitAddon,
} from "ghostty-web";
import { WorkspaceLeaf, Menu, Scope } from "obsidian";
import {
	GhosttyLinkDetector,
	GhosttyObsidianLinkProvider,
	ObsidianLinkHighlighter,
	ObsidianLinkProvider,
} from "@/core/obsidian-link-provider";
import {
	TerminalView as BaseTerminalView,
	TerminalSession,
	TerminalPluginError,
	TerminalErrorType,
	Terminal,
} from "@/types";
import {
	VIEW_TYPE_TERMINAL,
	TERMINAL_VIEW_DISPLAY_TEXT,
	DEFAULT_TERMINAL_DIMENSIONS,
} from "@/constants";
import type TerminalPlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/settings";

// Import xterm.js CSS as string for Shadow DOM injection
import xtermCss from "@xterm/xterm/css/xterm.css?inline";

// Type alias for FitAddon (xterm.js or ghostty-web)
type FitAddon = XTermFitAddon | GhosttyFitAddon;

// Track Ghostty WASM initialization state
let ghosttyInitialized = false;
let ghosttyInitPromise: Promise<void> | null = null;

/**
 * Reset Ghostty WASM state on plugin unload
 * This allows proper reinitialization on hot reload
 */
export function resetGhosttyState(): void {
	ghosttyInitialized = false;
	ghosttyInitPromise = null;
	shellSessions.clear();
	console.log("✅ Ghostty state reset for hot reload");
}

/**
 * Shadow DOM styles for terminal
 * Uses CSS variables from Obsidian for theming
 */
const shadowStyles = `
/* Import xterm base styles */
${xtermCss}

/* CSS Variables inherited from Obsidian */
:host {
  --terminal-bg: var(--background-secondary, #1e1e1e);
  --terminal-fg: var(--text-normal, #d4d4d4);
  --terminal-cursor: var(--text-accent, #569cd6);
  --terminal-selection: var(--text-selection, rgba(255, 255, 255, 0.3));
}

/* Container styles - Shadow DOM mode */
.terminal-shadow-container {
  height: 100%;
  width: 100%;
  background: var(--terminal-bg);
  padding: 8px;
  box-sizing: border-box;
  overflow: hidden;
}

/* Container styles - Direct DOM mode (WebGL) */
.terminal-direct-container {
  height: 100%;
  width: 100%;
  background: var(--terminal-bg);
  padding: 8px;
  box-sizing: border-box;
  overflow: hidden;
}

/* xterm.js container - 确保完全填充父容器 */
.xterm {
  height: 100% !important;
  width: 100% !important;
}

/* xterm viewport - 确保正确的滚动和背景 */
.xterm-viewport {
  height: 100% !important;
  overflow-y: auto !important;
  background: var(--terminal-bg) !important;
}

.xterm-cursor {
  outline-color: var(--text-accent);
}

/* xterm screen - 确保正确填充 */
.xterm-screen {
  height: 100% !important;
  width: 100% !important;
}

/*
 * IME/中文输入支持：保持 helper-textarea 可访问但不可见
 * xterm.js 会自动根据光标位置更新 textarea 的 left/top
 * 我们只需确保它不遮挡内容且尺寸为 0
 */
.xterm-helper-textarea {
  position: absolute !important;
  /* 尺寸设为 0，完全不遮挡内容 */
  width: 0 !important;
  height: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  border: 0 !important;
  /* 保持可见以支持 IME 定位（opacity: 0 而非 display: none） */
  opacity: 0 !important;
  /* 不设置 left/top，让 xterm.js 动态定位 */
  overflow: hidden !important;
  /* z-index 设为正值，确保 IME 候选框能正常显示 */
  z-index: 10 !important;
  /* 禁止指针事件，避免干扰终端交互 */
  pointer-events: none !important;
}

/* 隐藏字符测量元素 */
.xterm-char-measure-element,
.xterm-width-cache-measure-container {
  position: absolute !important;
  visibility: hidden !important;
  left: -9999px !important;
  top: -9999px !important;
  pointer-events: none !important;
}

/*
 * IME 组合视图样式 - 用于显示中文输入候选
 * 必须保持可见以支持 IME 输入
 */
.xterm .composition-view {
  background: var(--background-modifier-form-field, #2d2d2d) !important;
  color: var(--text-normal, #d4d4d4) !important;
  border: 1px solid var(--background-modifier-border, #444) !important;
  border-radius: 4px !important;
  padding: 2px 6px !important;
  font-family: inherit !important;
  font-size: inherit !important;
  z-index: 100 !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

.xterm .composition-view.active {
  display: block !important;
}

.xterm-dom-renderer-owner-1 .xterm-screen .xterm-rows {
  color: var(--terminal-fg);
}

/*
 * Ghostty IME textarea - invisible but functional for IME input
 * Must remain in DOM for IME composition to work properly
 */
.ghostty-ime-textarea {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  opacity: 0;
  z-index: -5;
  overflow: hidden;
  resize: none;
  border: none;
  outline: none;
  padding: 0;
  margin: 0;
  pointer-events: none;
}

/*
 * Obsidian Link Styles - [[...]] internal links
 * Provides visual feedback for clickable Obsidian links in terminal output
 */

/* xterm.js link hover styles (via registerLinkProvider) */
.xterm-link-layer {
  pointer-events: auto;
}

/* Obsidian link hover overlay for Ghostty */
.obsidian-link-hover {
  position: absolute;
  pointer-events: none;
  background: rgba(var(--color-accent-rgb, 99, 102, 241), 0.15);
  border-bottom: 1px dashed var(--text-accent, #7c3aed);
  border-radius: 2px;
  z-index: 10;
}

/* Tooltip for Obsidian links */
.obsidian-link-tooltip {
  position: absolute;
  background: var(--background-primary, #1e1e1e);
  color: var(--text-normal, #d4d4d4);
  border: 1px solid var(--background-modifier-border, #444);
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  max-width: 300px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.obsidian-link-tooltip::before {
  content: "📄 ";
}

/* Hint text for Ctrl+Click */
.obsidian-link-hint {
  font-size: 10px;
  color: var(--text-muted, #888);
  margin-left: 8px;
}
`;

// Global store for shell sessions to persist across tab switches
const shellSessions = new Map<string, ShellSessionData>();

interface ShellSessionData {
	terminal: Terminal;
	fitAddon: FitAddon;
	shadowRoot: ShadowRoot;
	shadowContainer: HTMLElement;
	isConnected: boolean;
	disposables: Array<{ dispose(): void }>;
}

/**
 * Terminal view implementation using xterm.js with Shadow DOM isolation
 */
export class TerminalView extends BaseTerminalView {
	terminal!: Terminal;
	terminalSession!: TerminalSession;
	terminalViewContainer!: HTMLElement;
	plugin: TerminalPlugin;

	private shadowHost: HTMLElement | null = null;
	private shadowRoot: ShadowRoot | null = null;
	private shadowContainer: HTMLElement | null = null;
	private fitAddon!: FitAddon;
	private webLinksAddon?: WebLinksAddon;
	private searchAddon?: SearchAddon;
	private searchContainer?: HTMLElement;
	private searchInput?: HTMLInputElement;
	private isSearchVisible = false;
	private imeTextarea?: HTMLTextAreaElement;
	private isComposing = false;
	private ghosttyLinkDetector?: GhosttyLinkDetector;
	private linkHighlighter?: ObsidianLinkHighlighter;
	private disposables: Array<{ dispose(): void }> = [];
	private isInitialized = false;
	private isConnected = false;
	private isRestarting = false;
	private initializationState: "idle" | "initializing" | "ready" | "error" =
		"idle";
	private currentTitle = "";
	private shellName = "";
	private keyboardScope: Scope | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		terminalSession: TerminalSession,
		plugin: TerminalPlugin,
	) {
		super(leaf);
		this.terminalSession = terminalSession;
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TERMINAL;
	}

	getDisplayText(): string {
		let title = this.currentTitle.trim();

		// Check if currentTitle is actually the shell executable path (not a useful cwd)
		// PowerShell/cmd often set title to their own path, which is not useful
		const isShellPath =
			title &&
			(title.toLowerCase().includes("powershell") ||
				title.toLowerCase().includes("cmd.exe") ||
				title.toLowerCase().includes("bash") ||
				title.toLowerCase().includes("zsh") ||
				title.toLowerCase().includes("sh.exe"));

		// Priority: meaningful currentTitle > initialCwd > default
		// If currentTitle is just the shell path, prefer initialCwd
		if (!title || isShellPath) {
			if (this.terminalSession?.initialCwd) {
				title = this.terminalSession.initialCwd;
			}
		}

		// Fallback to default
		if (!title) {
			title = TERMINAL_VIEW_DISPLAY_TEXT;
		}

		// Remove Windows "Administrator: " prefix
		title = title.replace(/^Administrator:\s*/i, "");

		// Remove terminal type suffix (e.g., "- xterm-256color", "xterm-256color")
		title = title.replace(/\s*[-:]\s*xterm(-\d+color)?$/i, "");
		title = title.replace(/\s+xterm(-\d+color)?$/i, "");

		// If title looks like a path, extract just the directory name (basename)
		const isPath =
			/^[a-zA-Z]:[\\/]/.test(title) ||
			title.startsWith("/") ||
			title.includes("\\");

		if (isPath) {
			const parts = title
				.split(/[\\/]/)
				.filter((p) => p.trim().length > 0);
			if (parts.length > 0) {
				title = parts[parts.length - 1];
			}
		}

		// Build shell suffix, ensuring it's not a terminal type
		const shell =
			this.shellName && !this.shellName.includes("xterm")
				? `-${this.shellName}`
				: "";

		// Truncate long titles (max 20 chars)
		const MAX_TITLE_LEN = 20;
		let displayTitle = title;
		if (displayTitle.length > MAX_TITLE_LEN) {
			displayTitle = displayTitle.substring(0, MAX_TITLE_LEN) + "...";
		}

		return shell ? `${displayTitle}${shell}` : displayTitle;
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen(): Promise<void> {
		try {
			this.terminalViewContainer = this.contentEl.createDiv({
				cls: "terminal-view-container",
			});

			// Check for existing session
			const sessionKey = this.getSessionKey();
			const existingSession = shellSessions.get(sessionKey);

			if (existingSession) {
				await this.restoreSession(existingSession);
			} else {
				await this.initializeTerminal();
			}

			this.isInitialized = true;
			console.log(
				`Terminal view opened for session ${this.terminalSession.id}`,
			);
		} catch (error) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				"Failed to open terminal view",
				error as Error,
			);
		}
	}

	async onClose(): Promise<void> {
		try {
			// Save session for potential restoration
			this.saveSession();

			console.log(
				`Terminal view closed for session ${this.terminalSession.id}`,
			);
		} catch (error) {
			console.error("Error closing terminal view:", error);
		}
	}

	/**
	 * Called when the view is resized (Obsidian built-in)
	 */
	onResize(): void {
		this.resize();
	}

	/**
	 * Save current session for restoration
	 */
	private saveSession(): void {
		if (!this.shadowRoot || !this.shadowContainer) return;

		const sessionKey = this.getSessionKey();
		shellSessions.set(sessionKey, {
			terminal: this.terminal,
			fitAddon: this.fitAddon,
			shadowRoot: this.shadowRoot,
			shadowContainer: this.shadowContainer,
			isConnected: this.isConnected,
			disposables: this.disposables,
		});
	}

	/**
	 * Resize terminal to fit container
	 */
	resize(): void {
		if (!this.isInitialized || !this.terminal || !this.fitAddon) {
			return;
		}

		// Skip resize when container is not visible (e.g., background tab with display:none)
		// This prevents FitAddon from calculating incorrect dimensions (0x0)
		if (
			this.terminalViewContainer.offsetWidth === 0 ||
			this.terminalViewContainer.offsetHeight === 0
		) {
			return;
		}

		try {
			this.fitAddon.fit();

			// Sync PTY size
			const dims = this.fitAddon.proposeDimensions();
			if (dims) {
				this.terminalSession.ptyProcess.resize(dims.cols, dims.rows);
			}
		} catch (error) {
			console.warn("Failed to resize terminal:", error);
		}
	}

	/**
	 * Check if Ghostty renderer is enabled
	 */
	private get useGhostty(): boolean {
		return this.plugin.settings?.renderer === "ghostty";
	}

	/**
	 * Check if WebGL renderer is enabled
	 */
	private get useWebGL(): boolean {
		return this.plugin.settings?.renderer === "xterm-webgl";
	}

	/**
	 * Initialize the terminal instance with Shadow DOM
	 */
	private async initializeTerminal(): Promise<void> {
		if (this.initializationState !== "idle") {
			console.warn("Terminal already initializing or initialized");
			return;
		}

		this.initializationState = "initializing";

		try {
			// Initialize Ghostty WASM if needed (once per app lifecycle)
			if (this.useGhostty) {
				await this.ensureGhosttyInitialized();
			}

			this.createShadowDOM();
			this.createTerminalInstance();
			this.loadAddons();
			this.openTerminalInShadow();
			this.loadWebglAddon(); // Must be after open() for WebGL context
			this.connectToPTY();

			// Setup IME support for Ghostty mode (must be before setupKeyboardHandlers)
			if (this.useGhostty) {
				this.setupGhosttyIME();
			}

			// Setup Obsidian link detection for all renderers
			this.setupObsidianLinkDetector();

			this.setupKeyboardHandlers();
			this.setupContextMenu();

			// Initial fit after a short delay to ensure DOM is ready
			requestAnimationFrame(() => {
				this.fitAddon.fit();
				// In Ghostty mode, focus IME textarea for keyboard input
				// In xterm.js mode, focus terminal directly
				if (this.useGhostty && this.imeTextarea) {
					this.imeTextarea.focus();
				} else {
					this.terminal.focus();
				}
			});

			this.initializationState = "ready";
			const rendererName = this.useGhostty
				? "Ghostty"
				: this.useWebGL
					? "xterm.js (WebGL)"
					: "xterm.js";
			console.log(
				`✅ Terminal initialization complete (${rendererName})`,
			);
		} catch (error) {
			this.initializationState = "error";
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				"Failed to initialize terminal",
				error as Error,
			);
		}
	}

	/**
	 * Ensure Ghostty WASM is initialized (singleton pattern)
	 */
	private async ensureGhosttyInitialized(): Promise<void> {
		if (ghosttyInitialized) return;

		if (!ghosttyInitPromise) {
			ghosttyInitPromise = initGhostty().then(() => {
				ghosttyInitialized = true;
				console.log("✅ Ghostty WASM initialized");
			});
		}

		await ghosttyInitPromise;
	}

	/**
	 * Update IME textarea position to follow the terminal cursor
	 * Calculates pixel position based on cursor grid coordinates and cell size
	 *
	 * This enables IME candidate window to appear near the cursor position
	 * instead of being fixed at top-left corner.
	 */
	private updateGhosttyImePosition(): void {
		if (
			!this.useGhostty ||
			!this.terminal ||
			!this.imeTextarea ||
			!this.shadowContainer
		) {
			return;
		}

		// Access buffer to get cursor position (xterm.js compatible API)
		const term = this.terminal as any;
		if (!term.buffer?.active) {
			return;
		}

		const buffer = term.buffer.active;
		const cursorX: number = buffer.cursorX ?? 0;
		const cursorY: number = buffer.cursorY ?? 0;

		const cols = this.terminal.cols;
		const rows = this.terminal.rows;

		if (!cols || !rows) {
			return;
		}

		// Container padding defined in shadowStyles (8px)
		const CONTAINER_PADDING = 8;

		// Calculate available content area (excluding padding)
		const contentWidth =
			this.shadowContainer.clientWidth - CONTAINER_PADDING * 2;
		const contentHeight =
			this.shadowContainer.clientHeight - CONTAINER_PADDING * 2;

		if (contentWidth <= 0 || contentHeight <= 0) {
			return;
		}

		// Calculate cell dimensions
		const cellWidth = contentWidth / cols;
		const cellHeight = contentHeight / rows;

		// Calculate pixel position (add padding offset)
		// Offset by one cell height to position IME candidate window below the cursor line
		const left = CONTAINER_PADDING + cursorX * cellWidth;
		const top = CONTAINER_PADDING + (cursorY + 1) * cellHeight;

		// Update textarea position
		this.imeTextarea.style.left = `${left}px`;
		this.imeTextarea.style.top = `${top}px`;
	}

	/**
	 * Setup IME (Input Method Editor) support for Ghostty mode
	 * Ghostty-web doesn't natively support IME, so we create a hidden textarea
	 * to capture composition events and forward the final text to the terminal.
	 */
	private setupGhosttyIME(): void {
		if (!this.shadowContainer) return;

		// Create hidden textarea for IME input
		this.imeTextarea = createEl("textarea", {
			cls: "ghostty-ime-textarea",
			attr: {
				autocorrect: "off",
				autocapitalize: "off",
				spellcheck: "false",
				"aria-label": "Terminal IME input",
			},
		});

		this.shadowContainer.appendChild(this.imeTextarea);

		// Composition start - user begins IME input
		const onCompositionStart = () => {
			this.isComposing = true;
		};

		// Composition end - user confirms IME input
		const onCompositionEnd = (e: CompositionEvent) => {
			this.isComposing = false;
			const text = e.data;
			if (text && this.terminalSession.ptyProcess) {
				this.terminalSession.ptyProcess.write(text);
			}
			// Clear textarea for next input
			if (this.imeTextarea) {
				this.imeTextarea.value = "";
			}
			// In Ghostty mode, keep focus on IME textarea for keyboard handling
			// (Ghostty's native keyboard handling doesn't work well in Electron)
		};

		// Handle keydown in IME textarea - forward non-IME keys to terminal
		const onTextareaKeyDown = (e: KeyboardEvent) => {
			// During composition, let textarea handle it
			if (this.isComposing || e.isComposing) {
				return;
			}

			const key = e.key;

			// Handle Ctrl+F for search (intercept before PTY forwarding)
			if (e.ctrlKey && key.toLowerCase() === "f") {
				e.preventDefault();
				e.stopPropagation();
				this.toggleSearch(true);
				return;
			}

			// Handle Escape to close search
			if (key === "Escape" && this.isSearchVisible) {
				e.preventDefault();
				e.stopPropagation();
				this.toggleSearch(false);
				return;
			}

			// Allow modifier keys to pass through for IME switching (e.g., Shift to toggle input method)
			if (
				key === "Shift" ||
				key === "Control" ||
				key === "Alt" ||
				key === "Meta" ||
				key === "CapsLock"
			) {
				return;
			}

			// For control keys, forward to PTY directly
			let data: string | null = null;

			switch (key) {
				case "Backspace":
					data = "\x7f"; // DEL character
					break;
				case "Delete":
					data = "\x1b[3~";
					break;
				case "Enter":
					data = "\r";
					break;
				case "Tab":
					data = "\t";
					break;
				case "Escape":
					data = "\x1b";
					break;
				case "ArrowUp":
					data = "\x1b[A";
					break;
				case "ArrowDown":
					data = "\x1b[B";
					break;
				case "ArrowRight":
					data = "\x1b[C";
					break;
				case "ArrowLeft":
					data = "\x1b[D";
					break;
				case "Home":
					data = "\x1b[H";
					break;
				case "End":
					data = "\x1b[F";
					break;
				case "PageUp":
					data = "\x1b[5~";
					break;
				case "PageDown":
					data = "\x1b[6~";
					break;
				case "Insert":
					data = "\x1b[2~";
					break;
				case "F1":
					data = "\x1bOP";
					break;
				case "F2":
					data = "\x1bOQ";
					break;
				case "F3":
					data = "\x1bOR";
					break;
				case "F4":
					data = "\x1bOS";
					break;
				case "F5":
					data = "\x1b[15~";
					break;
				case "F6":
					data = "\x1b[17~";
					break;
				case "F7":
					data = "\x1b[18~";
					break;
				case "F8":
					data = "\x1b[19~";
					break;
				case "F9":
					data = "\x1b[20~";
					break;
				case "F10":
					data = "\x1b[21~";
					break;
				case "F11":
					data = "\x1b[23~";
					break;
				case "F12":
					data = "\x1b[24~";
					break;
			}

			// Handle Ctrl+key combinations
			if (e.ctrlKey && key.length === 1) {
				const charCode = key.toUpperCase().charCodeAt(0);
				if (charCode >= 65 && charCode <= 90) {
					// A-Z -> Ctrl+A to Ctrl+Z
					data = String.fromCharCode(charCode - 64);
				} else if (key === "[") {
					data = "\x1b"; // Ctrl+[ = Escape
				} else if (key === "\\") {
					data = "\x1c"; // Ctrl+\
				} else if (key === "]") {
					data = "\x1d"; // Ctrl+]
				} else if (key === "^" || key === "6") {
					data = "\x1e"; // Ctrl+^
				} else if (key === "_" || key === "-") {
					data = "\x1f"; // Ctrl+_
				}
			}

			// Handle Alt+key combinations (send ESC prefix)
			if (e.altKey && !e.ctrlKey && !e.metaKey && key.length === 1) {
				data = "\x1b" + key;
			}

			if (data !== null) {
				e.preventDefault();
				e.stopPropagation();
				if (this.terminalSession.ptyProcess) {
					this.terminalSession.ptyProcess.write(data);
				}
				// Clear textarea to prevent accumulation
				if (this.imeTextarea) {
					this.imeTextarea.value = "";
				}
				return;
			}

			// For printable characters (single char, no ctrl/alt/meta),
			// send directly to PTY instead of relying on input event
			if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
				e.preventDefault();
				e.stopPropagation();
				if (this.terminalSession.ptyProcess) {
					this.terminalSession.ptyProcess.write(key);
				}
				// Clear textarea to prevent accumulation
				if (this.imeTextarea) {
					this.imeTextarea.value = "";
				}
				return;
			}
		};

		// Handle input events (backup for any input that bypasses keydown)
		const onInput = (e: Event) => {
			if (this.isComposing) return; // Skip during composition
			const target = e.target as HTMLTextAreaElement;
			const text = target.value;
			if (text && this.terminalSession.ptyProcess) {
				this.terminalSession.ptyProcess.write(text);
			}
			target.value = "";
		};

		this.imeTextarea.addEventListener(
			"compositionstart",
			onCompositionStart,
		);
		this.imeTextarea.addEventListener("compositionend", onCompositionEnd);
		this.imeTextarea.addEventListener("keydown", onTextareaKeyDown);
		this.imeTextarea.addEventListener("input", onInput);

		// --- IME Position Tracking ---
		// Update IME textarea position to follow cursor for proper candidate window placement
		const updateImePosition = () => this.updateGhosttyImePosition();

		// Update on user interaction (keyup captures position after key processing)
		this.imeTextarea.addEventListener("keyup", updateImePosition);
		this.imeTextarea.addEventListener("focus", updateImePosition);

		// Update when terminal cursor moves (shell output, navigation, etc.)
		const term = this.terminal as any;
		if (term.onCursorMove) {
			const cursorMoveDisposable = term.onCursorMove(updateImePosition);
			this.disposables.push(cursorMoveDisposable);
		}

		// Initial position update
		this.updateGhosttyImePosition();

		this.disposables.push({
			dispose: () => {
				this.imeTextarea?.removeEventListener(
					"compositionstart",
					onCompositionStart,
				);
				this.imeTextarea?.removeEventListener(
					"compositionend",
					onCompositionEnd,
				);
				this.imeTextarea?.removeEventListener(
					"keydown",
					onTextareaKeyDown,
				);
				this.imeTextarea?.removeEventListener("input", onInput);
				this.imeTextarea?.removeEventListener(
					"keyup",
					updateImePosition,
				);
				this.imeTextarea?.removeEventListener(
					"focus",
					updateImePosition,
				);
			},
		});

		// Intercept keyboard events on the terminal container to redirect to IME textarea
		const container = this.shadowContainer;
		const onContainerKeyDown = (e: KeyboardEvent) => {
			// Check if this might trigger IME (non-ASCII input or specific keys)
			// For CJK input methods, the key is often "Process" or the event.isComposing is true
			if (e.key === "Process" || e.isComposing) {
				e.preventDefault();
				e.stopPropagation();
				this.imeTextarea?.focus();
				return;
			}
		};

		container.addEventListener("keydown", onContainerKeyDown, {
			capture: true,
		});
		this.disposables.push({
			dispose: () =>
				container.removeEventListener("keydown", onContainerKeyDown, {
					capture: true,
				}),
		});

		// When clicking on terminal, focus IME textarea to enable IME input
		const onClick = () => {
			if (this.imeTextarea && this.useGhostty) {
				this.imeTextarea.focus();
			}
		};

		container.addEventListener("click", onClick);
		this.disposables.push({
			dispose: () => container.removeEventListener("click", onClick),
		});

		// Block Ghostty's native contextmenu handler which causes layout shift
		// Ghostty registers its handler on the container element (A in open(A))
		// We intercept in capture phase and show our own menu instead
		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			// Manually show our context menu
			this.showContextMenu(e);
		};

		container.addEventListener("contextmenu", onContextMenu, {
			capture: true,
		});
		this.disposables.push({
			dispose: () =>
				container.removeEventListener("contextmenu", onContextMenu, {
					capture: true,
				}),
		});

		console.log(
			"✅ Ghostty event handlers initialized (native IME support via ghostty-web 0.3.0+)",
		);
	}

	/**
	 * Setup Obsidian link detection for all renderers
	 * Uses GhosttyLinkDetector which works with mouse events for all terminal types
	 */
	private setupObsidianLinkDetector(): void {
		if (!this.shadowContainer || !this.terminal) return;

		// For Ghostty mode: register link provider for native hover highlighting
		if (this.useGhostty) {
			const linkProvider = new GhosttyObsidianLinkProvider(
				this.app,
				this.terminal,
				this.leaf,
			);
			// ghostty-web Terminal has registerLinkProvider method
			(this.terminal as any).registerLinkProvider(linkProvider);

			this.disposables.push({
				dispose: () => linkProvider.dispose(),
			});

			console.log(
				"✅ Ghostty Obsidian link provider registered (hover underline enabled)",
			);
		} else {
			// For xterm.js mode: use decoration API for link highlighting
			const linkColors = this.getObsidianLinkColors();
			this.linkHighlighter = new ObsidianLinkHighlighter(
				this.terminal as XTerminal,
				false,
				linkColors,
			);
			this.linkHighlighter.initialize();

			this.disposables.push({
				dispose: () => {
					this.linkHighlighter?.dispose();
					this.linkHighlighter = undefined;
				},
			});

			// Register xterm.js link provider for native link clicking
			const xtermLinkProvider = ObsidianLinkProvider.createProvider(
				this.terminal as XTerminal,
				this.app,
			);
			(this.terminal as XTerminal).registerLinkProvider(
				xtermLinkProvider,
			);

			console.log(
				"✅ xterm.js Obsidian link support initialized (decoration + link provider)",
			);
		}

		// GhosttyLinkDetector handles hover popover and Ctrl+Click for all renderers
		this.ghosttyLinkDetector = new GhosttyLinkDetector(
			this.app,
			this.terminal,
			this.shadowContainer,
			this.leaf,
		);
		this.ghosttyLinkDetector.initialize();

		this.disposables.push({
			dispose: () => {
				this.ghosttyLinkDetector?.dispose();
				this.ghosttyLinkDetector = undefined;
			},
		});

		const renderer = this.useGhostty
			? "Ghostty"
			: this.useWebGL
				? "WebGL"
				: "Canvas";
		console.log(`✅ Obsidian link detector initialized (${renderer})`);
	}

	onPaneMenu(menu: Menu) {
		menu.addSeparator();
		this.buildTerminalMenu(menu);
	}

	/**
	 * Build shared terminal menu items (used by both pane menu and context menu)
	 */
	private buildTerminalMenu(menu: Menu): void {
		// Split terminal - vertical (side by side)
		menu.addItem((item) =>
			item
				.setTitle("Split right")
				.setIcon("separator-vertical")
				.onClick(() => {
					this.splitTerminal("vertical");
				}),
		);

		// Split terminal - horizontal (top and bottom)
		menu.addItem((item) =>
			item
				.setTitle("Split down")
				.setIcon("separator-horizontal")
				.onClick(() => {
					this.splitTerminal("horizontal");
				}),
		);

		menu.addSeparator();

		// Clear terminal
		menu.addItem((item) =>
			item
				.setTitle("Clear")
				.setIcon("trash-2")
				.onClick(() => {
					this.clear();
				}),
		);

		// Select all
		menu.addItem((item) =>
			item
				.setTitle("Select all")
				.setIcon("text-select")
				.onClick(() => {
					this.terminal.selectAll();
				}),
		);

		menu.addSeparator();

		// Restart terminal
		menu.addItem((item) =>
			item
				.setTitle("Restart")
				.setIcon("refresh-cw")
				.onClick(() => {
					this.restartTerminal();
				}),
		);

		// New terminal (trigger plugin command)
		menu.addItem((item) =>
			item
				.setTitle("New terminal")
				.setIcon("terminal")
				.onClick(() => {
					(this.app as any).commands.executeCommandById(
						"obsidian-terminal-view:open-terminal",
					);
				}),
		);
	}

	/**
	 * Split the current terminal view and create a new terminal in the split
	 * @param direction "vertical" for side-by-side, "horizontal" for top-bottom
	 */
	private async splitTerminal(
		direction: "vertical" | "horizontal",
	): Promise<void> {
		try {
			// Create new leaf by splitting current leaf
			const newLeaf = this.app.workspace.createLeafBySplit(
				this.leaf,
				direction,
			);

			// Create a new terminal session
			const session =
				await this.plugin.terminalManager.createTerminalWithAvailableShell();

			// Create new terminal view
			const view = new TerminalView(newLeaf, session, this.plugin);

			// Set the view state
			await newLeaf.setViewState({
				type: VIEW_TYPE_TERMINAL,
				active: true,
			});

			// Focus the new terminal after a short delay
			setTimeout(() => {
				this.app.workspace.setActiveLeaf(newLeaf, { focus: true });
				view.focus();
			}, 100);
		} catch (error) {
			console.error("Failed to split terminal:", error);
		}
	}

	/**
	 * Create Shadow DOM for style isolation
	 */
	private createShadowDOM(): void {
		// WebGL mode: render directly to DOM (Shadow DOM causes color issues)
		if (this.useWebGL) {
			this.createDirectDOM();
			return;
		}

		// Create shadow host element
		this.shadowHost = createEl("div", {
			cls: "terminal-shadow-host",
		});

		// Attach shadow root
		this.shadowRoot = this.shadowHost.attachShadow({ mode: "open" });

		// Inject styles into shadow DOM
		const styleEl = document.createElement("style");
		styleEl.textContent = shadowStyles;
		this.shadowRoot.appendChild(styleEl);

		// Create container inside shadow DOM
		this.shadowContainer = this.shadowRoot.createEl("div", {
			cls: "terminal-shadow-container",
		});

		// Append shadow host to view container
		this.terminalViewContainer.appendChild(this.shadowHost);

		// Initialize CSS variables with current theme colors
		this.updateCSSVariables(this.plugin.themeColors);

		console.log("✅ Shadow DOM created");
	}

	/**
	 * Create direct DOM container for WebGL mode (no Shadow DOM)
	 * WebGL renderer has compatibility issues with Shadow DOM
	 */
	private createDirectDOM(): void {
		// Create container directly in the view
		this.shadowContainer = this.terminalViewContainer.createDiv({
			cls: "terminal-direct-container",
		});

		// Inject styles directly
		const styleEl = document.createElement("style");
		styleEl.textContent = shadowStyles;
		this.terminalViewContainer.prepend(styleEl);

		console.log("✅ Direct DOM created (WebGL mode)");
	}

	/**
	 * Create terminal instance (xterm.js or ghostty-web)
	 */
	private createTerminalInstance(): void {
		const theme = this.plugin.themeColors;

		// 从插件设置读取配置，提供安全回退值
		const settings = this.plugin.settings;
		const fontSize = settings?.fontSize ?? DEFAULT_SETTINGS.fontSize;
		const fontFamily =
			this.useGhostty || this.useWebGL
				? "'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace"
				: (settings?.fontFamily ?? DEFAULT_SETTINGS.fontFamily);
		const cursorBlink =
			settings?.cursorBlink ?? DEFAULT_SETTINGS.cursorBlink;
		const scrollback = settings?.scrollback ?? DEFAULT_SETTINGS.scrollback;

		const terminalOptions = {
			fontSize,
			fontFamily,
			// WebGL renderer often looks thinner than canvas, use heavier font weight
			// xterm.js FontWeight accepts: "normal" | "bold" | "100" - "900"
			fontWeight: (this.useWebGL ? "500" : "normal") as
				| "normal"
				| "bold"
				| "500",
			fontWeightBold: "bold" as const,
			cursorBlink,
			cursorStyle: "block" as const,
			theme,
			cols: DEFAULT_TERMINAL_DIMENSIONS.cols,
			rows: DEFAULT_TERMINAL_DIMENSIONS.rows,
			scrollback,
		};

		if (this.useGhostty) {
			// Create Ghostty terminal instance
			this.terminal = new GhosttyTerminal(terminalOptions);
			console.log("✅ Ghostty Terminal instance created");
		} else {
			// Create xterm.js terminal instance
			this.terminal = new XTerminal({
				...terminalOptions,
				allowTransparency: true,
				// 启用 Windows 模式以更好支持 ConPTY
				windowsMode: process.platform === "win32",
				// 允许透明度以支持 Obsidian 主题
				allowProposedApi: true,
			});
			console.log("✅ xterm.js Terminal instance created");
		}
	}

	/**
	 * Load terminal addons
	 */
	private loadAddons(): void {
		if (this.useGhostty) {
			// Ghostty has built-in FitAddon, no need for WebLinksAddon (has built-in link detection)
			this.fitAddon = new GhosttyFitAddon();
			this.terminal.loadAddon(this.fitAddon);
			console.log("✅ Ghostty addons loaded");
		} else {
			// xterm.js addons - load all available addons
			this.fitAddon = new XTermFitAddon();
			this.terminal.loadAddon(this.fitAddon);

			// Web links addon - clickable URLs
			this.webLinksAddon = new WebLinksAddon();
			this.terminal.loadAddon(this.webLinksAddon);

			// Clipboard addon - enhanced clipboard support
			this.terminal.loadAddon(new ClipboardAddon());

			// Image addon - inline image support (iTerm2/Sixel)
			this.terminal.loadAddon(new ImageAddon());

			// Search addon - search functionality
			this.searchAddon = new SearchAddon();
			this.terminal.loadAddon(this.searchAddon);

			// Serialize addon - buffer serialization
			this.terminal.loadAddon(new SerializeAddon());

			// Unicode11 addon - better unicode support
			const unicode11Addon = new Unicode11Addon();
			this.terminal.loadAddon(unicode11Addon);
			(this.terminal as XTerminal).unicode.activeVersion = "11";

			// Note: WebGL addon is loaded separately in loadWebglAddon()
			// after terminal.open() because it requires DOM attachment

			// Note: Obsidian link provider is registered in registerObsidianLinkProvider()
			// after terminal.open() because registerLinkProvider requires DOM attachment

			console.log("✅ xterm.js addons loaded");
		}
	}

	/**
	 * Load WebGL addon for hardware accelerated rendering
	 * Must be called AFTER terminal.open() because WebGL requires DOM attachment
	 */
	private loadWebglAddon(): void {
		if (!this.useWebGL || this.useGhostty) return;

		// Use requestAnimationFrame to ensure DOM is fully rendered/measured
		requestAnimationFrame(() => {
			try {
				// Check WebGL2 support first
				const testCanvas = document.createElement("canvas");
				const gl = testCanvas.getContext("webgl2");
				if (!gl) {
					console.warn(
						"WebGL2 not supported, falling back to canvas renderer",
					);
					return;
				}

				const webglAddon = new WebglAddon();
				webglAddon.onContextLoss(() => {
					console.warn(
						"WebGL context lost, falling back to canvas renderer",
					);
					webglAddon.dispose();
				});
				this.terminal.loadAddon(webglAddon);

				// CRITICAL FIX: Re-apply theme to force WebGL renderer to pick up colors
				// WebGL addon needs theme to be set AFTER it's loaded to properly initialize colors
				const theme = this.plugin.themeColors;
				if (theme) {
					// Force a complete theme refresh by setting options.theme
					(this.terminal as XTerminal).options.theme = { ...theme };
					console.log("✅ WebGL theme applied:", theme);
				}

				console.log("✅ xterm.js WebGL addon loaded successfully");
			} catch (error) {
				console.warn(
					"Failed to load WebGL addon, using canvas renderer:",
					error,
				);
			}
		});
	}

	/**
	 * Open terminal in Shadow DOM
	 */
	private openTerminalInShadow(): void {
		if (!this.shadowContainer) {
			throw new Error("Terminal container not initialized");
		}
		this.terminal.open(this.shadowContainer);
		const mode = this.useWebGL ? "Direct DOM (WebGL)" : "Shadow DOM";
		console.log(`✅ Terminal opened in ${mode}`);
	}

	/**
	 * Connect terminal to PTY process
	 */
	private connectToPTY(): void {
		const { ptyProcess } = this.terminalSession;

		// Extract shell name from session's shell path (not ptyProcess.process which is terminal type)
		const shellPath = this.terminalSession.shell;
		if (shellPath) {
			const shellFileName = shellPath.split(/[\\/]/).pop() || "";
			this.shellName = shellFileName.replace(/\.exe$/i, "");
			console.log("🔍 Shell name extracted:", {
				shellPath,
				shellName: this.shellName,
			});
		}

		// Handle user input - send to PTY
		const dataDisposable = this.terminal.onData((data: string) => {
			try {
				ptyProcess.write(data);
			} catch (error) {
				console.error("Failed to write to PTY:", error);
			}
		});
		this.disposables.push(dataDisposable);

		// Handle PTY output - display in terminal
		const onDataHandler = (data: string) => {
			try {
				this.terminal.write(data);
			} catch (error) {
				console.error("Failed to write to terminal:", error);
			}
		};
		ptyProcess.on("data", onDataHandler);

		this.disposables.push({
			dispose: () => ptyProcess.removeListener("data", onDataHandler),
		});

		// Listen for terminal title changes (contains CWD from shell)
		const titleDisposable = this.terminal.onTitleChange((title: string) => {
			this.currentTitle = title;
			this.updateTabTitle();
		});
		this.disposables.push(titleDisposable);

		// Handle PTY exit
		const onExitHandler = (exitCode: number) => {
			this.handlePTYExit(exitCode);
		};
		ptyProcess.on("exit", onExitHandler);

		this.disposables.push({
			dispose: () => ptyProcess.removeListener("exit", onExitHandler),
		});

		this.isConnected = true;
		console.log("✅ Terminal connected to PTY");
	}

	/**
	 * Update tab title with current directory and shell name
	 */
	private updateTabTitle(): void {
		const leaf = this.leaf as any;
		if (leaf.tabHeaderInnerTitleEl) {
			leaf.tabHeaderInnerTitleEl.setText(this.getDisplayText());
		}
	}

	/**
	 * Update CSS variables in Shadow DOM host to match terminal theme
	 * Uses CSS Custom Properties API for efficient runtime updates
	 */
	private updateCSSVariables(theme: Record<string, string>): void {
		if (!this.shadowHost) return;

		const { background, foreground, cursor, selectionBackground } = theme;

		if (background) {
			this.contentEl.style.setProperty("--terminal-bg", background);
			this.shadowHost.style.setProperty("--terminal-bg", background);
		}
		if (foreground) {
			this.shadowHost.style.setProperty("--terminal-fg", foreground);
		}
		if (cursor) {
			this.shadowHost.style.setProperty("--terminal-cursor", cursor);
		}
		if (selectionBackground) {
			this.shadowHost.style.setProperty(
				"--terminal-selection",
				selectionBackground,
			);
		}
	}

	/**
	 * Get Obsidian link colors from CSS variables
	 * Returns colors for link highlighting in terminal
	 */
	private getObsidianLinkColors(): {
		backgroundColor: string;
		foregroundColor: string;
		borderColor: string;
	} {
		// Get computed styles from document root
		const rootStyles = getComputedStyle(document.documentElement);

		// Get accent color (--color-accent or fallback to Obsidian purple)
		const accentColor =
			rootStyles.getPropertyValue("--color-accent").trim() || "#7c3aed";

		// Get text-on-accent color (or calculate a light version of accent)
		const textOnAccent =
			rootStyles.getPropertyValue("--text-on-accent").trim() || "#c4b5fd";

		// Create semi-transparent background (add alpha to accent color)
		const backgroundColor = this.addAlphaToColor(accentColor, 0.13);

		return {
			backgroundColor,
			foregroundColor: textOnAccent,
			borderColor: accentColor,
		};
	}

	/**
	 * Add alpha channel to hex color
	 * Converts hex color to rgba with specified opacity
	 */
	private addAlphaToColor(hexColor: string, alpha: number): string {
		// Remove # if present
		const hex = hexColor.replace("#", "");

		// Parse hex to RGB
		let r: number, g: number, b: number;
		if (hex.length === 3) {
			// Short hex format (#RGB)
			r = parseInt(hex[0] + hex[0], 16);
			g = parseInt(hex[1] + hex[1], 16);
			b = parseInt(hex[2] + hex[2], 16);
		} else if (hex.length === 6) {
			// Full hex format (#RRGGBB)
			r = parseInt(hex.substring(0, 2), 16);
			g = parseInt(hex.substring(2, 4), 16);
			b = parseInt(hex.substring(4, 6), 16);
		} else {
			// Invalid format, return original with alpha appended if hex8
			return hexColor + Math.round(alpha * 255).toString(16).padStart(2, "0");
		}

		// Return rgba format
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	/**
	 * Update terminal theme colors
	 * Called by plugin when Obsidian theme changes (css-change event)
	 */
	updateTheme(theme: Record<string, string>): void {
		console.log("🎨 updateTheme called", {
			useGhostty: this.useGhostty,
			hasTerminal: !!this.terminal,
		});

		// Sync CSS variables to Shadow DOM for container/viewport background
		this.updateCSSVariables(theme);

		if (!this.terminal) return;

		if (this.useGhostty) {
			// ghostty-web 0.3.0 limitation: theme changes after open() are not supported
			// Cell colors are baked into WASM memory. We must rebuild the terminal.
			this.rebuildGhosttyTerminal(theme);
		} else {
			// xterm.js handles theme changes automatically via options
			this.terminal.options.theme = theme;

			// Update Obsidian link highlighter colors
			if (this.linkHighlighter) {
				const linkColors = this.getObsidianLinkColors();
				this.linkHighlighter.updateColors(linkColors);
			}
		}
	}

	/**
	 * Rebuild Ghostty terminal with new theme
	 * Extracts buffer content, destroys terminal, creates new one with new theme,
	 * and restores the buffer content.
	 */
	private rebuildGhosttyTerminal(theme: Record<string, string>): void {
		if (!this.useGhostty || !this.terminal || !this.shadowContainer) {
			return;
		}

		console.log("🔄 Rebuilding Ghostty terminal with new theme");

		const term = this.terminal as any;

		// Step 1: Extract buffer content as plain text
		const bufferContent = this.extractGhosttyBuffer(term);
		console.log("🔄 Extracted buffer:", bufferContent.length, "lines");

		// Step 2: Get current dimensions
		const cols = term.cols ?? DEFAULT_TERMINAL_DIMENSIONS.cols;
		const rows = term.rows ?? DEFAULT_TERMINAL_DIMENSIONS.rows;

		// Step 3: Dispose old terminal (but keep PTY connection)
		// Remove terminal-specific disposables, keep PTY handlers
		if (this.fitAddon) {
			try {
				this.fitAddon.dispose();
			} catch {
				// Ignore
			}
			this.fitAddon = null as any;
		}

		// Clear the shadow container
		if (this.shadowContainer) {
			this.shadowContainer.innerHTML = "";
		}

		// Dispose old terminal
		try {
			this.terminal.dispose();
		} catch {
			// Ignore disposal errors
		}

		// Step 4: Create new terminal with new theme
		const settings = this.plugin.settings;
		const fontSize = settings?.fontSize ?? DEFAULT_SETTINGS.fontSize;
		const fontFamily =
			"'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace";
		const cursorBlink =
			settings?.cursorBlink ?? DEFAULT_SETTINGS.cursorBlink;
		const scrollback = settings?.scrollback ?? DEFAULT_SETTINGS.scrollback;

		this.terminal = new GhosttyTerminal({
			fontSize,
			fontFamily,
			cursorBlink,
			cursorStyle: "block" as const,
			theme,
			cols,
			rows,
			scrollback,
		});

		console.log("🔄 New Ghostty terminal created");

		// Step 5: Load addons
		this.fitAddon = new GhosttyFitAddon();
		this.terminal.loadAddon(this.fitAddon);

		// Step 6: Open in shadow container
		this.terminal.open(this.shadowContainer);

		// Step 7: Reconnect data handler (PTY output -> terminal)
		// Note: PTY -> terminal handler was on ptyProcess, still active
		// We only need to reconnect terminal -> PTY (user input)
		const { ptyProcess } = this.terminalSession;
		const dataDisposable = this.terminal.onData((data: string) => {
			try {
				ptyProcess.write(data);
			} catch (error) {
				console.error("Failed to write to PTY:", error);
			}
		});
		this.disposables.push(dataDisposable);

		// Step 8: Restore buffer content
		if (bufferContent.length > 0) {
			// Write content back (convert to terminal format with CRLF)
			const content = bufferContent.join("\r\n");
			this.terminal.write(content);
		}

		// Step 9: Fit to container
		requestAnimationFrame(() => {
			if (this.fitAddon) {
				try {
					this.fitAddon.fit();
				} catch {
					// Ignore fit errors
				}
			}
		});

		console.log("🔄 Ghostty terminal rebuild complete");
	}

	/**
	 * Extract text content from Ghostty terminal buffer
	 */
	private extractGhosttyBuffer(term: any): string[] {
		const lines: string[] = [];

		if (!term.wasmTerm) {
			return lines;
		}

		const wasmTerm = term.wasmTerm;
		const dims = wasmTerm.getDimensions();
		const scrollbackLen = wasmTerm.getScrollbackLength();

		// Extract scrollback lines
		for (let i = 0; i < scrollbackLen; i++) {
			const cells = wasmTerm.getScrollbackLine(i);
			if (cells) {
				lines.push(this.cellsToString(cells));
			}
		}

		// Extract visible screen lines
		for (let y = 0; y < dims.rows; y++) {
			const cells = wasmTerm.getLine(y);
			if (cells) {
				lines.push(this.cellsToString(cells));
			}
		}

		// Trim trailing empty lines
		while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
			lines.pop();
		}

		return lines;
	}

	/**
	 * Convert GhosttyCell array to string
	 */
	private cellsToString(cells: any[]): string {
		let str = "";
		for (const cell of cells) {
			if (cell.codepoint > 0) {
				str += String.fromCodePoint(cell.codepoint);
			} else if (cell.width > 0) {
				str += " ";
			}
		}
		// Trim trailing spaces
		return str.trimEnd();
	}

	/**
	 * Handle PTY process exit
	 */
	private handlePTYExit(exitCode: number): void {
		this.isConnected = false;

		const message =
			exitCode === 0
				? "Terminal session ended"
				: `Terminal exited with code ${exitCode}`;

		this.terminal.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
		this.terminal.writeln("\x1b[90mPress any key to restart...\x1b[0m");

		this.setupRestartHandler();
	}

	/**
	 * Handle terminal errors
	 */
	private handleTerminalError(error: Error): void {
		console.error("Terminal error:", error);
		this.isConnected = false;

		this.terminal.writeln(
			`\r\n\x1b[31mTerminal error: ${error.message}\x1b[0m`,
		);
		this.terminal.writeln("\x1b[90mPress any key to restart...\x1b[0m");

		this.setupRestartHandler();
	}

	/**
	 * Setup restart handler
	 */
	private setupRestartHandler(): void {
		const restartDisposable = this.terminal.onKey(() => {
			restartDisposable.dispose();
			this.restartTerminal();
		});
	}

	/**
	 * Restart the terminal session
	 */
	private async restartTerminal(): Promise<void> {
		if (this.isRestarting) return;

		this.isRestarting = true;

		try {
			// Clear shell session cache
			const sessionKey = this.getSessionKey();
			shellSessions.delete(sessionKey);

			// Dispose old terminal UI
			this.disposeTerminal();

			// Reset state
			this.initializationState = "idle";
			this.isInitialized = false;

			// Clear shadow host
			if (this.shadowHost) {
				this.shadowHost.remove();
				this.shadowHost = null;
				this.shadowRoot = null;
				this.shadowContainer = null;
			}

			// Restart PTY session via manager (kills old PTY, creates new one)
			const newSession =
				await this.plugin.terminalManager.restartTerminal(
					this.terminalSession.id,
				);
			this.terminalSession = newSession;

			// Reinitialize terminal UI
			await this.initializeTerminal();
			this.isInitialized = true;

			console.log("✅ Terminal restarted successfully");
		} catch (error) {
			console.error("Failed to restart terminal:", error);
			this.handleTerminalError(error as Error);
		} finally {
			this.isRestarting = false;
		}
	}

	/**
	 * Dispose terminal resources
	 */
	private disposeTerminal(): void {
		for (const disposable of this.disposables) {
			try {
				disposable.dispose();
			} catch {
				// Ignore disposal errors
			}
		}
		this.disposables = [];

		if (this.terminal) {
			this.terminal.dispose();
		}
	}

	/**
	 * Write data to terminal
	 */
	write(data: string): void {
		if (this.terminal) {
			this.terminal.write(data);
		}
	}

	/**
	 * Write line to terminal
	 */
	writeln(data: string): void {
		if (this.terminal) {
			this.terminal.writeln(data);
		}
	}

	/**
	 * Focus the terminal
	 */
	focus(): void {
		// In Ghostty mode, focus IME textarea for keyboard input
		if (this.useGhostty && this.imeTextarea) {
			this.imeTextarea.focus();
		} else if (this.terminal) {
			this.terminal.focus();
		}
	}

	/**
	 * Clear the terminal
	 */
	clear(): void {
		if (this.terminal) {
			this.terminal.clear();
		}
	}

	/**
	 * Toggle search box visibility
	 */
	toggleSearch(show?: boolean): void {
		const shouldShow = show ?? !this.isSearchVisible;

		if (shouldShow) {
			this.showSearch();
		} else {
			this.hideSearch();
		}
	}

	/**
	 * Show the search box
	 */
	private showSearch(): void {
		if (this.isSearchVisible && this.searchInput) {
			this.searchInput.focus();
			this.searchInput.select();
			return;
		}

		// Create search container if not exists
		if (!this.searchContainer) {
			this.createSearchUI();
		}

		if (this.searchContainer) {
			this.searchContainer.style.display = "flex";
			this.isSearchVisible = true;
			this.searchInput?.focus();
			this.searchInput?.select();
		}
	}

	/**
	 * Hide the search box
	 */
	private hideSearch(): void {
		if (this.searchContainer) {
			this.searchContainer.style.display = "none";
		}
		this.isSearchVisible = false;
		this.searchAddon?.clearDecorations();
		this.terminal?.focus();
	}

	/**
	 * Create search UI in contentEl
	 */
	private createSearchUI(): void {
		// Create container at top-right of contentEl
		this.searchContainer = this.contentEl.createDiv({
			cls: "terminal-search-container",
		});

		// Search input
		this.searchInput = this.searchContainer.createEl("input", {
			cls: "terminal-search-input",
			attr: {
				type: "text",
				placeholder: "Search...",
				spellcheck: "false",
			},
		});

		// Previous button
		const prevBtn = this.searchContainer.createEl("button", {
			cls: "terminal-search-btn",
			attr: { "aria-label": "Previous match" },
		});
		prevBtn.innerHTML = "↑";

		// Next button
		const nextBtn = this.searchContainer.createEl("button", {
			cls: "terminal-search-btn",
			attr: { "aria-label": "Next match" },
		});
		nextBtn.innerHTML = "↓";

		// Close button
		const closeBtn = this.searchContainer.createEl("button", {
			cls: "terminal-search-btn terminal-search-close",
			attr: { "aria-label": "Close search" },
		});
		closeBtn.innerHTML = "×";

		// Event handlers
		this.searchInput.addEventListener("input", () => {
			this.performSearch();
		});

		this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				if (e.shiftKey) {
					this.searchPrevious();
				} else {
					this.searchNext();
				}
			} else if (e.key === "Escape") {
				e.preventDefault();
				this.hideSearch();
			}
		});

		prevBtn.addEventListener("click", () => this.searchPrevious());
		nextBtn.addEventListener("click", () => this.searchNext());
		closeBtn.addEventListener("click", () => this.hideSearch());

		// Initially hidden
		this.searchContainer.style.display = "none";
	}

	/**
	 * Perform search with current input value
	 */
	private performSearch(): void {
		if (!this.searchInput) return;

		const query = this.searchInput.value;
		if (!query) {
			this.searchAddon?.clearDecorations();
			return;
		}

		if (this.searchAddon) {
			// xterm.js mode: use SearchAddon
			this.searchAddon.findNext(query);
		} else if (this.useGhostty) {
			// Ghostty mode: manual buffer search
			this.ghosttySearch(query, "next");
		}
	}

	/**
	 * Find next match
	 */
	private searchNext(): void {
		if (!this.searchInput?.value) return;

		if (this.searchAddon) {
			this.searchAddon.findNext(this.searchInput.value);
		} else if (this.useGhostty) {
			this.ghosttySearch(this.searchInput.value, "next");
		}
	}

	/**
	 * Find previous match
	 */
	private searchPrevious(): void {
		if (!this.searchInput?.value) return;

		if (this.searchAddon) {
			this.searchAddon.findPrevious(this.searchInput.value);
		} else if (this.useGhostty) {
			this.ghosttySearch(this.searchInput.value, "previous");
		}
	}

	/**
	 * Manual search implementation for Ghostty mode
	 * Searches through the terminal buffer and scrolls to match
	 */
	private ghosttySearch(query: string, direction: "next" | "previous"): void {
		if (!this.terminal || !query) return;

		const term = this.terminal as any;
		if (!term.buffer?.active) return;

		const buffer = term.buffer.active;
		const totalLines = buffer.length;
		const viewportY = buffer.viewportY ?? 0;
		const cursorY = buffer.cursorY ?? 0;

		// Current search position (viewport-relative)
		const startLine = viewportY + cursorY;

		// Search through buffer lines
		const lowerQuery = query.toLowerCase();
		let foundLine = -1;

		if (direction === "next") {
			// Search forward from current position
			for (let i = startLine + 1; i < totalLines; i++) {
				const line = buffer.getLine(i);
				if (line) {
					const text = line.translateToString().toLowerCase();
					if (text.includes(lowerQuery)) {
						foundLine = i;
						break;
					}
				}
			}
			// Wrap around to beginning
			if (foundLine === -1) {
				for (let i = 0; i <= startLine; i++) {
					const line = buffer.getLine(i);
					if (line) {
						const text = line.translateToString().toLowerCase();
						if (text.includes(lowerQuery)) {
							foundLine = i;
							break;
						}
					}
				}
			}
		} else {
			// Search backward from current position
			for (let i = startLine - 1; i >= 0; i--) {
				const line = buffer.getLine(i);
				if (line) {
					const text = line.translateToString().toLowerCase();
					if (text.includes(lowerQuery)) {
						foundLine = i;
						break;
					}
				}
			}
			// Wrap around to end
			if (foundLine === -1) {
				for (let i = totalLines - 1; i >= startLine; i--) {
					const line = buffer.getLine(i);
					if (line) {
						const text = line.translateToString().toLowerCase();
						if (text.includes(lowerQuery)) {
							foundLine = i;
							break;
						}
					}
				}
			}
		}

		// Scroll to found line
		if (foundLine !== -1) {
			this.terminal.scrollToLine(foundLine);
		}
	}

	/**
	 * Apply settings update to terminal
	 * Called when user changes settings to apply changes immediately
	 */
	applySettings(): void {
		if (!this.terminal || !this.plugin.settings) return;

		const { fontSize, fontFamily, cursorBlink, scrollback } =
			this.plugin.settings;

		this.terminal.options.fontSize = fontSize;
		this.terminal.options.fontFamily = fontFamily;
		this.terminal.options.cursorBlink = cursorBlink;
		this.terminal.options.scrollback = scrollback;

		// 字体大小变更后需要重新适配尺寸
		this.resize();
	}

	/**
	 * Set up keyboard handlers for copy/paste
	 * Uses Obsidian's Scope to intercept hotkeys before Obsidian's global handlers
	 */
	private setupKeyboardHandlers(): void {
		// xterm.js custom key event handler (handles events within terminal)
		this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
			return this.handleKeyboardEvent(event);
		});

		// Create an Obsidian Scope to intercept hotkeys before Obsidian's global handlers
		// This prevents Obsidian's Ctrl+F (search notes) from triggering when terminal is focused
		this.keyboardScope = new Scope(this.app.scope);

		// Register terminal-specific hotkeys in the scope
		// Ctrl+F: Terminal search (prevent Obsidian's global search)
		this.keyboardScope.register(["Ctrl"], "f", (evt: KeyboardEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			this.toggleSearch(true);
			return false;
		});

		// Escape: Close terminal search
		this.keyboardScope.register([], "Escape", (evt: KeyboardEvent) => {
			if (this.isSearchVisible) {
				evt.preventDefault();
				evt.stopPropagation();
				this.toggleSearch(false);
				return false;
			}
			// Let Escape propagate if search is not visible (for other uses)
			return true;
		});

		// Push scope when terminal container gets focus
		const pushScope = () => {
			if (this.keyboardScope) {
				this.app.keymap.pushScope(this.keyboardScope);
			}
		};

		// Pop scope when terminal container loses focus
		const popScope = () => {
			if (this.keyboardScope) {
				this.app.keymap.popScope(this.keyboardScope);
			}
		};

		// Listen for focus events on the terminal container
		if (this.shadowContainer) {
			this.shadowContainer.addEventListener("focusin", pushScope);
			this.shadowContainer.addEventListener("focusout", popScope);

			this.disposables.push({
				dispose: () => {
					this.shadowContainer?.removeEventListener(
						"focusin",
						pushScope,
					);
					this.shadowContainer?.removeEventListener(
						"focusout",
						popScope,
					);
					// Ensure scope is popped on disposal
					if (this.keyboardScope) {
						this.app.keymap.popScope(this.keyboardScope);
					}
				},
			});
		}

		// Also push scope when IME textarea is focused (Ghostty mode)
		if (this.imeTextarea) {
			this.imeTextarea.addEventListener("focus", pushScope);
			this.imeTextarea.addEventListener("blur", popScope);

			this.disposables.push({
				dispose: () => {
					this.imeTextarea?.removeEventListener("focus", pushScope);
					this.imeTextarea?.removeEventListener("blur", popScope);
				},
			});
		}
	}

	/**
	 * Handle keyboard events for copy/paste/search
	 */
	private handleKeyboardEvent(event: KeyboardEvent): boolean {
		// Handle Ctrl+F for search
		if (event.ctrlKey && event.key === "f") {
			event.preventDefault();
			this.toggleSearch(true);
			return false;
		}

		// Handle Escape to close search
		if (event.key === "Escape" && this.isSearchVisible) {
			this.toggleSearch(false);
			return false;
		}

		// Handle Ctrl+C for copy when there's a selection
		if (
			event.ctrlKey &&
			event.key === "c" &&
			this.terminal.hasSelection()
		) {
			event.preventDefault();
			event.stopPropagation();
			const selection = this.terminal.getSelection();
			if (selection) {
				navigator.clipboard.writeText(selection).catch((err) => {
					console.error("Failed to copy:", err);
				});
			}
			return false; // Prevent default
		}

		// Handle Ctrl+V for paste
		if (event.ctrlKey && event.key === "v") {
			event.preventDefault();
			event.stopPropagation();
			navigator.clipboard
				.readText()
				.then((text) => {
					if (text && this.terminalSession.ptyProcess) {
						this.terminalSession.ptyProcess.write(text);
					}
				})
				.catch((err) => {
					console.error("Failed to paste:", err);
				});
			return false; // Prevent default
		}

		return true; // Allow other keys
	}

	/**
	 * 设置右键上下文菜单
	 */
	private setupContextMenu(): void {
		if (!this.shadowContainer) return;

		// For Ghostty mode, contextmenu is handled in setupGhosttyIME
		// to intercept before Ghostty's handler causes layout shift
		if (this.useGhostty) return;

		this.shadowContainer.addEventListener(
			"contextmenu",
			(event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				this.showContextMenu(event);
			},
		);
	}

	/**
	 * 显示右键上下文菜单
	 */
	private showContextMenu(event: MouseEvent): void {
		const menu = new Menu();

		// Copy selected text (context menu only)
		if (this.terminal.hasSelection()) {
			menu.addItem((item) =>
				item
					.setTitle("Copy")
					.setIcon("copy")
					.onClick(() => {
						const selection = this.terminal.getSelection();
						if (selection) {
							navigator.clipboard
								.writeText(selection)
								.catch((err) => {
									console.error("Failed to copy:", err);
								});
						}
					}),
			);
		}

		// Paste (context menu only)
		menu.addItem((item) =>
			item
				.setTitle("Paste")
				.setIcon("clipboard-paste")
				.onClick(() => {
					navigator.clipboard
						.readText()
						.then((text) => {
							if (text && this.terminalSession.ptyProcess) {
								this.terminalSession.ptyProcess.write(text);
							}
						})
						.catch((err) => {
							console.error("Failed to paste:", err);
						});
				}),
		);

		menu.addSeparator();

		// Shared menu items
		this.buildTerminalMenu(menu);

		menu.showAtMouseEvent(event);
	}

	/**
	 * Get session key for this terminal
	 */
	private getSessionKey(): string {
		return `terminal-${this.terminalSession.id}`;
	}

	/**
	 * Restore session from saved state
	 */
	private async restoreSession(session: ShellSessionData): Promise<void> {
		try {
			this.terminal = session.terminal;
			this.fitAddon = session.fitAddon;
			this.isConnected = session.isConnected;
			this.disposables = session.disposables;

			// Create new shadow DOM for this view
			this.createShadowDOM();

			// Re-open terminal in new shadow container
			if (this.shadowContainer) {
				this.terminal.open(this.shadowContainer);
			}

			// Fit to new container
			requestAnimationFrame(() => {
				this.fitAddon.fit();
				this.terminal.focus();
			});

			this.initializationState = "ready";
			console.log("✅ Terminal session restored (Shadow DOM)");
		} catch (error) {
			console.error("Failed to restore session:", error);
			const sessionKey = this.getSessionKey();
			shellSessions.delete(sessionKey);
			await this.initializeTerminal();
		}
	}
}
