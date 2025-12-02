import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WorkspaceLeaf, Menu } from "obsidian";
import {
	TerminalView as BaseTerminalView,
	TerminalSession,
	TerminalPluginError,
	TerminalErrorType,
} from "@/types";
import {
	VIEW_TYPE_TERMINAL,
	TERMINAL_VIEW_DISPLAY_TEXT,
	DEFAULT_TERMINAL_DIMENSIONS,
} from "@/constants";

// Import xterm.js CSS as string for Shadow DOM injection
import xtermCss from "@xterm/xterm/css/xterm.css?inline";

/**
 * Shadow DOM styles for terminal
 * Uses CSS variables from Obsidian for theming
 */
const shadowStyles = `
/* Import xterm base styles */
${xtermCss}

/* CSS Variables inherited from Obsidian */
:host {
  --terminal-bg: var(--background-primary, #1e1e1e);
  --terminal-fg: var(--text-normal, #d4d4d4);
  --terminal-cursor: var(--text-accent, #569cd6);
  --terminal-selection: var(--text-selection, rgba(255, 255, 255, 0.3));
}

/* Container styles */
.terminal-shadow-container {
  height: 100%;
  width: 100%;
  background: var(--terminal-bg);
  padding: 8px;
  box-sizing: border-box;
  overflow: hidden;
}

/* xterm.js container */
.xterm {
  height: 100%;
  width: 100%;
}

.xterm-viewport {
  overflow-y: auto !important;
}

.xterm-screen {
  height: 100%;
}

/*
 * IME/中文输入支持：保持 helper-textarea 可访问但不可见
 * 注意：不能完全隐藏 textarea，否则 IME 无法正常工作
 */
.xterm-helper-textarea {
  position: absolute !important;
  opacity: 0 !important;
  left: 0 !important;
  top: 0 !important;
  z-index: -5 !important;
  /* 保持最小尺寸以支持 IME 定位 */
  width: 1px !important;
  height: 1px !important;
  overflow: hidden !important;
  /* 不禁用 pointer-events，允许 IME 事件 */
}

/* 隐藏字符测量元素 */
.xterm-char-measure-element,
.xterm-width-cache-measure-container {
  position: absolute !important;
  visibility: hidden !important;
  left: -9999px !important;
  top: -9999px !important;
  pointer-events: none !important;
}

/*
 * IME 组合视图样式 - 用于显示中文输入候选
 * 必须保持可见以支持 IME 输入
 */
.xterm .composition-view {
  background: var(--background-modifier-form-field, #2d2d2d) !important;
  color: var(--text-normal, #d4d4d4) !important;
  border: 1px solid var(--background-modifier-border, #444) !important;
  border-radius: 4px !important;
  padding: 2px 6px !important;
  font-family: inherit !important;
  font-size: inherit !important;
  z-index: 100 !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
}

.xterm .composition-view.active {
  display: block !important;
}
`;

// Global store for shell sessions to persist across tab switches
const shellSessions = new Map<string, ShellSessionData>();

interface ShellSessionData {
	terminal: Terminal;
	fitAddon: FitAddon;
	shadowRoot: ShadowRoot;
	shadowContainer: HTMLElement;
	isConnected: boolean;
	disposables: Array<{ dispose(): void }>;
}

/**
 * Terminal view implementation using xterm.js with Shadow DOM isolation
 */
export class TerminalView extends BaseTerminalView {
	terminal!: Terminal;
	terminalSession!: TerminalSession;
	terminalViewContainer!: HTMLElement;

	private shadowHost: HTMLElement | null = null;
	private shadowRoot: ShadowRoot | null = null;
	private shadowContainer: HTMLElement | null = null;
	private fitAddon!: FitAddon;
	private webLinksAddon!: WebLinksAddon;
	private disposables: Array<{ dispose(): void }> = [];
	private isInitialized = false;
	private isConnected = false;
	private isRestarting = false;
	private initializationState: "idle" | "initializing" | "ready" | "error" =
		"idle";

	// Terminal configuration
	private readonly fontSize = 14;
	private readonly fontFamily =
		'Consolas, "Cascadia Mono", Menlo, Monaco, "Courier New", monospace';

	constructor(leaf: WorkspaceLeaf, terminalSession: TerminalSession) {
		super(leaf);
		this.terminalSession = terminalSession;
	}

	getViewType(): string {
		return VIEW_TYPE_TERMINAL;
	}

	getDisplayText(): string {
		return TERMINAL_VIEW_DISPLAY_TEXT;
	}

	getIcon(): string {
		return "terminal";
	}

	async onOpen(): Promise<void> {
		try {
			this.terminalViewContainer = this.contentEl.createDiv({
				cls: "terminal-view-container",
			});

			// Apply container styles
			Object.assign(this.terminalViewContainer.style, {
				height: "100%",
				width: "100%",
				overflow: "hidden",
			});

			// Check for existing session
			const sessionKey = this.getSessionKey();
			const existingSession = shellSessions.get(sessionKey);

			if (existingSession) {
				await this.restoreSession(existingSession);
			} else {
				await this.initializeTerminal();
			}

			this.isInitialized = true;
			console.log(
				`Terminal view opened for session ${this.terminalSession.id}`,
			);
		} catch (error) {
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				"Failed to open terminal view",
				error as Error,
			);
		}
	}

	async onClose(): Promise<void> {
		try {
			// Save session for potential restoration
			this.saveSession();

			console.log(
				`Terminal view closed for session ${this.terminalSession.id}`,
			);
		} catch (error) {
			console.error("Error closing terminal view:", error);
		}
	}

	/**
	 * Called when the view is resized (Obsidian built-in)
	 */
	onResize(): void {
		this.resize();
	}

	/**
	 * Save current session for restoration
	 */
	private saveSession(): void {
		if (!this.shadowRoot || !this.shadowContainer) return;

		const sessionKey = this.getSessionKey();
		shellSessions.set(sessionKey, {
			terminal: this.terminal,
			fitAddon: this.fitAddon,
			shadowRoot: this.shadowRoot,
			shadowContainer: this.shadowContainer,
			isConnected: this.isConnected,
			disposables: this.disposables,
		});
	}

	/**
	 * Resize terminal to fit container
	 */
	resize(): void {
		if (!this.isInitialized || !this.terminal || !this.fitAddon) {
			return;
		}

		try {
			this.fitAddon.fit();

			// Sync PTY size
			const dims = this.fitAddon.proposeDimensions();
			if (dims) {
				this.terminalSession.ptyProcess.resize(dims.cols, dims.rows);
			}
		} catch (error) {
			console.warn("Failed to resize terminal:", error);
		}
	}

	/**
	 * Initialize the terminal instance with Shadow DOM
	 */
	private async initializeTerminal(): Promise<void> {
		if (this.initializationState !== "idle") {
			console.warn("Terminal already initializing or initialized");
			return;
		}

		this.initializationState = "initializing";

		try {
			this.createShadowDOM();
			this.createTerminalInstance();
			this.loadAddons();
			this.openTerminalInShadow();
			this.connectToPTY();
			this.setupKeyboardHandlers();
			this.setupContextMenu();

			// Initial fit after a short delay to ensure DOM is ready
			requestAnimationFrame(() => {
				this.fitAddon.fit();
				this.terminal.focus();
			});

			this.initializationState = "ready";
			console.log("✅ Terminal initialization complete (Shadow DOM)");
		} catch (error) {
			this.initializationState = "error";
			throw new TerminalPluginError(
				TerminalErrorType.VIEW_CREATION_FAILED,
				"Failed to initialize terminal",
				error as Error,
			);
		}
	}

	/**
	 * Create Shadow DOM for style isolation
	 */
	private createShadowDOM(): void {
		// Create shadow host element
		this.shadowHost = document.createElement("div");
		this.shadowHost.className = "terminal-shadow-host";
		Object.assign(this.shadowHost.style, {
			height: "100%",
			width: "100%",
		});

		// Attach shadow root
		this.shadowRoot = this.shadowHost.attachShadow({ mode: "open" });

		// Inject styles into shadow DOM
		const styleEl = document.createElement("style");
		styleEl.textContent = shadowStyles;
		this.shadowRoot.appendChild(styleEl);

		// Create container inside shadow DOM
		this.shadowContainer = document.createElement("div");
		this.shadowContainer.className = "terminal-shadow-container";
		this.shadowRoot.appendChild(this.shadowContainer);

		// Append shadow host to view container
		this.terminalViewContainer.appendChild(this.shadowHost);

		console.log("✅ Shadow DOM created");
	}

	/**
	 * Create xterm.js terminal instance
	 */
	private createTerminalInstance(): void {
		const theme = this.getObsidianTheme();

		this.terminal = new Terminal({
			fontSize: this.fontSize,
			fontFamily: this.fontFamily,
			cursorBlink: true,
			cursorStyle: "block",
			allowTransparency: true,
			theme,
			cols: DEFAULT_TERMINAL_DIMENSIONS.cols,
			rows: DEFAULT_TERMINAL_DIMENSIONS.rows,
			// 限制历史记录行数，防止内存膨胀
			scrollback: 1000,
			// 启用 Windows 模式以更好支持 ConPTY
			windowsMode: process.platform === "win32",
			// 允许透明度以支持 Obsidian 主题
			allowProposedApi: true,
		});

		console.log("✅ xterm.js Terminal instance created");
	}

	/**
	 * Load xterm.js addons
	 */
	private loadAddons(): void {
		this.fitAddon = new FitAddon();
		this.webLinksAddon = new WebLinksAddon();

		this.terminal.loadAddon(this.fitAddon);
		this.terminal.loadAddon(this.webLinksAddon);

		console.log("✅ xterm.js addons loaded");
	}

	/**
	 * Open terminal in Shadow DOM
	 */
	private openTerminalInShadow(): void {
		if (!this.shadowContainer) {
			throw new Error("Shadow container not initialized");
		}
		this.terminal.open(this.shadowContainer);
		console.log("✅ Terminal opened in Shadow DOM");
	}

	/**
	 * Connect terminal to PTY process
	 */
	private connectToPTY(): void {
		const { ptyProcess } = this.terminalSession;

		// Handle user input - send to PTY
		const dataDisposable = this.terminal.onData((data: string) => {
			try {
				ptyProcess.write(data);
			} catch (error) {
				console.error("Failed to write to PTY:", error);
			}
		});
		this.disposables.push(dataDisposable);

		// Handle PTY output - display in terminal
		const onDataHandler = (data: string) => {
			try {
				this.terminal.write(data);
			} catch (error) {
				console.error("Failed to write to terminal:", error);
			}
		};
		ptyProcess.on("data", onDataHandler);

		this.disposables.push({
			dispose: () => ptyProcess.removeListener("data", onDataHandler),
		});

		// Handle PTY exit
		const onExitHandler = (exitCode: number) => {
			this.handlePTYExit(exitCode);
		};
		ptyProcess.on("exit", onExitHandler);

		this.disposables.push({
			dispose: () => ptyProcess.removeListener("exit", onExitHandler),
		});

		this.isConnected = true;
		console.log("✅ Terminal connected to PTY");
	}

	/**
	 * Get Obsidian theme colors for terminal
	 */
	private getObsidianTheme(): Record<string, string> {
		const bodyStyle = getComputedStyle(document.body);

		return {
			background:
				bodyStyle.getPropertyValue("--background-primary").trim() ||
				"#1e1e1e",
			foreground:
				bodyStyle.getPropertyValue("--text-normal").trim() || "#d4d4d4",
			cursor:
				bodyStyle.getPropertyValue("--text-accent").trim() || "#569cd6",
			cursorAccent:
				bodyStyle.getPropertyValue("--background-primary").trim() ||
				"#1e1e1e",
			selectionBackground:
				bodyStyle.getPropertyValue("--text-selection").trim() ||
				"rgba(255, 255, 255, 0.3)",
			// Standard terminal colors
			black: "#1e1e1e",
			red: "#f44747",
			green: "#6a9955",
			yellow: "#dcdcaa",
			blue: "#569cd6",
			magenta: "#c586c0",
			cyan: "#4ec9b0",
			white: "#d4d4d4",
			brightBlack: "#808080",
			brightRed: "#f44747",
			brightGreen: "#6a9955",
			brightYellow: "#dcdcaa",
			brightBlue: "#569cd6",
			brightMagenta: "#c586c0",
			brightCyan: "#4ec9b0",
			brightWhite: "#ffffff",
		};
	}

	/**
	 * Handle PTY process exit
	 */
	private handlePTYExit(exitCode: number): void {
		this.isConnected = false;

		const message =
			exitCode === 0
				? "Terminal session ended"
				: `Terminal exited with code ${exitCode}`;

		this.terminal.writeln(`\r\n\x1b[33m${message}\x1b[0m`);
		this.terminal.writeln("\x1b[90mPress any key to restart...\x1b[0m");

		this.setupRestartHandler();
	}

	/**
	 * Handle terminal errors
	 */
	private handleTerminalError(error: Error): void {
		console.error("Terminal error:", error);
		this.isConnected = false;

		this.terminal.writeln(
			`\r\n\x1b[31mTerminal error: ${error.message}\x1b[0m`,
		);
		this.terminal.writeln("\x1b[90mPress any key to restart...\x1b[0m");

		this.setupRestartHandler();
	}

	/**
	 * Setup restart handler
	 */
	private setupRestartHandler(): void {
		const restartDisposable = this.terminal.onKey(() => {
			restartDisposable.dispose();
			this.restartTerminal();
		});
	}

	/**
	 * Restart the terminal session
	 */
	private async restartTerminal(): Promise<void> {
		if (this.isRestarting) return;

		this.isRestarting = true;

		try {
			// Clear session
			const sessionKey = this.getSessionKey();
			shellSessions.delete(sessionKey);

			// Dispose old terminal
			this.disposeTerminal();

			// Reset state
			this.initializationState = "idle";
			this.isInitialized = false;

			// Clear shadow host
			if (this.shadowHost) {
				this.shadowHost.remove();
				this.shadowHost = null;
				this.shadowRoot = null;
				this.shadowContainer = null;
			}

			// Reinitialize
			await this.initializeTerminal();
			this.isInitialized = true;
		} catch (error) {
			console.error("Failed to restart terminal:", error);
			this.handleTerminalError(error as Error);
		} finally {
			this.isRestarting = false;
		}
	}

	/**
	 * Dispose terminal resources
	 */
	private disposeTerminal(): void {
		for (const disposable of this.disposables) {
			try {
				disposable.dispose();
			} catch {
				// Ignore disposal errors
			}
		}
		this.disposables = [];

		if (this.terminal) {
			this.terminal.dispose();
		}
	}

	/**
	 * Write data to terminal
	 */
	write(data: string): void {
		if (this.terminal) {
			this.terminal.write(data);
		}
	}

	/**
	 * Write line to terminal
	 */
	writeln(data: string): void {
		if (this.terminal) {
			this.terminal.writeln(data);
		}
	}

	/**
	 * Focus the terminal
	 */
	focus(): void {
		if (this.terminal) {
			this.terminal.focus();
		}
	}

	/**
	 * Clear the terminal
	 */
	clear(): void {
		if (this.terminal) {
			this.terminal.clear();
		}
	}

	/**
	 * Set up keyboard handlers for copy/paste
	 */
	private setupKeyboardHandlers(): void {
		this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
			return this.handleKeyboardEvent(event);
		});
	}

	/**
	 * Handle keyboard events for copy/paste
	 */
	private handleKeyboardEvent(event: KeyboardEvent): boolean {
		// Handle Ctrl+C for copy when there's a selection
		if (
			event.ctrlKey &&
			event.key === "c" &&
			this.terminal.hasSelection()
		) {
			const selection = this.terminal.getSelection();
			if (selection) {
				navigator.clipboard.writeText(selection).catch((err) => {
					console.error("Failed to copy:", err);
				});
				return false; // Prevent default
			}
		}

		// Handle Ctrl+V for paste
		if (event.ctrlKey && event.key === "v") {
			navigator.clipboard
				.readText()
				.then((text) => {
					if (text && this.terminalSession.ptyProcess) {
						this.terminalSession.ptyProcess.write(text);
					}
				})
				.catch((err) => {
					console.error("Failed to paste:", err);
				});
			return false; // Prevent default
		}

		return true; // Allow other keys
	}

	/**
	 * 设置右键上下文菜单
	 */
	private setupContextMenu(): void {
		if (!this.shadowContainer) return;

		this.shadowContainer.addEventListener(
			"contextmenu",
			(event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();

				const menu = new Menu();

				// 复制选中文本
				if (this.terminal.hasSelection()) {
					menu.addItem((item) =>
						item
							.setTitle("复制")
							.setIcon("copy")
							.onClick(() => {
								const selection = this.terminal.getSelection();
								if (selection) {
									navigator.clipboard
										.writeText(selection)
										.catch((err) => {
											console.error(
												"Failed to copy:",
												err,
											);
										});
								}
							}),
					);
				}

				// 粘贴
				menu.addItem((item) =>
					item
						.setTitle("粘贴")
						.setIcon("clipboard-paste")
						.onClick(() => {
							navigator.clipboard
								.readText()
								.then((text) => {
									if (
										text &&
										this.terminalSession.ptyProcess
									) {
										this.terminalSession.ptyProcess.write(
											text,
										);
									}
								})
								.catch((err) => {
									console.error("Failed to paste:", err);
								});
						}),
				);

				menu.addSeparator();

				// 清空终端
				menu.addItem((item) =>
					item
						.setTitle("清空终端")
						.setIcon("trash-2")
						.onClick(() => {
							this.clear();
						}),
				);

				// 全选
				menu.addItem((item) =>
					item
						.setTitle("全选")
						.setIcon("text-select")
						.onClick(() => {
							this.terminal.selectAll();
						}),
				);

				menu.addSeparator();

				// 重启终端
				menu.addItem((item) =>
					item
						.setTitle("重启终端")
						.setIcon("refresh-cw")
						.onClick(() => {
							this.restartTerminal();
						}),
				);

				// 新建终端（触发插件命令）
				menu.addItem((item) =>
					item
						.setTitle("新建终端")
						.setIcon("terminal")
						.onClick(() => {
							// 触发打开新终端命令
							(this.app as any).commands.executeCommandById(
								"obsidian-terminal-view:open-terminal",
							);
						}),
				);

				menu.showAtMouseEvent(event);
			},
		);
	}

	/**
	 * Get session key for this terminal
	 */
	private getSessionKey(): string {
		return `terminal-${this.terminalSession.id}`;
	}

	/**
	 * Restore session from saved state
	 */
	private async restoreSession(session: ShellSessionData): Promise<void> {
		try {
			this.terminal = session.terminal;
			this.fitAddon = session.fitAddon;
			this.isConnected = session.isConnected;
			this.disposables = session.disposables;

			// Create new shadow DOM for this view
			this.createShadowDOM();

			// Re-open terminal in new shadow container
			if (this.shadowContainer) {
				this.terminal.open(this.shadowContainer);
			}

			// Fit to new container
			requestAnimationFrame(() => {
				this.fitAddon.fit();
				this.terminal.focus();
			});

			this.initializationState = "ready";
			console.log("✅ Terminal session restored (Shadow DOM)");
		} catch (error) {
			console.error("Failed to restore session:", error);
			const sessionKey = this.getSessionKey();
			shellSessions.delete(sessionKey);
			await this.initializeTerminal();
		}
	}
}
