/**
 * IPC Protocol Types for PTY Host Communication
 *
 * Defines the JSON-RPC style protocol used between the main process (Obsidian plugin)
 * and the PTY host sidecar process.
 */

/**
 * Message types in the IPC protocol
 */
export enum IpcMessageType {
	Request = 'request',
	Response = 'response',
	Event = 'event',
}

/**
 * Available RPC methods
 */
export enum IpcMethod {
	/** Create a new PTY session */
	Create = 'create',
	/** Write data to PTY */
	Write = 'write',
	/** Resize PTY dimensions */
	Resize = 'resize',
	/** Kill PTY process */
	Kill = 'kill',
}

/**
 * Event types emitted by the PTY host
 */
export enum IpcEvent {
	/** PTY host is ready */
	Ready = 'ready',
	/** PTY data output */
	Data = 'data',
	/** PTY process exited */
	Exit = 'exit',
	/** Error occurred */
	Error = 'error',
}

/**
 * Base IPC message structure
 */
export interface IpcMessageBase {
	type: IpcMessageType;
}

/**
 * Request message from main process to PTY host
 */
export interface IpcRequest extends IpcMessageBase {
	type: IpcMessageType.Request;
	id: string;
	method: IpcMethod;
	params: IpcRequestParams;
}

/**
 * Response message from PTY host to main process
 */
export interface IpcResponse extends IpcMessageBase {
	type: IpcMessageType.Response;
	id: string;
	result?: unknown;
	error?: string;
}

/**
 * Event message from PTY host to main process
 */
export interface IpcEventMessage extends IpcMessageBase {
	type: IpcMessageType.Event;
	event: IpcEvent;
	params: IpcEventParams;
}

/**
 * Union type for all IPC messages
 */
export type IpcMessage = IpcRequest | IpcResponse | IpcEventMessage;

// Request Parameters

/**
 * Parameters for PTY creation
 */
export interface CreatePtyParams {
	/** Shell executable path */
	file: string;
	/** Command line arguments */
	args: string[];
	/** PTY options */
	options: {
		name?: string;
		cols: number;
		rows: number;
		cwd: string;
		env: Record<string, string>;
		encoding?: string;
	};
}

/**
 * Parameters for writing to PTY
 */
export interface WritePtyParams {
	/** PTY process ID */
	pid: number;
	/** Data to write */
	data: string;
}

/**
 * Parameters for resizing PTY
 */
export interface ResizePtyParams {
	/** PTY process ID */
	pid: number;
	/** Number of columns */
	cols: number;
	/** Number of rows */
	rows: number;
}

/**
 * Parameters for killing PTY
 */
export interface KillPtyParams {
	/** PTY process ID */
	pid: number;
	/** Signal to send (optional) */
	signal?: string;
}

/**
 * Union type for request parameters
 */
export type IpcRequestParams = CreatePtyParams | WritePtyParams | ResizePtyParams | KillPtyParams;

// Event Parameters

/**
 * Parameters for ready event
 */
export interface ReadyEventParams {
	/** Host process ID */
	pid: number;
}

/**
 * Parameters for data event
 */
export interface DataEventParams {
	/** PTY process ID */
	pid: number;
	/** Output data */
	data: string;
}

/**
 * Parameters for exit event
 */
export interface ExitEventParams {
	/** PTY process ID */
	pid: number;
	/** Exit code */
	exitCode: number;
	/** Signal number (if killed by signal) */
	signal?: number;
}

/**
 * Parameters for error event
 */
export interface ErrorEventParams {
	/** Error message */
	message: string;
	/** Associated PTY process ID (if applicable) */
	pid?: number;
}

/**
 * Union type for event parameters
 */
export type IpcEventParams = ReadyEventParams | DataEventParams | ExitEventParams | ErrorEventParams;

// Response Results

/**
 * Result of PTY creation
 */
export interface CreatePtyResult {
	/** Created PTY process ID */
	pid: number;
}
