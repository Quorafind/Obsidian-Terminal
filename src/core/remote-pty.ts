/**
 * Remote PTY Implementation
 *
 * Provides a PTY-like interface that communicates with the PTY host sidecar process.
 * Implements the IPty interface to be compatible with existing code.
 *
 * @module remote-pty
 */

import { EventEmitter } from "events";
import type { IPty } from "@/types";

/**
 * Callback type for sending commands to the PTY host
 */
export type SendToHostFn = (
	method: string,
	params: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Remote PTY class
 *
 * Wraps communication with a PTY process running in the sidecar host.
 * Events are forwarded from the host via the ElectronBridge.
 */
export class RemotePty extends EventEmitter implements IPty {
	/** PTY process ID (may be temporary until real PID is assigned) */
	public pid: number;

	/** Current column count */
	public cols: number;

	/** Current row count */
	public rows: number;

	/** Shell process name */
	public process: string;

	/** Flow control handling (not used in remote implementation) */
	public handleFlowControl = false;

	/** Function to send commands to the PTY host */
	private sendToHost: SendToHostFn;

	/** Whether this PTY has been killed */
	private killed = false;

	/**
	 * Create a new RemotePty instance
	 *
	 * @param pid - Process ID (may be temporary)
	 * @param sendToHost - Function to send commands to host
	 * @param file - Shell executable name
	 * @param cols - Initial column count
	 * @param rows - Initial row count
	 */
	constructor(
		pid: number,
		sendToHost: SendToHostFn,
		file: string,
		cols: number,
		rows: number,
	) {
		super();
		this.pid = pid;
		this.sendToHost = sendToHost;
		this.process = file;
		this.cols = cols;
		this.rows = rows;
	}

	/**
	 * Resize the PTY
	 *
	 * @param cols - New column count
	 * @param rows - New row count
	 */
	resize(cols: number, rows: number): void {
		if (this.killed) return;

		this.cols = cols;
		this.rows = rows;

		// Fire and forget - resize doesn't need confirmation
		this.sendToHost("resize", { pid: this.pid, cols, rows }).catch(() => {
			// Ignore errors - PTY may have exited
		});
	}

	/**
	 * Write data to the PTY
	 *
	 * @param data - Data to write
	 */
	write(data: string): void {
		if (this.killed) return;

		// Fire and forget for performance
		this.sendToHost("write", { pid: this.pid, data }).catch(() => {
			// Ignore errors - PTY may have exited
		});
	}

	/**
	 * Kill the PTY process
	 *
	 * @param signal - Signal to send (optional)
	 */
	kill(signal?: string): void {
		if (this.killed) return;

		this.killed = true;
		this.sendToHost("kill", { pid: this.pid, signal }).catch(() => {
			// Ignore errors
		});
	}

	/**
	 * Clear the terminal (send clear screen sequence)
	 */
	clear(): void {
		this.write("\x1b[2J\x1b[H");
	}

	/**
	 * Pause the PTY (not implemented for remote PTY)
	 */
	pause(): void {
		// Not supported in remote implementation
	}

	/**
	 * Resume the PTY (not implemented for remote PTY)
	 */
	resume(): void {
		// Not supported in remote implementation
	}

	// Event emission helpers (called by ElectronBridge)

	/**
	 * Emit data received from the PTY
	 * @internal
	 */
	emitData(data: string): void {
		this.emit("data", data);
	}

	/**
	 * Emit exit event
	 * @internal
	 */
	emitExit(exitCode: number, signal?: number): void {
		this.killed = true;
		this.emit("exit", exitCode, signal);
	}

	/**
	 * Emit error event
	 * @internal
	 */
	emitError(error: Error): void {
		this.emit("error", error);
	}

	/**
	 * Update the real PID after creation
	 * @internal
	 */
	updatePid(realPid: number): void {
		this.pid = realPid;
	}

	/**
	 * Check if this PTY has been killed
	 */
	isKilled(): boolean {
		return this.killed;
	}

	// node-pty compatible event subscription methods

	/**
	 * Register a data event handler
	 */
	onData(handler: (data: string) => void): { dispose: () => void } {
		this.on("data", handler);
		return {
			dispose: () => this.off("data", handler),
		};
	}

	/**
	 * Register an exit event handler
	 */
	onExit(handler: (e: { exitCode: number; signal?: number }) => void): {
		dispose: () => void;
	} {
		const wrappedHandler = (exitCode: number, signal?: number) => {
			handler({ exitCode, signal });
		};
		this.on("exit", wrappedHandler);
		return {
			dispose: () => this.off("exit", wrappedHandler),
		};
	}
}
