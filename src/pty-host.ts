/**
 * PTY Host Sidecar Process
 *
 * This script runs as a standalone Node.js process (via ELECTRON_RUN_AS_NODE)
 * to bypass Electron's context-aware native module restrictions.
 *
 * Communication with the main Obsidian process is done via stdin/stdout
 * using a line-delimited JSON protocol.
 *
 * @module pty-host
 */

import * as pty from "node-pty";
import * as readline from "readline";
import { platform } from "os";

// Protocol constants
const MessageType = {
	Request: "request",
	Response: "response",
	Event: "event",
} as const;

const Method = {
	Create: "create",
	Write: "write",
	Resize: "resize",
	Kill: "kill",
} as const;

const EventName = {
	Ready: "ready",
	Data: "data",
	Exit: "exit",
	Error: "error",
} as const;

// Type definitions for IPC messages
interface IpcRequest {
	type: typeof MessageType.Request;
	id: string;
	method: string;
	params: Record<string, unknown>;
}

interface IpcResponse {
	type: typeof MessageType.Response;
	id: string;
	result?: unknown;
	error?: string;
}

interface IpcEvent {
	type: typeof MessageType.Event;
	event: string;
	params: Record<string, unknown>;
}

type IpcMessage = IpcRequest | IpcResponse | IpcEvent;

/**
 * PTY Session Manager
 *
 * Manages active PTY sessions with proper lifecycle handling.
 */
class PtySessionManager {
	private sessions = new Map<number, pty.IPty>();

	add(pid: number, term: pty.IPty): void {
		this.sessions.set(pid, term);
	}

	get(pid: number): pty.IPty | undefined {
		return this.sessions.get(pid);
	}

	remove(pid: number): boolean {
		return this.sessions.delete(pid);
	}

	cleanup(): void {
		for (const [, term] of this.sessions) {
			try {
				term.kill();
			} catch {
				// Ignore errors during cleanup
			}
		}
		this.sessions.clear();
	}
}

/**
 * IPC Message Handler
 */
class IpcHandler {
	/**
	 * Send a message to the main process via stdout
	 */
	private send(msg: IpcMessage): void {
		try {
			process.stdout.write(JSON.stringify(msg) + "\n");
		} catch {
			// Silently ignore send errors
		}
	}

	/**
	 * Send a response to a request
	 */
	sendResponse(id: string, result?: unknown, error?: string): void {
		const msg: IpcResponse = {
			type: MessageType.Response,
			id,
		};
		if (result !== undefined) msg.result = result;
		if (error !== undefined) msg.error = error;
		this.send(msg);
	}

	/**
	 * Send an event to the main process
	 */
	sendEvent(event: string, params: Record<string, unknown>): void {
		const msg: IpcEvent = {
			type: MessageType.Event,
			event,
			params,
		};
		this.send(msg);
	}
}

/**
 * PTY Host Application
 */
class PtyHost {
	private sessions = new PtySessionManager();
	private ipc = new IpcHandler();
	private rl: readline.Interface;
	private keepAliveInterval?: ReturnType<typeof setInterval>;

	constructor() {
		// Ensure stdin is flowing - critical for Electron's ELECTRON_RUN_AS_NODE mode
		process.stdin.resume();

		this.rl = readline.createInterface({
			input: process.stdin,
			// NOTE: Intentionally NOT setting output to avoid echo interference with JSON-RPC
			terminal: false,
		});

		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		this.rl.on("line", (line) => this.handleLine(line));
		this.rl.on("close", () => this.shutdown());

		process.on("uncaughtException", (err) => {
			this.ipc.sendEvent(EventName.Error, {
				message: `Uncaught Exception: ${err.message}`,
			});
		});

		process.on("unhandledRejection", (reason) => {
			this.ipc.sendEvent(EventName.Error, {
				message: `Unhandled Rejection: ${reason}`,
			});
		});

		process.on("SIGTERM", () => this.shutdown());
		process.on("SIGINT", () => this.shutdown());
	}

	private handleLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;

		try {
			const msg = JSON.parse(trimmed);
			if (msg.type === MessageType.Request) {
				this.handleRequest(msg as IpcRequest);
			}
		} catch (err) {
			this.ipc.sendResponse(
				"",
				undefined,
				`Protocol error: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private handleRequest(msg: IpcRequest): void {
		const { id, method, params } = msg;

		try {
			switch (method) {
				case Method.Create:
					this.handleCreate(id, params);
					break;
				case Method.Write:
					this.handleWrite(params);
					break;
				case Method.Resize:
					this.handleResize(params);
					break;
				case Method.Kill:
					this.handleKill(id, params);
					break;
				default:
					this.ipc.sendResponse(
						id,
						undefined,
						`Unknown method: ${method}`,
					);
			}
		} catch (err) {
			this.ipc.sendResponse(
				id,
				undefined,
				err instanceof Error ? err.message : String(err),
			);
		}
	}

	private handleCreate(id: string, params: Record<string, unknown>): void {
		const file = params.file as string;
		const args = params.args as string[];
		const options = params.options as Record<string, unknown>;

		// Build PTY options - use type assertion to include Windows-specific options
		const ptyOptions: pty.IPtyForkOptions & { useConpty?: boolean } = {
			name: (options.name as string) || "xterm-256color",
			cols: options.cols as number,
			rows: options.rows as number,
			cwd: options.cwd as string,
			env: options.env as Record<string, string>,
			encoding: (options.encoding as BufferEncoding) || "utf8",
		};

		// On Windows, use WinPTY by default for broader compatibility
		// ConPTY requires Windows 10 1809+ and may not be compiled
		// User can override via options.useConpty if needed
		if (platform() === "win32") {
			ptyOptions.useConpty = (options.useConpty as boolean) ?? false;
		}

		// Spawn the PTY process
		const term = pty.spawn(file, args, ptyOptions);
		const pid = term.pid;

		this.sessions.add(pid, term);

		// Forward data events
		term.onData((data) => {
			this.ipc.sendEvent(EventName.Data, { pid, data });
		});

		// Forward exit events
		term.onExit(({ exitCode, signal }) => {
			this.ipc.sendEvent(EventName.Exit, { pid, exitCode, signal });
			this.sessions.remove(pid);
		});

		this.ipc.sendResponse(id, { pid });
	}

	private handleWrite(params: Record<string, unknown>): void {
		const pid = params.pid as number;
		const data = params.data as string;
		const term = this.sessions.get(pid);

		if (term) {
			term.write(data);
		}
	}

	private handleResize(params: Record<string, unknown>): void {
		const pid = params.pid as number;
		const cols = params.cols as number;
		const rows = params.rows as number;
		const term = this.sessions.get(pid);

		if (term) {
			term.resize(cols, rows);
		}
	}

	private handleKill(id: string, params: Record<string, unknown>): void {
		const pid = params.pid as number;
		const signal = params.signal as string | undefined;
		const term = this.sessions.get(pid);

		if (term) {
			term.kill(signal);
			this.sessions.remove(pid);
		}

		this.ipc.sendResponse(id, { success: true });
	}

	private shutdown(): void {
		if (this.keepAliveInterval) {
			clearInterval(this.keepAliveInterval);
		}
		this.sessions.cleanup();
		this.rl.close();
		process.exit(0);
	}

	start(): void {
		// Keep-alive mechanism: Prevent Node.js from exiting when event loop is empty
		// This is necessary because ELECTRON_RUN_AS_NODE can cause stdin to behave differently
		this.keepAliveInterval = setInterval(
			() => {
				// No-op: keeps the process alive
			},
			1000 * 60 * 60,
		); // 1 hour interval (minimal overhead)

		this.ipc.sendEvent(EventName.Ready, { pid: process.pid });
	}
}

// Entry point
const host = new PtyHost();
host.start();
