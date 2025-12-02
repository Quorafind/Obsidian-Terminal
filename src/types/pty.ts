import { IPty as NodePtyIPty } from "node-pty";

/**
 * Extended IPty interface with event handling methods
 */
export interface IPty extends NodePtyIPty {
	on(event: "data", callback: (data: string) => void): void;
	on(event: "exit", callback: (exitCode: number, signal?: number) => void): void;
	on(event: "error", callback: (error: Error) => void): void;
	on(event: "spawn", callback: () => void): void;
	on(event: string, callback: (...args: any[]) => void): void;
	
	removeListener(event: string, callback: (...args: any[]) => void): void;
	removeAllListeners(): void;
	kill(signal?: string): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
}

/**
 * PTY manager interface for managing pseudo-terminal processes
 */
export interface IPTYManager {
	createPTY(options: PTYOptions): IPty;
	destroyPTY(pty: IPty): void;
	getDefaultShell(): string;
	getDefaultOptions(): PTYOptions;
}

/**
 * PTY creation options
 */
export interface PTYOptions {
	shell: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
	cols: number;
	rows: number;
}

/**
 * Electron integration bridge interface
 */
export interface IElectronBridge {
	isElectronAvailable(): boolean;
	getNodePTY(): typeof import("node-pty") | null;
	requireModule(moduleName: string): any;
	getProcess(): NodeJS.Process;
}

/**
 * Abstract PTY manager class
 */
export abstract class PTYManager implements IPTYManager {
	abstract createPTY(options: PTYOptions): IPty;
	abstract destroyPTY(pty: IPty): void;
	abstract getDefaultShell(): string;
	abstract getDefaultOptions(): PTYOptions;
}

/**
 * Abstract Electron bridge class
 */
export abstract class ElectronBridge implements IElectronBridge {
	abstract isElectronAvailable(): boolean;
	abstract getNodePTY(): typeof import("node-pty") | null;
	abstract requireModule(moduleName: string): any;
	abstract getProcess(): NodeJS.Process;
}
