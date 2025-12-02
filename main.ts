import { Plugin, WorkspaceLeaf, Notice, normalizePath } from "obsidian";
import {
	ITerminalPlugin,
	TerminalPluginError,
	TerminalErrorType,
} from "@/types";
import {
	ElectronBridge,
	PTYManager,
	TerminalManager,
	NativeBinaryManager,
	BinaryStatus,
} from "@/core";
import { TerminalView } from "@/views";
import {
	TerminalSettingsTab,
	DEFAULT_SETTINGS,
	type TerminalPluginSettings,
} from "@/settings";
import {
	PLUGIN_ID,
	VIEW_TYPE_TERMINAL,
	COMMAND_OPEN_TERMINAL,
	COMMAND_OPEN_TERMINAL_NAME,
} from "@/constants";

/**
 * Main plugin class for Obsidian Terminal
 * Implements the plugin lifecycle and coordinates all components
 */
export default class TerminalPlugin extends Plugin implements ITerminalPlugin {
	terminalManager!: TerminalManager;
	settings: TerminalPluginSettings | null = null;

	private electronBridge!: ElectronBridge;
	private ptyManager!: PTYManager;
	private binaryManager!: NativeBinaryManager;
	private _pluginDir: string = "";
	private _nativeModulesReady: boolean = false;

	/**
	 * Called when the plugin is loaded
	 */
	async onload(): Promise<void> {
		try {
			console.log(`Loading ${PLUGIN_ID}...`);

			// Load settings first
			await this.loadSettings();

			// Calculate plugin directory early
			this._pluginDir = this.getPluginDirectory();

			// Initialize binary manager
			this.binaryManager = new NativeBinaryManager(this._pluginDir);

			// Add settings tab
			this.addSettingTab(new TerminalSettingsTab(this.app, this));

			// Check if native modules are installed
			const status = this.binaryManager.getStatus();
			if (!status.installed || status.needsUpdate) {
				// Show notice about missing native modules
				this.showNativeModulesNotice(status);
				console.warn(
					`${PLUGIN_ID}: Native modules not installed. Terminal features disabled.`,
				);

				// Register limited commands (settings only)
				this.registerLimitedCommands();
				return;
			}

			// Native modules are ready
			this._nativeModulesReady = true;

			// Initialize core components
			await this.initializeComponents();

			// Register view types
			this.registerViews();

			// Register commands
			this.registerCommands();

			// Set up event handlers
			this.setupEventHandlers();

			console.log(`${PLUGIN_ID} loaded successfully`);
		} catch (error) {
			console.error(`Failed to load ${PLUGIN_ID}:`, error);

			// Show user-friendly error message
			if (error instanceof TerminalPluginError) {
				this.showNotice(error.getUserMessage());
			} else {
				this.showNotice(
					"Failed to load Terminal plugin. Check console for details.",
				);
			}
		}
	}

	/**
	 * Show notice about missing native modules
	 */
	private showNativeModulesNotice(status: BinaryStatus): void {
		const notice = new Notice("", 0); // Persistent notice
		const container = notice.messageEl;
		container.empty();
		container.addClass("terminal-native-notice");

		container.createEl("strong", { text: "Terminal 插件需要下载原生模块" });
		container.createEl("br");
		container.createEl("span", {
			text: `平台: ${status.platformKey}`,
			cls: "notice-platform",
		});
		container.createEl("br");
		container.createEl("br");

		const btn = container.createEl("button", { text: "打开设置下载" });
		btn.onclick = () => {
			// Open plugin settings
			(this.app as any).setting.open();
			(this.app as any).setting.openTabById(PLUGIN_ID);
			notice.hide();
		};

		const closeBtn = container.createEl("button", {
			text: "稍后",
			cls: "notice-close-btn",
		});
		closeBtn.style.marginLeft = "8px";
		closeBtn.onclick = () => notice.hide();
	}

	/**
	 * Register limited commands when native modules are not available
	 */
	private registerLimitedCommands(): void {
		// Only register settings-related command
		this.addCommand({
			id: "open-settings",
			name: "打开终端设置",
			callback: () => {
				(this.app as any).setting.open();
				(this.app as any).setting.openTabById(PLUGIN_ID);
			},
		});
	}

	/**
	 * Called when the plugin is unloaded
	 */
	onunload(): void {
		try {
			console.log(`Unloading ${PLUGIN_ID}...`);

			// Clean up terminal manager
			if (this.terminalManager) {
				this.terminalManager.cleanup();
			}

			// Clean up PTY manager
			if (this.ptyManager) {
				this.ptyManager.cleanup();
			}

			console.log(`${PLUGIN_ID} unloaded successfully`);
		} catch (error) {
			console.error(`Error unloading ${PLUGIN_ID}:`, error);
		}
	}

	/**
	 * Open a new terminal view
	 */
	async openTerminal(): Promise<void> {
		try {
			// Create a new terminal session
			const session =
				await this.terminalManager.createTerminalWithAvailableShell();

			// Create the view
			const leaf = this.getOrCreateTerminalLeaf();
			const view = new TerminalView(leaf, session);

			// Set the view
			leaf.setViewState({
				type: VIEW_TYPE_TERMINAL,
				active: true,
			});

			// Focus the terminal
			this.app.workspace.setActiveLeaf(leaf);

			// Focus the terminal after a short delay to ensure it's rendered
			setTimeout(() => {
				if (view.terminal) {
					view.focus();
				}
			}, 100);
		} catch (error) {
			console.error("Failed to open terminal:", error);

			if (error instanceof TerminalPluginError) {
				this.showNotice(error.getUserMessage());
			} else {
				this.showNotice(
					"Failed to open terminal. Check console for details.",
				);
			}
		}
	}

	/**
	 * Initialize core components
	 */
	private async initializeComponents(): Promise<void> {
		// Initialize Electron bridge
		this.electronBridge = new ElectronBridge();

		// Check if Electron environment is available first
		if (!this.electronBridge.isElectronAvailable()) {
			throw new TerminalPluginError(
				TerminalErrorType.ELECTRON_NOT_AVAILABLE,
				"Terminal plugin requires desktop Obsidian",
			);
		}

		// Set the correct plugin directory path BEFORE any other operations
		const pluginDirectory = this.getPluginDirectory();
		this.electronBridge.setPluginDirectory(pluginDirectory);

		// Set the vault path as the working directory
		const vaultPath = this.getVaultPath();
		this.electronBridge.setVaultPath(vaultPath);

		// Pre-load node-pty directly
		try {
			console.log("🔄 Pre-loading node-pty...");
			await this.electronBridge.getNodePTYAsync();
			console.log("✅ node-pty pre-loaded successfully");
		} catch (error) {
			console.error(
				"❌ node-pty failed to load:",
				(error as any)?.message || error,
			);
			throw error;
		}

		// Initialize PTY manager
		this.ptyManager = new PTYManager(this.electronBridge);

		// Initialize terminal manager
		this.terminalManager = new TerminalManager(this.ptyManager);
	}

	/**
	 * Register view types with Obsidian
	 */
	private registerViews(): void {
		// Register terminal view
		this.registerView(VIEW_TYPE_TERMINAL, (leaf: WorkspaceLeaf) => {
			// This factory function is called when Obsidian needs to create the view
			// We'll create a placeholder session for workspace restoration
			const session = this.terminalManager.createTerminal();
			return new TerminalView(leaf, session);
		});
	}

	/**
	 * Register commands with Obsidian
	 */
	private registerCommands(): void {
		// Register open terminal command
		this.addCommand({
			id: COMMAND_OPEN_TERMINAL,
			name: COMMAND_OPEN_TERMINAL_NAME,
			callback: () => {
				this.openTerminal();
			},
		});

		// Register additional commands
		this.addCommand({
			id: "close-terminal",
			name: "关闭当前终端",
			checkCallback: (checking: boolean) => {
				const activeLeaf =
					this.app.workspace.getActiveViewOfType(TerminalView);
				if (activeLeaf) {
					if (!checking) {
						activeLeaf.leaf.detach();
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "focus-terminal",
			name: "聚焦终端",
			checkCallback: (checking: boolean) => {
				const activeLeaf =
					this.app.workspace.getActiveViewOfType(TerminalView);
				if (activeLeaf) {
					if (!checking) {
						activeLeaf.focus();
					}
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: "clear-terminal",
			name: "清空终端",
			checkCallback: (checking: boolean) => {
				const activeLeaf =
					this.app.workspace.getActiveViewOfType(TerminalView);
				if (activeLeaf) {
					if (!checking) {
						activeLeaf.clear();
					}
					return true;
				}
				return false;
			},
		});
	}

	// Resize 防抖定时器
	private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Set up event handlers
	 */
	private setupEventHandlers(): void {
		// Handle workspace layout changes
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				// 触发所有终端视图的 resize
				this.debounceResizeAllViews(100);
			}),
		);

		// Handle window resize
		this.registerDomEvent(window, "resize", () => {
			// 防抖处理窗口 resize 事件
			this.debounceResizeAllViews(150);
		});
	}

	/**
	 * 防抖触发所有终端视图的 resize
	 * 让每个视图根据自己的容器大小计算正确的 cols/rows
	 */
	private debounceResizeAllViews(delay: number): void {
		if (this.resizeDebounceTimer) {
			clearTimeout(this.resizeDebounceTimer);
		}

		this.resizeDebounceTimer = setTimeout(() => {
			this.resizeDebounceTimer = null;

			// 获取所有终端视图并触发各自的 resize
			const terminalViews = this.getTerminalViews();
			for (const view of terminalViews) {
				try {
					view.resize();
				} catch (error) {
					console.warn("Failed to resize terminal view:", error);
				}
			}
		}, delay);
	}

	/**
	 * Get or create a terminal leaf
	 */
	private getOrCreateTerminalLeaf(): WorkspaceLeaf {
		// Try to find an existing terminal leaf
		const existingLeaf =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL)[0];

		if (existingLeaf) {
			return existingLeaf;
		}

		// Create a new leaf in the right split
		return (
			this.app.workspace.getRightLeaf(false) ||
			this.app.workspace.getLeaf(true)
		);
	}

	/**
	 * Show a notice to the user
	 */
	private showNotice(message: string): void {
		new Notice(message, 5000);
	}

	/**
	 * Get active terminal view
	 */
	getActiveTerminalView(): TerminalView | null {
		return this.app.workspace.getActiveViewOfType(TerminalView);
	}

	/**
	 * Get all terminal views
	 */
	getTerminalViews(): TerminalView[] {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
		return leaves
			.map((leaf) => leaf.view as TerminalView)
			.filter((view) => view instanceof TerminalView);
	}

	/**
	 * Check if plugin is ready
	 */
	isReady(): boolean {
		return !!(
			this.electronBridge &&
			this.ptyManager &&
			this.terminalManager
		);
	}

	/**
	 * Get the plugin directory path using Obsidian's API
	 */
	private getPluginDirectory(): string {
		try {
			// Use Obsidian's FileSystemAdapter to get the base path
			const adapter = this.app.vault.adapter as any;
			const basePath = adapter.getBasePath
				? adapter.getBasePath()
				: adapter.basePath || "";
			const manifestDir = this.manifest.dir;

			// Use require directly since we're in Electron environment
			const path = require("path");
			const pluginPath = path.join(basePath, manifestDir);

			// Normalize the path using Obsidian's normalizePath function
			const normalizedPath = normalizePath(pluginPath);

			console.log("✅ Calculated plugin directory:", normalizedPath);
			console.log("📁 Base path:", basePath);
			console.log("📂 Manifest dir:", manifestDir);

			return normalizedPath;
		} catch (error) {
			console.error("❌ Failed to get plugin directory:", error);
			console.log("🔄 Using fallback plugin directory calculation");

			// Alternative approach - use manifest.dir directly if available
			if (this.manifest.dir) {
				const fallbackPath = normalizePath(this.manifest.dir);
				console.log("📂 Using manifest.dir as fallback:", fallbackPath);
				return fallbackPath;
			}

			// Final fallback to process.cwd()
			const cwd = process.cwd();
			console.log("🏠 Using process.cwd() as final fallback:", cwd);
			return cwd;
		}
	}

	/**
	 * Get the vault path
	 */
	private getVaultPath(): string {
		try {
			// Use Obsidian's FileSystemAdapter to get the vault base path
			const adapter = this.app.vault.adapter as any;
			const vaultPath = adapter.getBasePath
				? adapter.getBasePath()
				: adapter.basePath || "";

			console.log("📁 Vault path:", vaultPath);
			return vaultPath;
		} catch (error) {
			console.error("❌ Failed to get vault path:", error);

			// Fallback to plugin directory
			const pluginDir = this.getPluginDirectory();
			console.log(
				"🔄 Using plugin directory as fallback vault path:",
				pluginDir,
			);
			return pluginDir;
		}
	}

	/**
	 * Get plugin directory (public accessor)
	 */
	getPluginDir(): string {
		return this._pluginDir || this.getPluginDirectory();
	}

	/**
	 * Load plugin settings
	 */
	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	/**
	 * Save plugin settings
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
