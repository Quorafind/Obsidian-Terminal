import {
	Plugin,
	WorkspaceLeaf,
	Notice,
	Platform,
	Menu,
	debounce,
	addIcon,
} from "obsidian";
import * as path from "path";
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
import { TerminalView, resetGhosttyState } from "@/views";
import {
	TerminalSettingsTab,
	DEFAULT_SETTINGS,
	type TerminalPluginSettings,
	type ThemeMode,
} from "@/settings";
import { PRESET_THEMES } from "@/core/themes";
import {
	PLUGIN_ID,
	VIEW_TYPE_TERMINAL,
	COMMAND_OPEN_TERMINAL,
	COMMAND_OPEN_TERMINAL_NAME,
	RIBBON_ICON_ID,
	RIBBON_ICON_SVG,
} from "@/constants";
import "@/main.css";

/**
 * Main plugin class for Obsidian Terminal
 * Implements the plugin lifecycle and coordinates all components
 */
export default class TerminalPlugin extends Plugin implements ITerminalPlugin {
	terminalManager!: TerminalManager;
	settings: TerminalPluginSettings | null = null;
	themeColors: Record<string, string> = {};

	private electronBridge!: ElectronBridge;
	public ptyManager!: PTYManager;
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

			// Add Ribbon Icon for quick terminal access
			addIcon(RIBBON_ICON_ID, RIBBON_ICON_SVG);
			this.addRibbonIcon(RIBBON_ICON_ID, "New Terminal", () => {
				this.openTerminal(true);
			});

			// Initialize theme colors (must be after DOM is ready)
			this.themeColors = this.resolveThemeColors();

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

		container.createEl("strong", {
			text: "Terminal plugin requires native modules",
		});
		container.createEl("br");
		container.createEl("span", {
			text: `Platform: ${status.platformKey}`,
			cls: "notice-platform",
		});
		container.createEl("br");
		container.createEl("br");

		const btn = container.createEl("button", { text: "Open Settings" });
		btn.onclick = () => {
			// Open plugin settings
			(this.app as any).setting.open();
			(this.app as any).setting.openTabById(PLUGIN_ID);
			notice.hide();
		};

		const closeBtn = container.createEl("button", {
			text: "Later",
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
			name: "Open Terminal Settings",
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

			// Reset Ghostty WASM state for hot reload
			resetGhosttyState();

			console.log(`${PLUGIN_ID} unloaded successfully`);
		} catch (error) {
			console.error(`Error unloading ${PLUGIN_ID}:`, error);
		}
	}

	/**
	 * Open a new terminal view
	 * @param asTab If true, opens in a new tab instead of split
	 */
	async openTerminal(asTab = false): Promise<void> {
		try {
			// Create a new terminal session
			const session =
				await this.terminalManager.createTerminalWithAvailableShell();

			// Create the view - use tab or split based on parameter
			const leaf = asTab
				? this.app.workspace.getLeaf(true)
				: this.getOrCreateTerminalLeaf();
			const view = new TerminalView(leaf, session, this);

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

		// Set settings provider so PTYManager can access user shell settings
		this.ptyManager.setSettingsProvider(() => this.settings);

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
			return new TerminalView(leaf, session, this);
		});

		this.registerHoverLinkSource("terminal", {
			display: "Terminal",
			defaultMod: true,
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
			name: "Close Current Terminal",
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
			name: "Focus Terminal",
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
			name: "Clear Terminal",
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

		// Handle theme/CSS changes (including dark/light mode switches)
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				this.debounceUpdateAllViews();
			}),
		);

		// Intercept "New Tab" button clicks to show menu (Desktop only)
		if (Platform.isDesktop) {
			this.registerDomEvent(
				window,
				"click",
				(evt: MouseEvent) => this.handleNewTabClick(evt),
				{ capture: true },
			);
		}
	}

	/**
	 * Intercept clicks on "New Tab" button to show context menu with terminal option
	 * Uses event capturing to intercept before Obsidian's default handler
	 */
	private handleNewTabClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const newTabBtn = target.closest(".workspace-tab-header-new-tab");

		if (!newTabBtn) {
			return;
		}

		// Prevent default behavior and stop propagation
		evt.preventDefault();
		evt.stopPropagation();

		const menu = new Menu();

		// Option 1: Default Obsidian New Tab behavior
		menu.addItem((item) => {
			item.setTitle("New Tab")
				.setIcon("file-plus")
				.onClick(() => {
					this.app.workspace.getLeaf(true);
				});
		});

		// Option 2: Open Terminal (only if native modules are ready)
		if (this._nativeModulesReady) {
			menu.addItem((item) => {
				item.setTitle("New Terminal")
					.setIcon("terminal")
					.onClick(() => {
						this.openTerminal(true);
					});
			});
		}

		menu.showAtMouseEvent(evt);
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

	private debounceUpdateAllViews = debounce(() => {
		this.themeColors = this.resolveThemeColors();
		// Update all terminal views with new theme
		for (const view of this.getTerminalViews()) {
			view.updateTheme(this.themeColors);
		}
	}, 200);

	/**
	 * Get or create a terminal leaf
	 */
	private getOrCreateTerminalLeaf(): WorkspaceLeaf {
		// Create a new leaf in the right split
		return this.app.workspace.getLeaf("split", "horizontal");
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
			const manifestDir = this.manifest.dir || "";

			const pluginPath = path.join(basePath, manifestDir);
			const normalizedPath = this.normalizePluginPath(pluginPath);

			console.log("✅ Calculated plugin directory:", normalizedPath);
			console.log("📁 Base path:", basePath);
			console.log("📂 Manifest dir:", manifestDir);

			return normalizedPath;
		} catch (error) {
			console.error("❌ Failed to get plugin directory:", error);
			console.log("🔄 Using fallback plugin directory calculation");

			// Alternative approach - use manifest.dir directly if available
			if (this.manifest.dir) {
				const fallbackPath = this.normalizePluginPath(
					path.join(process.cwd(), this.manifest.dir),
				);
				console.log("📂 Using manifest.dir as fallback:", fallbackPath);
				return fallbackPath;
			}

			// Final fallback to process.cwd()
			const cwd = this.normalizePluginPath(process.cwd());
			console.log("🏠 Using process.cwd() as final fallback:", cwd);
			return cwd;
		}
	}

	/**
	 * Normalize file system paths without stripping leading separators
	 */
	private normalizePluginPath(fsPath: string): string {
		const normalized = path.normalize(fsPath);
		return normalized.replace(/\\/g, "/");
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

		// Migration: useGhostty -> renderer
		if (data && "useGhostty" in data && this.settings) {
			if ((data as any).useGhostty === true) {
				this.settings.renderer = "ghostty";
			}
			delete (this.settings as any).useGhostty;
			// Save migrated settings
			await this.saveData(this.settings);
		}
	}

	/**
	 * Save plugin settings
	 */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);

		// 保存设置后通知所有终端视图更新外观
		this.getTerminalViews().forEach((view) => {
			view.applySettings();
		});
	}

	/**
	 * Resolve terminal theme colors
	 *
	 * Supports two modes:
	 * - "system": Resolves colors from Obsidian CSS variables
	 * - "preset": Uses predefined terminal color schemes
	 *
	 * WebGL renderer requires HEX colors, so all colors are converted to HEX format.
	 */
	private resolveThemeColors(): Record<string, string> {
		const themeMode: ThemeMode =
			this.settings?.themeMode ?? DEFAULT_SETTINGS.themeMode;

		// Preset mode: use predefined theme
		if (themeMode === "preset") {
			const isDark = document.body.classList.contains("theme-dark");
			const presetId = isDark
				? (this.settings?.darkThemePreset ??
					DEFAULT_SETTINGS.darkThemePreset)
				: (this.settings?.lightThemePreset ??
					DEFAULT_SETTINGS.lightThemePreset);

			const theme = PRESET_THEMES[presetId];
			if (theme) {
				// Return a copy of the theme (excluding metadata)
				const { name, type, ...colors } = theme;
				return { ...colors };
			}
			// Fall through to system mode if preset not found
		}

		// System mode: resolve from Obsidian CSS variables
		const styles = getComputedStyle(document.body);

		/**
		 * Convert any CSS color to HEX format
		 * WebGL renderer requires HEX colors for proper rendering
		 */
		const toHex = (color: string): string => {
			// If already HEX, return as-is
			if (color.startsWith("#")) {
				return color;
			}

			// Use canvas to convert any CSS color to RGB
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 1;
			const ctx = canvas.getContext("2d");
			if (!ctx) return color;

			ctx.fillStyle = color;
			ctx.fillRect(0, 0, 1, 1);
			const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;

			// If has transparency, return rgba format (for selectionBackground)
			if (a < 255) {
				return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
			}

			// Convert to HEX
			return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
		};

		const resolve = (cssVar: string, fallback: string): string => {
			const value = styles.getPropertyValue(cssVar).trim();
			return toHex(value || fallback);
		};

		return {
			// Core colors
			background: resolve("--background-secondary", "#1e1e1e"),
			foreground: resolve("--text-normal", "#d4d4d4"),
			cursor: resolve("--text-accent", "#569cd6"),
			cursorAccent: resolve("--background-secondary", "#1e1e1e"),
			selectionBackground: resolve(
				"--text-selection",
				"rgba(255, 255, 255, 0.3)",
			),
			// ANSI colors
			black: resolve("--color-base-00", "#1e1e1e"),
			red: resolve("--color-red", "#e93147"),
			green: resolve("--color-green", "#08b94e"),
			yellow: resolve("--color-yellow", "#e0ac00"),
			blue: resolve("--color-blue", "#086ddd"),
			magenta: resolve("--color-purple", "#7852ee"),
			cyan: resolve("--color-cyan", "#00bfbc"),
			white: resolve("--color-base-70", "#d4d4d4"),
			// Bright ANSI colors
			brightBlack: resolve("--color-base-50", "#808080"),
			brightRed: resolve("--color-red", "#e93147"),
			brightGreen: resolve("--color-green", "#08b94e"),
			brightYellow: resolve("--color-yellow", "#e0ac00"),
			brightBlue: resolve("--color-blue", "#086ddd"),
			brightMagenta: resolve("--color-purple", "#7852ee"),
			brightCyan: resolve("--color-cyan", "#00bfbc"),
			brightWhite: resolve("--color-base-100", "#ffffff"),
		};
	}
}
