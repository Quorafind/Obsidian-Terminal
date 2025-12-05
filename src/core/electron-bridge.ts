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
	 * Get Electron version
	 * @returns Electron version string or null if not available
	 */
	getElectronVersion(): string | null {
		try {
			return process.versions.electron || null;
		} catch {
			return null;
		}
	}

	/**
	 * Get Obsidian version information
	 * @returns Object containing Obsidian and installer versions
	 */
	getObsidianVersion(): {
		obsidianVersion: string | null;
		installerVersion: string | null;
		error?: string;
	} {
		try {
			// Try to get @electron/remote or electron.remote
			let remote: any;
			try {
				remote = this.requireModule("@electron/remote");
			} catch {
				try {
					remote = (window as any).require("@electron/remote");
				} catch {
					// Try old electron.remote API
					const electron = this.requireModule("electron");
					remote = electron?.remote;
				}
			}

			if (!remote) {
				return {
					obsidianVersion: null,
					installerVersion: null,
					error: "@electron/remote not available",
				};
			}

			// Get Obsidian version via IPC
			let obsidianVersion: string | null = null;
			try {
				const { ipcRenderer } = this.requireModule("electron");
				if (ipcRenderer && typeof ipcRenderer.sendSync === "function") {
					obsidianVersion = ipcRenderer.sendSync("version");
				}
			} catch (e) {
				console.warn("Failed to get Obsidian version via IPC:", e);
			}

			// Get installer version via remote.app
			let installerVersion: string | null = null;
			try {
				if (remote.app && typeof remote.app.getVersion === "function") {
					installerVersion = remote.app.getVersion();
				}
			} catch (e) {
				console.warn("Failed to get installer version:", e);
			}

			return {
				obsidianVersion,
				installerVersion,
			};
		} catch (error) {
			return {
				obsidianVersion: null,
				installerVersion: null,
				error: (error as Error).message || String(error),
			};
		}
	}

	/**
	 * Get all version information for debugging
	 */
	getVersionInfo(): {
		electron: string | null;
		obsidian: string | null;
		installer: string | null;
		node: string | null;
		chrome: string | null;
		platform: string;
	} {
		const { obsidianVersion, installerVersion } = this.getObsidianVersion();

		return {
			electron: this.getElectronVersion(),
			obsidian: obsidianVersion,
			installer: installerVersion,
			node: process.versions.node || null,
			chrome: process.versions.chrome || null,
			platform: process.platform,
		};
	}

	/**
	 * Parse version string to comparable number
	 * Examples: "1.5.3" -> [1, 5, 3], "1.5.3-beta" -> [1, 5, 3]
	 */
	private parseVersion(version: string): number[] {
		try {
			// Remove 'v' prefix and beta/alpha suffixes
			const cleaned = version.replace(/^v/, "").split("-")[0];
			return cleaned.split(".").map((n) => parseInt(n, 10) || 0);
		} catch {
			return [0, 0, 0];
		}
	}

	/**
	 * Compare two versions
	 * Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
	 */
	private compareVersions(v1: string, v2: string): number {
		const parts1 = this.parseVersion(v1);
		const parts2 = this.parseVersion(v2);

		for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
			const p1 = parts1[i] || 0;
			const p2 = parts2[i] || 0;

			if (p1 < p2) return -1;
			if (p1 > p2) return 1;
		}

		return 0;
	}

	/**
	 * Check if installer version needs update
	 * @returns Object with needsUpdate flag and reason
	 */
	checkInstallerVersion(): {
		needsUpdate: boolean;
		reason: string | null;
		obsidianVersion: string | null;
		installerVersion: string | null;
	} {
		const { obsidianVersion, installerVersion, error } =
			this.getObsidianVersion();

		// Cannot determine if version info is unavailable
		if (error || !obsidianVersion || !installerVersion) {
			return {
				needsUpdate: false,
				reason: null,
				obsidianVersion,
				installerVersion,
			};
		}

		// Compare versions
		const comparison = this.compareVersions(
			installerVersion,
			obsidianVersion,
		);

		// Installer version is older than Obsidian version
		if (comparison < 0) {
			return {
				needsUpdate: true,
				reason: `Installer version (${installerVersion}) is older than Obsidian version (${obsidianVersion}). Please reinstall Obsidian to update the installer.`,
				obsidianVersion,
				installerVersion,
			};
		}

		return {
			needsUpdate: false,
			reason: null,
			obsidianVersion,
			installerVersion,
		};
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
				return "/bin/bash";
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
	 * Automatically fixes PATH on macOS/Linux to include common system paths
	 */
	getEnvironmentVariables(): Record<string, string> {
		const proc = this.getProcess();
		const env: Record<string, string> = {};

		for (const [key, value] of Object.entries(proc.env)) {
			if (value !== undefined) {
				env[key] = value;
			}
		}

		// Fix PATH for macOS/Linux GUI environment
		// GUI apps often inherit a stripped-down PATH (e.g. /usr/bin:/bin)
		if (proc.platform === "darwin" || proc.platform === "linux") {
			this.fixPath(env);
		}

		return env;
	}

	/**
	 * Manually fix PATH for GUI apps by prepending common system paths
	 * macOS GUI apps don't inherit PATH from shell config files (.zshrc, .bashrc)
	 */
	private fixPath(env: Record<string, string>): void {
		const currentPath = env.PATH || "";

		// Common paths often missing in GUI apps
		// Order matters: user installed binaries (homebrew) should take precedence
		const candidates = [
			"/opt/homebrew/bin", // Apple Silicon Homebrew
			"/opt/homebrew/sbin",
			"/usr/local/bin", // Intel Homebrew / user binaries
			"/usr/local/sbin",
			"/usr/bin",
			"/bin",
			"/usr/sbin",
			"/sbin",
		];

		// Add user home bin directories if HOME is available
		const home = env.HOME || process.env.HOME;
		if (home) {
			candidates.push(`${home}/.local/bin`);
			candidates.push(`${home}/bin`);
		}

		const existing = new Set(currentPath.split(":"));
		const toAdd = candidates.filter((p) => !existing.has(p));

		if (toAdd.length > 0) {
			// Prepend to ensure they are found first
			env.PATH = toAdd.join(":") + (currentPath ? ":" + currentPath : "");
			console.log("🔧 Fixed PATH for GUI environment");
		}
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

		// Load node-pty: first try native/ (downloaded), then node_modules/ (dev)
		const path = this.requireModule("path");
		const fs = this.requireModule("fs");
		const pluginDir = this._pluginDirectory || process.cwd();

		let nodePtyPath = path.join(pluginDir, "native", "node-pty");
		if (!fs.existsSync(nodePtyPath)) {
			// Fallback to node_modules for development
			nodePtyPath = path.join(pluginDir, "node_modules", "node-pty");
		}

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
	 * Validate if a shell exists and is executable (Synchronous)
	 * Uses fs.accessSync with X_OK flag to check execution permission
	 */
	validateShellSync(shellPath: string): boolean {
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
				return fs.existsSync(shellPath);
			}

			// On macOS/Linux, check for execution permission (X_OK)
			// This is crucial to prevent "posix_spawnp failed" errors
			try {
				fs.accessSync(shellPath, fs.constants.X_OK);
				return true;
			} catch {
				console.warn(
					`Shell validation failed for ${shellPath}: No execution permission or file not found.`,
				);
				return false;
			}
		} catch (error) {
			console.error("Shell validation error:", error);
			return false;
		}
	}

	/**
	 * Validate if a shell exists and is executable
	 */
	async validateShell(shellPath: string): Promise<boolean> {
		return this.validateShellSync(shellPath);
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
