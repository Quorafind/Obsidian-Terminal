/**
 * Electron Bridge Implementation
 *
 * Provides access to Electron/Node.js APIs and manages PTY processes.
 * Uses @electron/remote to load node-pty in Electron's main process.
 *
 * @module electron-bridge
 */

import {
	ElectronBridge as BaseElectronBridge,
	TerminalPluginError,
	TerminalErrorType,
} from "@/types";

/**
 * Electron bridge implementation using @electron/remote for PTY loading
 */
export class ElectronBridge extends BaseElectronBridge {
	private _electronAvailable: boolean | null = null;
	private _pluginDirectory: string | null = null;
	private _vaultPath: string | null = null;
	private _nodePty: typeof import("node-pty") | null = null;
	private _initialized = false;

	/**
	 * Set the plugin directory path
	 */
	setPluginDirectory(pluginDirectory: string): void {
		this._pluginDirectory = pluginDirectory;
		console.log("🔧 Plugin directory set to:", pluginDirectory);
	}

	/**
	 * Set the vault path
	 */
	setVaultPath(vaultPath: string): void {
		this._vaultPath = vaultPath;
		console.log("🗂️ Vault path set to:", vaultPath);
	}

	/**
	 * Check if running in Electron environment
	 */
	isElectronAvailable(): boolean {
		if (this._electronAvailable !== null) {
			return this._electronAvailable;
		}

		try {
			this._electronAvailable =
				typeof window !== "undefined" &&
				typeof window.require === "function" &&
				typeof process !== "undefined" &&
				process.versions?.electron !== undefined;

			return this._electronAvailable;
		} catch {
			this._electronAvailable = false;
			return false;
		}
	}

	/**
	 * Safely require a module using Electron's require
	 */
	requireModule(moduleName: string): any {
		if (
			typeof window !== "undefined" &&
			typeof window.require === "function"
		) {
			return window.require(moduleName);
		}

		if (typeof require === "function") {
			return require(moduleName);
		}

		throw new TerminalPluginError(
			TerminalErrorType.ELECTRON_NOT_AVAILABLE,
			`Cannot require module: ${moduleName}`,
		);
	}

	/**
	 * Get process object safely
	 */
	getProcess(): NodeJS.Process {
		if (typeof process === "undefined") {
			throw new TerminalPluginError(
				TerminalErrorType.ELECTRON_NOT_AVAILABLE,
				"Process object is undefined",
			);
		}
		return process;
	}

	/**
	 * Get default shell for current platform
	 */
	getDefaultShell(): string {
		const proc = this.getProcess();

		switch (proc.platform) {
			case "win32":
				return "powershell.exe";
			case "darwin":
				return "/bin/zsh";
			case "linux":
				return "/bin/bash";
			default:
				return "/bin/sh";
		}
	}

	/**
	 * Get current working directory
	 */
	getCurrentWorkingDirectory(): string {
		if (this._vaultPath) {
			return this._vaultPath;
		}

		try {
			return this.getProcess().cwd();
		} catch {
			return process.cwd();
		}
	}

	/**
	 * Get environment variables
	 */
	getEnvironmentVariables(): Record<string, string> {
		const proc = this.getProcess();
		const env: Record<string, string> = {};

		for (const [key, value] of Object.entries(proc.env)) {
			if (value !== undefined) {
				env[key] = value;
			}
		}

		return env;
	}

	/**
	 * Initialize node-pty loading via @electron/remote
	 * This loads node-pty in Electron's main process
	 */
	private async initializeNodePty(): Promise<void> {
		if (this._initialized) {
			return;
		}

		console.log("🚀 Initializing node-pty via @electron/remote...");

		// Get @electron/remote module
		let remote: any;
		try {
			remote = this.requireModule("@electron/remote");
			console.log("✅ @electron/remote loaded");
		} catch (e) {
			try {
				remote = (window as any).require("@electron/remote");
				console.log("✅ @electron/remote loaded via window.require");
			} catch (e2) {
				throw new TerminalPluginError(
					TerminalErrorType.NODE_PTY_NOT_AVAILABLE,
					"@electron/remote is not available. This plugin requires Obsidian desktop.",
				);
			}
		}

		if (!remote || typeof remote.require !== "function") {
			throw new TerminalPluginError(
				TerminalErrorType.NODE_PTY_NOT_AVAILABLE,
				"@electron/remote.require is not available",
			);
		}

		// Load node-pty from plugin's node_modules
		const path = this.requireModule("path");
		const pluginDir = this._pluginDirectory || process.cwd();
		const nodePtyPath = path.join(pluginDir, "node_modules", "node-pty");

		console.log("🔍 Loading node-pty from:", nodePtyPath);

		try {
			const nodePty = remote.require(nodePtyPath);

			if (!nodePty || typeof nodePty.spawn !== "function") {
				throw new Error("node-pty.spawn is not a function");
			}

			this._nodePty = nodePty;
			this._initialized = true;
			console.log("✅ node-pty loaded successfully");
		} catch (error) {
			const errorMessage = (error as Error)?.message || String(error);
			console.error("❌ Failed to load node-pty:", errorMessage);

			throw new TerminalPluginError(
				TerminalErrorType.NODE_PTY_NOT_AVAILABLE,
				`Failed to load node-pty: ${errorMessage}. ` +
					"Please ensure native modules are installed (Settings → Terminal → Download Native Modules).",
			);
		}
	}

	/**
	 * Get node-pty module (synchronous, requires prior initialization)
	 */
	getNodePTY(): typeof import("node-pty") | null {
		return this._nodePty;
	}

	/**
	 * Get node-pty module (async, initializes if needed)
	 */
	async getNodePTYAsync(): Promise<typeof import("node-pty")> {
		await this.initializeNodePty();

		if (!this._nodePty) {
			throw new TerminalPluginError(
				TerminalErrorType.NODE_PTY_NOT_AVAILABLE,
				"node-pty failed to initialize",
			);
		}

		return this._nodePty;
	}

	/**
	 * Get current PTY loading mode (always "remote" now)
	 */
	getPtyLoadMode(): "remote" | null {
		return this._initialized ? "remote" : null;
	}

	/**
	 * Validate if a shell exists and is executable
	 */
	async validateShell(shellPath: string): Promise<boolean> {
		try {
			const fs = this.requireModule("fs");
			const proc = this.getProcess();

			// On Windows, PowerShell and cmd are always available
			if (proc.platform === "win32") {
				if (
					shellPath.toLowerCase().includes("powershell") ||
					shellPath.toLowerCase().includes("cmd.exe")
				) {
					return true;
				}
			}

			return fs.existsSync(shellPath);
		} catch {
			return false;
		}
	}

	/**
	 * Cleanup resources on plugin unload
	 */
	cleanup(): void {
		this._nodePty = null;
		this._initialized = false;
		console.log("✅ Cleaned up ElectronBridge resources");
	}
}
