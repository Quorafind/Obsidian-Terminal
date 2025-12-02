import { ItemView } from "obsidian";
import { Terminal } from "@xterm/xterm";
import { IPty } from "./pty";

/**
 * Terminal plugin main interface
 */
export interface ITerminalPlugin {
	terminalManager: TerminalManager;
	onload(): Promise<void>;
	onunload(): void;
	openTerminal(): void;
}

/**
 * Terminal manager interface for managing multiple terminal instances
 */
export interface ITerminalManager {
	terminals: Map<string, TerminalSession>;
	createTerminal(id?: string): TerminalSession;
	destroyTerminal(id: string): void;
	getTerminal(id: string): TerminalSession | undefined;
	cleanup(): void;
}

/**
 * Terminal session data structure
 */
export interface TerminalSession {
	id: string;
	ptyProcess: IPty;
	view?: TerminalView;
	isActive: boolean;
}

/**
 * Terminal view interface extending Obsidian's ItemView
 */
export interface ITerminalView {
	terminal: Terminal;
	terminalSession: TerminalSession;
	containerEl: HTMLElement;

	openView(): Promise<void>;
	closeView(): Promise<void>;
	getViewType(): string;
	getDisplayText(): string;
	resize(): void;
}

/**
 * Terminal state for persistence
 */
export interface TerminalState {
	id: string;
	isActive: boolean;
	title: string;
	workingDirectory: string;
	processId: number;
	createdAt: Date;
	lastActivity: Date;
	dimensions: {
		cols: number;
		rows: number;
	};
}

/**
 * Abstract terminal view class
 */
export abstract class TerminalView extends ItemView {
	abstract terminal: Terminal;
	abstract terminalSession: TerminalSession;

	abstract resize(): void;
}

/**
 * Terminal manager abstract class
 */
export abstract class TerminalManager implements ITerminalManager {
	abstract terminals: Map<string, TerminalSession>;
	abstract createTerminal(id?: string): TerminalSession;
	abstract destroyTerminal(id: string): void;
	abstract getTerminal(id: string): TerminalSession | undefined;
	abstract cleanup(): void;
}
