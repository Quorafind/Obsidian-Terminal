/**
 * Electron Bridge Implementation
 *
 * Provides access to Electron/Node.js APIs and manages PTY processes.
 *
 * Loading Strategy (in priority order):
 * 1. @electron/remote - Direct loading in main process (preferred)
 * 2. PTY Host Sidecar - Separate Node.js process with IPC (fallback)
 *
 * @module electron-bridge
 */

import {
	ElectronBridge as BaseElectronBridge,
	TerminalPluginError,
	TerminalErrorType,
	IpcMessageType,
	IpcMethod,
	IpcEvent,
	type IpcResponse,
	type IpcEventMessage,
	type CreatePtyResult,
} from "@/types";
import { RemotePty } from "./remote-pty";

/**
 * Pending request tracker
 */
interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * PTY Host process state
 */
interface PtyHostState {
	process: any; // ChildProcess
	ready: boolean;
	readyPromise: Promise<void>;
	readyResolve?: () => void;
	readyReject?: (error: Error) => void;
}

/**
 * PTY loading mode
 */
type PtyLoadMode = "remote" | "sidecar" | null;

/**
 * Default timeout for RPC requests (ms)
 */
const RPC_TIMEOUT = 30000;

/**
 * Electron bridge implementation with multiple PTY loading strategies
 */
export class ElectronBridge extends BaseElectronBridge {
	private _electronAvailable: boolean | null = null;
	private _pluginDirectory: string | null = null;
	private _vaultPath: string | null = null;

	// PTY loading mode
	private _ptyLoadMode: PtyLoadMode = null;
	private _directNodePty: typeof import("node-pty") | null = null;

	// PTY Host Sidecar management (fallback mode)
	private hostState: PtyHostState | null = null;
	private messageId = 0;
	private pendingRequests = new Map<string, PendingRequest>();
	private activePtys = new Map<number, RemotePty>();

	// Temporary PID to RemotePty mapping (before real PID is assigned)
	private tempPidMap = new Map<number, RemotePty>();

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

	// ============================================================
	// Strategy 1: @electron/remote (Preferred)
	// ============================================================

	/**
	 * Try to load node-pty using @electron/remote
	 * This runs node-pty in the main process, avoiding sidecar overhead
	 */
	private async tryLoadViaElectronRemote(): Promise<
		typeof import("node-pty") | null
	> {
		try {
			console.log("🔍 Trying to load node-pty via @electron/remote...");

			// Try to get @electron/remote module
			let remote: any;
			try {
				remote = this.requireModule("@electron/remote");
				console.log("✅ @electron/remote loaded via requireModule");
			} catch (e) {
				console.log(
					"⚠️ @electron/remote not available via requireModule:",
					(e as Error)?.message,
				);
				try {
					remote = (window as any).require("@electron/remote");
					console.log(
						"✅ @electron/remote loaded via window.require",
					);
				} catch (e2) {
					console.log(
						"⚠️ @electron/remote not available via window.require:",
						(e2 as Error)?.message,
					);
					return null;
				}
			}

			if (!remote) {
				console.log("❌ @electron/remote is null/undefined");
				return null;
			}

			console.log(
				"📦 @electron/remote object keys:",
				Object.keys(remote),
			);

			if (typeof remote.require !== "function") {
				console.log(
					"❌ @electron/remote.require is not a function, type:",
					typeof remote.require,
				);
				return null;
			}

			// Use remote.require to load node-pty in main process
			const path = this.requireModule("path");
			const pluginDir = this._pluginDirectory || process.cwd();

			// Try loading from plugin's node_modules first
			const nodePtyPaths = [
				path.join(pluginDir, "node_modules", "node-pty"),
				"node-pty", // Global fallback
			];

			console.log(
				"🔍 Will try to load node-pty from paths:",
				nodePtyPaths,
			);

			for (const ptyPath of nodePtyPaths) {
				try {
					console.log(`🔍 Trying to load node-pty from: ${ptyPath}`);
					const nodePty = remote.require(ptyPath);

					if (nodePty && typeof nodePty.spawn === "function") {
						console.log(
							"✅ node-pty loaded via @electron/remote from:",
							ptyPath,
						);
						console.log(
							"📦 node-pty exports:",
							Object.keys(nodePty),
						);
						return nodePty;
					} else {
						console.log(
							"⚠️ node-pty loaded but spawn is not a function:",
							typeof nodePty?.spawn,
						);
					}
				} catch (err) {
					console.log(
						`❌ Failed to load node-pty from ${ptyPath}:`,
						(err as Error)?.message,
					);
					console.log("❌ Full error:", err);
				}
			}

			console.log("❌ node-pty not found via @electron/remote");
			return null;
		} catch (error) {
			console.log("❌ Failed to load via @electron/remote:", error);
			return null;
		}
	}

	// ============================================================
	// Strategy 2: PTY Host Sidecar (Fallback)
	// ============================================================

	/**
	 * 尝试使用 Obsidian 内置的 Electron Node 环境
	 * 返回 Electron 可执行文件路径（如果可用于 ELECTRON_RUN_AS_NODE 模式）
	 */
	private async tryObsidianNodeEnvironment(): Promise<string | null> {
		try {
			const proc = this.getProcess();
			const fs = this.requireModule("fs");

			// 获取 Electron 可执行文件路径
			// process.execPath 在 Electron 环境中指向 Electron/Obsidian 可执行文件
			const electronPath = proc.execPath;

			if (!electronPath || !fs.existsSync(electronPath)) {
				console.debug(
					"Electron executable not found at:",
					electronPath,
				);
				return null;
			}

			// 验证是否可以在 ELECTRON_RUN_AS_NODE 模式下运行
			// 通过执行简单的 Node.js 命令来测试
			const cp = this.requireModule("child_process");

			try {
				const testResult = cp.execSync(
					`"${electronPath}" -e "console.log('NODE_TEST_OK')"`,
					{
						encoding: "utf8",
						timeout: 5000,
						windowsHide: true,
						env: {
							...proc.env,
							ELECTRON_RUN_AS_NODE: "1",
						},
					},
				);

				if (testResult.includes("NODE_TEST_OK")) {
					console.log(
						"✅ Obsidian Electron can run as Node.js:",
						electronPath,
					);
					return electronPath;
				}
			} catch (testError) {
				console.debug(
					"Obsidian Electron ELECTRON_RUN_AS_NODE test failed:",
					testError,
				);
			}

			return null;
		} catch (error) {
			console.debug("Failed to check Obsidian Node environment:", error);
			return null;
		}
	}

	/**
	 * Find Node.js executable path
	 * Priority: 1. Obsidian internal Electron  2. System Node.js
	 */
	private async findNodePath(): Promise<{
		path: string;
		useElectronMode: boolean;
	} | null> {
		// 策略 1: 尝试使用 Obsidian 内置 Electron 环境
		console.log("🔍 Trying Obsidian internal Node environment...");
		const obsidianNode = await this.tryObsidianNodeEnvironment();
		if (obsidianNode) {
			return { path: obsidianNode, useElectronMode: true };
		}
		console.log(
			"⚠️ Obsidian internal Node not available, falling back to system Node.js",
		);

		// 策略 2: 回退到系统 Node.js
		const systemNode = await this.findSystemNodePath();
		if (systemNode) {
			return { path: systemNode, useElectronMode: false };
		}

		return null;
	}

	/**
	 * Find system Node.js executable path
	 * Searches common locations and PATH
	 */
	private async findSystemNodePath(): Promise<string | null> {
		const cp = this.requireModule("child_process");
		const fs = this.requireModule("fs");
		const path = this.requireModule("path");
		const proc = this.getProcess();

		// Platform-specific node executable name
		const isWindows = proc.platform === "win32";
		const nodeExe = isWindows ? "node.exe" : "node";

		// Try 'where' (Windows) or 'which' (Unix) to find node in PATH
		try {
			const command = isWindows ? "where node" : "which node";
			const result = cp.execSync(command, {
				encoding: "utf8",
				timeout: 5000,
				windowsHide: true,
			});
			const nodePath = result.trim().split(/\r?\n/)[0];
			if (nodePath && fs.existsSync(nodePath)) {
				console.log("✅ Found Node.js via PATH:", nodePath);
				return nodePath;
			}
		} catch {
			console.debug("Node.js not found in PATH");
		}

		// Check common installation paths
		const commonPaths = isWindows
			? [
					path.join(
						proc.env.ProgramFiles || "C:\\Program Files",
						"nodejs",
						nodeExe,
					),
					path.join(
						proc.env["ProgramFiles(x86)"] ||
							"C:\\Program Files (x86)",
						"nodejs",
						nodeExe,
					),
					path.join(
						proc.env.LOCALAPPDATA || "",
						"Programs",
						"node",
						nodeExe,
					),
					// nvm-windows
					path.join(proc.env.NVM_HOME || "", "current", nodeExe),
					// volta
					path.join(
						proc.env.VOLTA_HOME || "",
						"bin",
						nodeExe.replace(".exe", ".cmd"),
					),
				]
			: [
					"/usr/local/bin/node",
					"/usr/bin/node",
					"/opt/homebrew/bin/node",
					// nvm
					path.join(
						proc.env.HOME || "",
						".nvm",
						"current",
						"bin",
						"node",
					),
					// volta
					path.join(proc.env.HOME || "", ".volta", "bin", "node"),
				];

		for (const testPath of commonPaths) {
			if (testPath && fs.existsSync(testPath)) {
				console.log("✅ Found Node.js at:", testPath);
				return testPath;
			}
		}

		console.error("❌ System Node.js not found");
		return null;
	}

	/**
	 * Ensure the PTY host process is running
	 */
	private async ensureHostProcess(): Promise<void> {
		// Already running and ready
		if (this.hostState?.process && !this.hostState.process.killed) {
			if (this.hostState.ready) {
				return;
			}
			// Wait for ready signal
			return this.hostState.readyPromise;
		}

		console.log("🚀 Starting PTY Sidecar process...");

		const cp = this.requireModule("child_process");
		const path = this.requireModule("path");
		const fs = this.requireModule("fs");

		const pluginDir = this._pluginDirectory || process.cwd();
		const scriptPath = path.join(pluginDir, "pty-host.js");

		// Verify script exists
		if (!fs.existsSync(scriptPath)) {
			throw new TerminalPluginError(
				TerminalErrorType.PTY_CREATION_FAILED,
				`PTY host script not found at: ${scriptPath}`,
			);
		}

		// Create ready promise with timeout
		let readyResolve: () => void;
		let readyReject: (error: Error) => void;
		const readyPromise = new Promise<void>((resolve, reject) => {
			readyResolve = resolve;
			readyReject = reject;

			// Timeout after 10 seconds to prevent infinite blocking
			setTimeout(() => {
				reject(
					new TerminalPluginError(
						TerminalErrorType.PTY_CREATION_FAILED,
						"PTY Sidecar failed to start within 10 seconds",
					),
				);
			}, 10000);
		});

		console.log("📍 scriptPath:", scriptPath);

		// 策略: 优先使用 Obsidian 内置 Node 环境，失败则回退到系统 Node.js
		const nodeInfo = await this.findNodePath();

		if (!nodeInfo) {
			throw new TerminalPluginError(
				TerminalErrorType.PTY_CREATION_FAILED,
				"Node.js not found. Please install Node.js to use the terminal plugin, or check if Obsidian's Electron environment supports ELECTRON_RUN_AS_NODE.",
			);
		}

		console.log("📍 nodePath:", nodeInfo.path);
		console.log("📍 useElectronMode:", nodeInfo.useElectronMode);

		// 根据 Node 来源配置环境变量
		const spawnEnv: Record<string, string | undefined> = {
			...process.env,
		};

		if (nodeInfo.useElectronMode) {
			// 使用 Obsidian 内置 Electron 时，需要设置 ELECTRON_RUN_AS_NODE
			spawnEnv.ELECTRON_RUN_AS_NODE = "1";
		} else {
			// 使用系统 Node.js 时，移除 Electron 相关环境变量避免干扰
			spawnEnv.ELECTRON_RUN_AS_NODE = undefined;
		}

		// 启动 PTY Host 进程
		const hostProcess = cp.spawn(nodeInfo.path, [scriptPath], {
			env: spawnEnv,
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			cwd: pluginDir,
		});

		this.hostState = {
			process: hostProcess,
			ready: false,
			readyPromise,
			readyResolve: readyResolve!,
			readyReject: readyReject!,
		};

		// Setup message handling
		this.setupHostMessageHandling(hostProcess);

		// Handle process exit
		hostProcess.on("exit", (code: number | null, signal: string | null) => {
			console.log(
				`PTY Sidecar exited with code ${code}, signal ${signal}`,
			);
			// If not ready yet, reject the promise
			if (this.hostState && !this.hostState.ready) {
				this.hostState.readyReject?.(
					new TerminalPluginError(
						TerminalErrorType.PTY_CREATION_FAILED,
						`PTY Sidecar process exited unexpectedly (code: ${code}, signal: ${signal})`,
					),
				);
			}
			this.handleHostExit();
		});

		hostProcess.on("error", (err: Error) => {
			console.error("PTY Sidecar spawn error:", err);
			// Reject the ready promise on spawn error
			if (this.hostState && !this.hostState.ready) {
				this.hostState.readyReject?.(
					new TerminalPluginError(
						TerminalErrorType.PTY_CREATION_FAILED,
						`PTY Sidecar failed to spawn: ${err.message}`,
					),
				);
			}
			this.handleHostExit();
		});

		// Wait for ready signal
		return readyPromise;
	}

	/**
	 * Setup message handling from the PTY host
	 */
	private setupHostMessageHandling(hostProcess: any): void {
		const readline = this.requireModule("readline");

		const rl = readline.createInterface({
			input: hostProcess.stdout,
			terminal: false,
		});

		rl.on("line", (line: string) => {
			// Skip empty lines
			const trimmed = line.trim();
			if (!trimmed) return;

			console.debug("[PTY-HOST stdout]:", trimmed.substring(0, 200));

			// Quick check: valid JSON messages start with '{'
			// This filters out Electron/Obsidian internal logs that leak to stdout
			if (!trimmed.startsWith("{")) {
				console.debug("[PTY-HOST] Ignoring non-JSON line");
				return;
			}

			try {
				const msg = JSON.parse(trimmed);
				console.debug(
					"[PTY-HOST] Parsed message:",
					msg.type,
					msg.event || msg.id,
				);
				// Additional validation: ensure it's a valid IPC message
				if (msg && typeof msg.type === "string") {
					this.handleHostMessage(msg);
				}
			} catch (err) {
				// Only log if it looks like it should be JSON but failed to parse
				console.warn(
					"[PTY-HOST] Malformed JSON message:",
					trimmed.substring(0, 100),
					err,
				);
			}
		});

		// Log stderr for debugging
		hostProcess.stderr?.on("data", (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) {
				console.debug(`[PTY-HOST]: ${msg}`);
			}
		});
	}

	/**
	 * Handle message from PTY host
	 */
	private handleHostMessage(msg: IpcResponse | IpcEventMessage): void {
		if (msg.type === IpcMessageType.Response) {
			this.handleResponse(msg as IpcResponse);
		} else if (msg.type === IpcMessageType.Event) {
			this.handleEvent(msg as IpcEventMessage);
		}
	}

	/**
	 * Handle response message
	 */
	private handleResponse(msg: IpcResponse): void {
		const pending = this.pendingRequests.get(msg.id);
		if (!pending) return;

		clearTimeout(pending.timeout);
		this.pendingRequests.delete(msg.id);

		if (msg.error) {
			pending.reject(new Error(msg.error));
		} else {
			pending.resolve(msg.result);
		}
	}

	/**
	 * Handle event message
	 */
	private handleEvent(msg: IpcEventMessage): void {
		const { event, params } = msg;

		switch (event) {
			case IpcEvent.Ready:
				console.log(
					"✅ PTY Sidecar is ready. PID:",
					(params as any).pid,
				);
				if (this.hostState) {
					this.hostState.ready = true;
					this.hostState.readyResolve?.();
				}
				break;

			case IpcEvent.Data: {
				const { pid, data } = params as { pid: number; data: string };
				const pty = this.activePtys.get(pid);
				if (pty) {
					pty.emitData(data);
				}
				break;
			}

			case IpcEvent.Exit: {
				const { pid, exitCode, signal } = params as {
					pid: number;
					exitCode: number;
					signal?: number;
				};
				const pty = this.activePtys.get(pid);
				if (pty) {
					pty.emitExit(exitCode, signal);
					this.activePtys.delete(pid);
				}
				break;
			}

			case IpcEvent.Error: {
				const { message, pid } = params as {
					message: string;
					pid?: number;
				};
				console.error("PTY Host error:", message);
				if (pid !== undefined) {
					const pty = this.activePtys.get(pid);
					if (pty) {
						pty.emitError(new Error(message));
					}
				}
				break;
			}
		}
	}

	/**
	 * Handle PTY host process exit
	 */
	private handleHostExit(): void {
		// Notify all active PTYs that they've been disconnected
		for (const [pid, pty] of this.activePtys) {
			pty.emitExit(-1, undefined);
		}
		this.activePtys.clear();
		this.tempPidMap.clear();

		// Reject all pending requests
		for (const [id, pending] of this.pendingRequests) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("PTY host process exited"));
		}
		this.pendingRequests.clear();

		this.hostState = null;
	}

	/**
	 * Send a request to the PTY host
	 */
	public async sendToHost(
		method: string,
		params: Record<string, unknown>,
	): Promise<unknown> {
		await this.ensureHostProcess();

		if (!this.hostState?.process || this.hostState.process.killed) {
			throw new Error("PTY host process is not running");
		}

		const id = (this.messageId++).toString();
		const msg = {
			type: IpcMessageType.Request,
			id,
			method,
			params,
		};

		console.debug(
			`[IPC] Sending: ${method}`,
			method === "write" ? "(data hidden)" : params,
		);

		// Write operations don't need response for better performance
		if (method === IpcMethod.Write) {
			this.hostState.process.stdin.write(JSON.stringify(msg) + "\n");
			return null;
		}

		// Create promise for response
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, RPC_TIMEOUT);

			this.pendingRequests.set(id, { resolve, reject, timeout });
			this.hostState!.process.stdin.write(JSON.stringify(msg) + "\n");
		});
	}

	// ============================================================
	// node-pty Compatible API
	// ============================================================

	/**
	 * Initialize PTY loading - tries strategies in order
	 * 1. @electron/remote (direct main process loading)
	 * 2. PTY Host Sidecar (separate process with IPC) - DISABLED FOR TESTING
	 */
	private async initializePtyLoading(): Promise<void> {
		if (this._ptyLoadMode !== null) {
			return; // Already initialized
		}

		// Strategy 1: Try @electron/remote
		console.log("🚀 Initializing PTY loading...");
		const remotePty = await this.tryLoadViaElectronRemote();
		if (remotePty) {
			this._directNodePty = remotePty;
			this._ptyLoadMode = "remote";
			console.log("✅ PTY mode: @electron/remote (direct)");
			return;
		}

		// Strategy 2: Fall back to Sidecar - DISABLED FOR TESTING
		// console.log(
		// 	"⚠️ @electron/remote not available, falling back to Sidecar mode",
		// );
		// await this.ensureHostProcess();
		// this._ptyLoadMode = "sidecar";
		// console.log("✅ PTY mode: Sidecar (IPC)");

		// For testing: throw error instead of falling back to sidecar
		throw new Error(
			"@electron/remote failed to load node-pty. Sidecar mode is disabled for testing. " +
				"Check console logs for details.",
		);
	}

	/**
	 * Get a node-pty compatible interface
	 *
	 * Returns an object with a spawn method that works with either:
	 * - Direct node-pty (via @electron/remote)
	 * - RemotePty (via Sidecar IPC)
	 */
	getNodePTY(): { spawn: typeof import("node-pty").spawn } | null {
		// If using direct mode, return the actual node-pty
		if (this._ptyLoadMode === "remote" && this._directNodePty) {
			return this._directNodePty;
		}

		// Otherwise return the sidecar-based spawn
		return {
			spawn: (file: string, args: string[], options: any) => {
				return this.spawnRemotePty(file, args, options);
			},
		} as any;
	}

	/**
	 * Async version of getNodePTY
	 * Initializes PTY loading if not already done
	 */
	async getNodePTYAsync(): Promise<{
		spawn: typeof import("node-pty").spawn;
	}> {
		await this.initializePtyLoading();
		return this.getNodePTY()!;
	}

	/**
	 * Get current PTY loading mode
	 */
	getPtyLoadMode(): PtyLoadMode {
		return this._ptyLoadMode;
	}

	/**
	 * Spawn a remote PTY process
	 */
	private spawnRemotePty(
		file: string,
		args: string[],
		options: any,
	): RemotePty {
		// Generate a temporary negative PID until real one is assigned
		const tempPid = -Math.floor(Math.random() * 1000000);

		// Create RemotePty instance
		const pty = new RemotePty(
			tempPid,
			(method, params) => this.sendToHost(method, params),
			file,
			options.cols || 80,
			options.rows || 24,
		);

		// Store in temp map
		this.tempPidMap.set(tempPid, pty);

		// Async creation - don't block
		this.createPtyAsync(file, args, options, pty, tempPid).catch((err) => {
			console.error("Failed to create PTY:", err);
			this.tempPidMap.delete(tempPid);
			pty.emitExit(1, undefined);
		});

		return pty;
	}

	/**
	 * Async PTY creation helper
	 */
	private async createPtyAsync(
		file: string,
		args: string[],
		options: any,
		pty: RemotePty,
		tempPid: number,
	): Promise<void> {
		const result = (await this.sendToHost(IpcMethod.Create, {
			file,
			args,
			options: {
				name: options.name || "xterm-256color",
				cols: options.cols || 80,
				rows: options.rows || 24,
				cwd: options.cwd || this.getCurrentWorkingDirectory(),
				env: options.env || this.getEnvironmentVariables(),
				encoding: options.encoding || "utf8",
			},
		})) as CreatePtyResult;

		const realPid = result.pid;

		// Update PTY with real PID
		pty.updatePid(realPid);

		// Move from temp map to active map
		this.tempPidMap.delete(tempPid);
		this.activePtys.set(realPid, pty);

		console.log(`✅ PTY created: ${file} (PID: ${realPid})`);
	}

	/**
	 * Validate if a shell exists and is executable
	 */
	async validateShell(shellPath: string): Promise<boolean> {
		try {
			const fs = this.requireModule("fs");
			const proc = this.getProcess();

			// On Windows, check common shell locations
			if (proc.platform === "win32") {
				// PowerShell and cmd are always available
				if (
					shellPath.toLowerCase().includes("powershell") ||
					shellPath.toLowerCase().includes("cmd.exe")
				) {
					return true;
				}
			}

			// Check if file exists
			return fs.existsSync(shellPath);
		} catch {
			return false;
		}
	}

	/**
	 * Cleanup resources on plugin unload
	 */
	cleanup(): void {
		// Cleanup based on mode
		if (this._ptyLoadMode === "remote") {
			// Direct mode: just clear references
			this._directNodePty = null;
			console.log("✅ Cleaned up @electron/remote PTY resources");
		} else if (this._ptyLoadMode === "sidecar") {
			// Sidecar mode: kill host process
			if (this.hostState?.process && !this.hostState.process.killed) {
				this.hostState.process.kill();
			}
			this.handleHostExit();
			console.log("✅ Cleaned up Sidecar PTY resources");
		}

		this._ptyLoadMode = null;
	}
}
