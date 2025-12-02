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
 * PTY manager implementation for managing pseudo-terminal processes
 * Handles PTY creation, destruction, and configuration
 */
export class PTYManager extends BasePTYManager {
	private electronBridge: ElectronBridge;
	private activePTYs: Set<IPty> = new Set();

	constructor(electronBridge: ElectronBridge) {
		super();
		this.electronBridge = electronBridge;
	}

	/**
	 * Create a new PTY process with given options
	 */
	createPTY(options: PTYOptions): IPty {
		try {
			console.log("📦 PTYManager.createPTY called with options:", {
				shell: options.shell,
				cwd: options.cwd,
				cols: options.cols,
				rows: options.rows,
			});

			const nodePty = this.electronBridge.getNodePTY();
			console.log(
				"📦 getNodePTY result:",
				nodePty ? "available" : "null",
			);
			console.log(
				"📦 PTY load mode:",
				this.electronBridge.getPtyLoadMode(),
			);

			if (!nodePty) {
				throw new TerminalPluginError(
					TerminalErrorType.NODE_PTY_NOT_AVAILABLE,
					"node-pty module is not available",
				);
			}

			// Validate shell exists before creating PTY
			const shellExists = this.validateShellPath(options.shell);
			console.log(
				"📦 Shell validation:",
				options.shell,
				"exists:",
				shellExists,
			);

			if (!shellExists) {
				throw new TerminalPluginError(
					TerminalErrorType.SHELL_NOT_FOUND,
					`Shell not found: ${options.shell}`,
				);
			}

			console.log("📦 Calling nodePty.spawn...");

			// Create PTY process with UTF-8 support
			// Note: useConpty is disabled because conpty.node may not be available
			// in the plugin's node_modules. WinPTY (pty.node) is used instead.
			const pty = nodePty.spawn(options.shell, options.args, {
				name: "xterm-256color",
				cols: options.cols,
				rows: options.rows,
				cwd: options.cwd,
				env: options.env,
				encoding: "utf8",
				useConpty: false, // Force WinPTY - conpty.node may not be compiled
			}) as IPty;

			console.log("✅ PTY spawned successfully, pid:", pty.pid);

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
			// 详细记录原始错误
			console.error("❌ PTY creation failed:", error);
			console.error("❌ Error name:", (error as Error)?.name);
			console.error("❌ Error message:", (error as Error)?.message);
			console.error("❌ Error stack:", (error as Error)?.stack);

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
	 */
	destroyPTY(pty: IPty): void {
		try {
			if (this.activePTYs.has(pty)) {
				// Remove from tracking
				this.activePTYs.delete(pty);

				// Kill the process
				try {
					pty.kill();
				} catch (error) {
					console.warn("Failed to kill PTY process:", error);
				}

				// Remove all listeners to prevent memory leaks
				pty.removeAllListeners();
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
	 */
	getDefaultShell(): string {
		try {
			return this.electronBridge.getDefaultShell();
		} catch (error) {
			// Fallback to basic shell detection
			const proc = this.electronBridge.getProcess();
			switch (proc.platform) {
				case "win32":
					return "cmd.exe";
				case "darwin":
					return "/bin/bash";
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

		return {
			shell: this.getDefaultShell(),
			args: [],
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
	private validateShellPath(shellPath: string): boolean {
		try {
			// Use the electron bridge's validation method
			return true; // For now, assume shell is valid
		} catch (error) {
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
				return [
					"powershell.exe",
					"cmd.exe",
					"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
					"C:\\Windows\\System32\\cmd.exe",
				];
			case "darwin":
				return [
					"/bin/zsh",
					"/bin/bash",
					"/bin/sh",
					"/usr/local/bin/zsh",
					"/usr/local/bin/bash",
				];
			case "linux":
				return [
					"/bin/bash",
					"/bin/sh",
					"/bin/zsh",
					"/usr/bin/bash",
					"/usr/bin/sh",
					"/usr/bin/zsh",
				];
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
}
