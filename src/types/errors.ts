/**
 * Terminal error types enumeration
 */
export enum TerminalErrorType {
	PTY_CREATION_FAILED = "PTY_CREATION_FAILED",
	SHELL_NOT_FOUND = "SHELL_NOT_FOUND",
	ELECTRON_NOT_AVAILABLE = "ELECTRON_NOT_AVAILABLE",
	NODE_PTY_NOT_AVAILABLE = "NODE_PTY_NOT_AVAILABLE",
	PROCESS_TERMINATED = "PROCESS_TERMINATED",
	VIEW_CREATION_FAILED = "VIEW_CREATION_FAILED",
}

/**
 * Terminal error interface
 */
export interface TerminalError {
	type: TerminalErrorType;
	message: string;
	originalError?: Error;
	context?: Record<string, any>;
}

/**
 * Error recovery interface
 */
export interface IErrorRecovery {
	handlePTYError(error: TerminalError): Promise<boolean>;
	handleShellTermination(terminalId: string): Promise<void>;
	handleModuleLoadError(moduleName: string): Promise<void>;
	showErrorNotification(error: TerminalError): void;
}

/**
 * Custom terminal error class
 */
export class TerminalPluginError extends Error {
	public readonly type: TerminalErrorType;
	public readonly context?: Record<string, any>;
	public readonly originalError?: Error;

	constructor(
		type: TerminalErrorType,
		message: string,
		originalError?: Error,
		context?: Record<string, any>
	) {
		super(message);
		this.name = "TerminalPluginError";
		this.type = type;
		this.originalError = originalError;
		this.context = context;
	}

	/**
	 * Create a formatted error message for user display
	 */
	public getUserMessage(): string {
		switch (this.type) {
			case TerminalErrorType.PTY_CREATION_FAILED:
				return "无法创建终端进程。请检查系统权限和依赖项。";
			case TerminalErrorType.SHELL_NOT_FOUND:
				return "找不到指定的 shell 程序。请检查系统配置。";
			case TerminalErrorType.ELECTRON_NOT_AVAILABLE:
				return "Electron 环境不可用。此插件需要在桌面版 Obsidian 中运行。";
			case TerminalErrorType.NODE_PTY_NOT_AVAILABLE:
				return "node-pty 模块不可用。请重新安装插件或联系开发者。";
			case TerminalErrorType.PROCESS_TERMINATED:
				return "终端进程意外终止。您可以尝试重新启动终端。";
			case TerminalErrorType.VIEW_CREATION_FAILED:
				return "无法创建终端视图。请重试或重启 Obsidian。";
			default:
				return this.message;
		}
	}
}

/**
 * Abstract error recovery class
 */
export abstract class ErrorRecovery implements IErrorRecovery {
	abstract handlePTYError(error: TerminalError): Promise<boolean>;
	abstract handleShellTermination(terminalId: string): Promise<void>;
	abstract handleModuleLoadError(moduleName: string): Promise<void>;
	abstract showErrorNotification(error: TerminalError): void;
}
