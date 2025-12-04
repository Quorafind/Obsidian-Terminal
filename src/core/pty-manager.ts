import { IPty } from "@/types";
import {
	PTYManager as BasePTYManager,
	PTYOptions,
	TerminalPluginError,
	TerminalErrorType,
} from "@/types";
import { ElectronBridge } from "./electron-bridge";
import { DEFAULT_TERMINAL_DIMENSIONS } from "@/constants";

/**
 * Settings provider interface for PTYManager
 */
export interface PTYSettingsProvider {
	defaultShell: string;
	shellArgs: string[];
}

/**
 * PTY manager implementation for managing pseudo-terminal processes
 * Handles PTY creation, destruction, and configuration
 */
export class PTYManager extends BasePTYManager {
	private electronBridge: ElectronBridge;
	private activePTYs: Set<IPty> = new Set();
	private settingsProvider: (() => PTYSettingsProvider | null) | null = null;

	constructor(electronBridge: ElectronBridge) {
		super();
		this.electronBridge = electronBridge;
	}

	/**
	 * Set settings provider callback
	 * This allows PTYManager to access user settings for shell configuration
	 */
	setSettingsProvider(provider: () => PTYSettingsProvider | null): void {
		this.settingsProvider = provider;
	}

	/**
	 * Create a new PTY process with given options
	 */
	createPTY(options: PTYOptions): IPty {
		try {
			const nodePty = this.electronBridge.getNodePTY();

			if (!nodePty) {
				throw new TerminalPluginError(
					TerminalErrorType.NODE_PTY_NOT_AVAILABLE,
					"node-pty module is not available",
				);
			}

			// Validate shell exists before creating PTY
			if (!this.validateShellPath(options.shell)) {
				throw new TerminalPluginError(
					TerminalErrorType.SHELL_NOT_FOUND,
					`Shell not found: ${options.shell}`,
				);
			}

			// Validate cwd with proper permission checks (R_OK + X_OK)
			// This is crucial for posix_spawn which requires directory execute permission
			options.cwd = this.validateAndResolveCwd(options.cwd);

			// Platform detection for spawn options
			const proc = this.electronBridge.getProcess();
			const isWindows = proc.platform === "win32";

			// Build spawn options - useConpty is Windows-only!
			// Using useConpty on macOS/Linux can cause posix_spawnp failures
			const spawnOptions: Record<string, unknown> = {
				name: "xterm-256color",
				cols: options.cols,
				rows: options.rows,
				cwd: options.cwd,
				env: options.env,
				encoding: "utf8",
			};

			// Only enable ConPTY on Windows for proper emoji/UTF-8 support
			// ConPTY (Windows Pseudo Console) is required for proper emoji rendering on Windows
			// WinPTY does not support emoji/wide characters correctly
			if (isWindows) {
				spawnOptions.useConpty = true;
			}

			// Sanitize environment variables - ensure all values are strings
			if (options.env) {
				const envKeys = Object.keys(options.env);
				for (const key of envKeys) {
					const val = options.env[key];
					if (typeof val !== "string") {
						options.env[key] =
							val === undefined || val === null
								? ""
								: String(val);
					}
				}
			}

			// Create PTY process
			const pty = nodePty.spawn(
				options.shell,
				options.args || [],
				spawnOptions,
			) as IPty;

			// Track the PTY process
			this.activePTYs.add(pty);

			// Set up error handling
			pty.on("error", (error: Error) => {
				console.error("PTY process error:", error);
				this.activePTYs.delete(pty);
			});

			pty.on("exit", (exitCode: number, signal?: number) => {
				console.log(
					`PTY process exited with code ${exitCode}, signal ${signal}`,
				);
				this.activePTYs.delete(pty);
			});

			return pty;
		} catch (error) {
			console.error("PTY creation failed:", error);

			if (error instanceof TerminalPluginError) {
				throw error;
			}

			throw new TerminalPluginError(
				TerminalErrorType.PTY_CREATION_FAILED,
				`Failed to create PTY process: ${(error as Error)?.message || error}`,
				error as Error,
				{ options },
			);
		}
	}

	/**
	 * Destroy a PTY process and clean up resources
	 *
	 * On Windows, calling pty.kill() directly via @electron/remote can trigger
	 * Obsidian's Start Screen window to appear (likely due to signal handling
	 * in the main process). To avoid this, we use a graceful shutdown approach:
	 * 1. Send Ctrl+C (SIGINT equivalent) to allow the shell to clean up
	 * 2. Send 'exit' command as a fallback
	 * 3. Let the process terminate naturally
	 *
	 * The PTY will be garbage collected after removal from tracking.
	 */
	destroyPTY(pty: IPty): void {
		try {
			if (this.activePTYs.has(pty)) {
				// Remove from tracking first
				this.activePTYs.delete(pty);

				// Remove all listeners BEFORE termination to prevent exit event handling
				pty.removeAllListeners();

				// Graceful shutdown: send Ctrl+C and exit command instead of kill()
				// This avoids triggering Obsidian's Start Screen on Windows
				try {
					// Send Ctrl+C (ETX) to interrupt any running process
					pty.write("\x03");
					// Send exit command to terminate the shell
					pty.write("exit\r");
				} catch (error) {
					// Process may already be dead, ignore write errors
					console.warn("Failed to send exit signal to PTY:", error);
				}

				// Note: We intentionally do NOT call pty.kill() here
				// The process will terminate naturally after receiving exit command
				// or will be cleaned up when the PTY object is garbage collected
			}
		} catch (error) {
			throw new TerminalPluginError(
				TerminalErrorType.PTY_CREATION_FAILED,
				"Failed to destroy PTY process",
				error as Error,
			);
		}
	}

	/**
	 * Get default shell for current platform
	 * Prioritizes user settings over system defaults, with fallback if invalid
	 */
	getDefaultShell(): string {
		// First, check user settings
		if (this.settingsProvider) {
			const settings = this.settingsProvider();
			if (settings?.defaultShell) {
				// Validate the user-configured shell exists
				if (
					this.electronBridge.validateShellSync(settings.defaultShell)
				) {
					return settings.defaultShell;
				}
				console.warn(
					`Configured shell "${settings.defaultShell}" is invalid, falling back to system default`,
				);
			}
		}

		// Fall back to system default
		return this.getSystemDefaultShell();
	}

	/**
	 * Get system default shell (without user settings)
	 */
	private getSystemDefaultShell(): string {
		try {
			return this.electronBridge.getDefaultShell();
		} catch (error) {
			// Fallback to basic shell detection
			const proc = this.electronBridge.getProcess();
			switch (proc.platform) {
				case "win32":
					return "cmd.exe";
				case "darwin":
					return "/bin/zsh";
				case "linux":
					return "/bin/bash";
				default:
					return "/bin/sh";
			}
		}
	}

	/**
	 * Get default PTY options for current environment
	 */
	getDefaultOptions(): PTYOptions {
		const baseEnv = this.electronBridge.getEnvironmentVariables();
		const proc = this.electronBridge.getProcess();

		// Set up UTF-8 encoding environment
		const utf8Env: any = {
			...baseEnv,
			// Force UTF-8 encoding
			LANG: baseEnv.LANG || "zh_CN.UTF-8",
			LC_ALL: baseEnv.LC_ALL || "zh_CN.UTF-8",
			LC_CTYPE: baseEnv.LC_CTYPE || "zh_CN.UTF-8",
		};

		// Platform-specific encoding setup
		if (proc.platform === "win32") {
			utf8Env.CHCP = "65001"; // UTF-8 code page for Windows
			utf8Env.PYTHONIOENCODING = "utf-8";
		}

		// Get shell args from settings if available
		const settings = this.settingsProvider?.();
		const shellArgs = settings?.shellArgs ?? [];

		return {
			shell: this.getDefaultShell(),
			args: shellArgs,
			cwd: this.electronBridge.getCurrentWorkingDirectory(),
			env: utf8Env,
			cols: DEFAULT_TERMINAL_DIMENSIONS.cols,
			rows: DEFAULT_TERMINAL_DIMENSIONS.rows,
		};
	}

	/**
	 * Resize all active PTY processes
	 */
	resizeAllPTYs(cols: number, rows: number): void {
		this.activePTYs.forEach((pty) => {
			try {
				pty.resize(cols, rows);
			} catch (error) {
				console.warn("Failed to resize PTY:", error);
			}
		});
	}

	/**
	 * Get count of active PTY processes
	 */
	getActivePTYCount(): number {
		return this.activePTYs.size;
	}

	/**
	 * Clean up all active PTY processes
	 */
	cleanup(): void {
		const ptysToDestroy = Array.from(this.activePTYs);
		ptysToDestroy.forEach((pty) => {
			this.destroyPTY(pty);
		});
		this.activePTYs.clear();
	}

	/**
	 * Validate if shell path exists and is executable
	 */
	validateShellPath(shellPath: string): boolean {
		try {
			return this.electronBridge.validateShellSync(shellPath);
		} catch (error) {
			console.warn("Shell validation check failed:", error);
			return false;
		}
	}

	/**
	 * Get alternative shells for current platform
	 */
	getAlternativeShells(): string[] {
		const proc = this.electronBridge.getProcess();

		switch (proc.platform) {
			case "win32":
				return ["powershell.exe", "cmd.exe"];
			case "darwin":
				return ["/bin/zsh", "/bin/bash", "/bin/sh"];
			case "linux":
				return ["/bin/bash", "/bin/sh", "/bin/zsh"];
			default:
				return ["/bin/sh"];
		}
	}

	/**
	 * Find the first available shell from alternatives
	 */
	async findAvailableShell(): Promise<string> {
		const alternatives = this.getAlternativeShells();

		for (const shell of alternatives) {
			try {
				const isValid = await this.electronBridge.validateShell(shell);
				if (isValid) {
					return shell;
				}
			} catch (error) {
				continue;
			}
		}

		// Return default if no alternatives work
		return this.getDefaultShell();
	}

	/**
	 * Validate and resolve the current working directory
	 * Ensures the directory exists and has proper permissions (R_OK + X_OK)
	 * Falls back to HOME directory if validation fails
	 *
	 * @param cwd - The desired working directory
	 * @returns A valid working directory path
	 */
	private validateAndResolveCwd(cwd: string): string {
		const fs = require("fs");

		try {
			// First check if path exists
			if (!fs.existsSync(cwd)) {
				throw new Error("Path does not exist");
			}

			// Check for Read and Execute permissions
			// R_OK: Readable, X_OK: Executable/Searchable (needed to enter directory)
			// This is crucial for posix_spawn which requires directory execute permission
			fs.accessSync(cwd, fs.constants.R_OK | fs.constants.X_OK);
			return cwd;
		} catch (cwdError) {
			const errorMsg =
				cwdError instanceof Error ? cwdError.message : String(cwdError);
			console.warn(`CWD validation failed for "${cwd}": ${errorMsg}`);

			// Fall back to HOME directory
			const home = process.env.HOME || process.env.USERPROFILE || "/";

			// Validate HOME as well
			try {
				fs.accessSync(home, fs.constants.R_OK | fs.constants.X_OK);
				return home;
			} catch {
				// Last resort: use root or temp directory
				const fallback =
					process.platform === "win32"
						? process.env.TEMP || "C:\\"
						: "/tmp";
				return fallback;
			}
		}
	}
}
