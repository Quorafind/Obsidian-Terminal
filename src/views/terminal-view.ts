import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import {
	init as initGhostty,
	Terminal as GhosttyTerminal,
	FitAddon as GhosttyFitAddon,
} from "ghostty-web";
import { WorkspaceLeaf, Menu } from "obsidian";
import {
	TerminalView as BaseTerminalView,
	TerminalSession,
	TerminalPluginError,
	TerminalErrorType,
	Terminal,
} from "@/types";
import {
	VIEW_TYPE_TERMINAL,
	TERMINAL_VIEW_DISPLAY_TEXT,
	DEFAULT_TERMINAL_DIMENSIONS,
} from "@/constants";
import type TerminalPlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/settings";

// Import xterm.js CSS as string for Shadow DOM injection
import xtermCss from "@xterm/xterm/css/xterm.css?inline";

// Type alias for FitAddon (xterm.js or ghostty-web)
type FitAddon = XTermFitAddon | GhosttyFitAddon;

// Track Ghostty WASM initialization state
let ghosttyInitialized = false;
let ghosttyInitPromise: Promise<void> | null = null;

/**
 * Reset Ghostty WASM state on plugin unload
 * This allows proper reinitialization on hot reload
 */
export function resetGhosttyState(): void {
	ghosttyInitialized = false;
	ghosttyInitPromise = null;
	shellSessions.clear();
	console.log("✅ Ghostty state reset for hot reload");
}

/**
 * Shadow DOM styles for terminal
 * Uses CSS variables from Obsidian for theming
 */
const shadowStyles = `
/* Import xterm base styles */
${xtermCss}

/* CSS Variables inherited from Obsidian */
:host {
  --terminal-bg: var(--background-secondary, #1e1e1e);
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
  background: var(--terminal-bg) !important;
}

.xterm-cursor {
  outline-color: var(--text-accent);
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

.xterm-dom-renderer-owner-1 .xterm-screen .xterm-rows {
  color: var(--terminal-fg);
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
	plugin: TerminalPlugin;

	private shadowHost: HTMLElement | null = null;
	private shadowRoot: ShadowRoot | null = null;
	private shadowContainer: HTMLElement | null = null;
	private fitAddon!: FitAddon;
	private webLinksAddon?: WebLinksAddon;
	private imeTextarea?: HTMLTextAreaElement;
	private isComposing = false;
	private disposables: Array<{ dispose(): void }> = [];
	private isInitialized = false;
	private isConnected = false;
	private isRestarting = false;
	private initializationState: "idle" | "initializing" | "ready" | "error" =
		"idle";

	constructor(
		leaf: WorkspaceLeaf,
		terminalSession: TerminalSession,
		plugin: TerminalPlugin,
	) {
		super(leaf);
		this.terminalSession = terminalSession;
		this.plugin = plugin;
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

		// Skip resize when container is not visible (e.g., background tab with display:none)
		// This prevents FitAddon from calculating incorrect dimensions (0x0)
		if (
			this.terminalViewContainer.offsetWidth === 0 ||
			this.terminalViewContainer.offsetHeight === 0
		) {
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
	 * Check if Ghostty renderer is enabled
	 */
	private get useGhostty(): boolean {
		return this.plugin.settings?.useGhostty ?? false;
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
			// Initialize Ghostty WASM if needed (once per app lifecycle)
			if (this.useGhostty) {
				await this.ensureGhosttyInitialized();
			}

			this.createShadowDOM();
			this.createTerminalInstance();
			this.loadAddons();
			this.openTerminalInShadow();
			this.connectToPTY();
			this.setupKeyboardHandlers();
			this.setupContextMenu();

			// Setup IME support for Ghostty mode
			if (this.useGhostty) {
				this.setupGhosttyIME();
			}

			// Initial fit after a short delay to ensure DOM is ready
			requestAnimationFrame(() => {
				this.fitAddon.fit();
				// In Ghostty mode, focus IME textarea for keyboard input
				// In xterm.js mode, focus terminal directly
				if (this.useGhostty && this.imeTextarea) {
					this.imeTextarea.focus();
				} else {
					this.terminal.focus();
				}
			});

			this.initializationState = "ready";
			const renderer = this.useGhostty ? "Ghostty" : "xterm.js";
			console.log(`✅ Terminal initialization complete (${renderer})`);
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
	 * Ensure Ghostty WASM is initialized (singleton pattern)
	 */
	private async ensureGhosttyInitialized(): Promise<void> {
		if (ghosttyInitialized) return;

		if (!ghosttyInitPromise) {
			ghosttyInitPromise = initGhostty().then(() => {
				ghosttyInitialized = true;
				console.log("✅ Ghostty WASM initialized");
			});
		}

		await ghosttyInitPromise;
	}

	/**
	 * Setup IME (Input Method Editor) support for Ghostty mode
	 * Ghostty-web doesn't natively support IME, so we create a hidden textarea
	 * to capture composition events and forward the final text to the terminal.
	 */
	private setupGhosttyIME(): void {
		if (!this.shadowContainer) return;

		// Create hidden textarea for IME input
		this.imeTextarea = document.createElement("textarea");
		this.imeTextarea.setAttribute("autocorrect", "off");
		this.imeTextarea.setAttribute("autocapitalize", "off");
		this.imeTextarea.setAttribute("spellcheck", "false");
		this.imeTextarea.setAttribute("aria-label", "Terminal IME input");

		// Style to be invisible but still functional for IME
		Object.assign(this.imeTextarea.style, {
			position: "absolute",
			left: "0",
			top: "0",
			width: "0px",
			height: "0px",
			opacity: "0",
			zIndex: "-5",
			overflow: "hidden",
			resize: "none",
			border: "none",
			outline: "none",
			padding: "0",
			margin: "0",
			pointerEvents: "none",
		});

		this.shadowContainer.appendChild(this.imeTextarea);

		// Composition start - user begins IME input
		const onCompositionStart = () => {
			this.isComposing = true;
		};

		// Composition end - user confirms IME input
		const onCompositionEnd = (e: CompositionEvent) => {
			this.isComposing = false;
			const text = e.data;
			if (text && this.terminalSession.ptyProcess) {
				this.terminalSession.ptyProcess.write(text);
			}
			// Clear textarea for next input
			if (this.imeTextarea) {
				this.imeTextarea.value = "";
			}
			// In Ghostty mode, keep focus on IME textarea for keyboard handling
			// (Ghostty's native keyboard handling doesn't work well in Electron)
		};

		// Handle keydown in IME textarea - forward non-IME keys to terminal
		const onTextareaKeyDown = (e: KeyboardEvent) => {
			// During composition, let textarea handle it
			if (this.isComposing || e.isComposing) {
				return;
			}

			const key = e.key;

			// Allow modifier keys to pass through for IME switching (e.g., Shift to toggle input method)
			if (
				key === "Shift" ||
				key === "Control" ||
				key === "Alt" ||
				key === "Meta" ||
				key === "CapsLock"
			) {
				return;
			}

			// For control keys, forward to PTY directly
			let data: string | null = null;

			switch (key) {
				case "Backspace":
					data = "\x7f"; // DEL character
					break;
				case "Delete":
					data = "\x1b[3~";
					break;
				case "Enter":
					data = "\r";
					break;
				case "Tab":
					data = "\t";
					break;
				case "Escape":
					data = "\x1b";
					break;
				case "ArrowUp":
					data = "\x1b[A";
					break;
				case "ArrowDown":
					data = "\x1b[B";
					break;
				case "ArrowRight":
					data = "\x1b[C";
					break;
				case "ArrowLeft":
					data = "\x1b[D";
					break;
				case "Home":
					data = "\x1b[H";
					break;
				case "End":
					data = "\x1b[F";
					break;
				case "PageUp":
					data = "\x1b[5~";
					break;
				case "PageDown":
					data = "\x1b[6~";
					break;
				case "Insert":
					data = "\x1b[2~";
					break;
				case "F1":
					data = "\x1bOP";
					break;
				case "F2":
					data = "\x1bOQ";
					break;
				case "F3":
					data = "\x1bOR";
					break;
				case "F4":
					data = "\x1bOS";
					break;
				case "F5":
					data = "\x1b[15~";
					break;
				case "F6":
					data = "\x1b[17~";
					break;
				case "F7":
					data = "\x1b[18~";
					break;
				case "F8":
					data = "\x1b[19~";
					break;
				case "F9":
					data = "\x1b[20~";
					break;
				case "F10":
					data = "\x1b[21~";
					break;
				case "F11":
					data = "\x1b[23~";
					break;
				case "F12":
					data = "\x1b[24~";
					break;
			}

			// Handle Ctrl+key combinations
			if (e.ctrlKey && key.length === 1) {
				const charCode = key.toUpperCase().charCodeAt(0);
				if (charCode >= 65 && charCode <= 90) {
					// A-Z -> Ctrl+A to Ctrl+Z
					data = String.fromCharCode(charCode - 64);
				} else if (key === "[") {
					data = "\x1b"; // Ctrl+[ = Escape
				} else if (key === "\\") {
					data = "\x1c"; // Ctrl+\
				} else if (key === "]") {
					data = "\x1d"; // Ctrl+]
				} else if (key === "^" || key === "6") {
					data = "\x1e"; // Ctrl+^
				} else if (key === "_" || key === "-") {
					data = "\x1f"; // Ctrl+_
				}
			}

			// Handle Alt+key combinations (send ESC prefix)
			if (e.altKey && !e.ctrlKey && !e.metaKey && key.length === 1) {
				data = "\x1b" + key;
			}

			if (data !== null) {
				e.preventDefault();
				e.stopPropagation();
				if (this.terminalSession.ptyProcess) {
					this.terminalSession.ptyProcess.write(data);
				}
				// Clear textarea to prevent accumulation
				if (this.imeTextarea) {
					this.imeTextarea.value = "";
				}
				return;
			}

			// For printable characters (single char, no ctrl/alt/meta),
			// send directly to PTY instead of relying on input event
			if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
				e.preventDefault();
				e.stopPropagation();
				if (this.terminalSession.ptyProcess) {
					this.terminalSession.ptyProcess.write(key);
				}
				// Clear textarea to prevent accumulation
				if (this.imeTextarea) {
					this.imeTextarea.value = "";
				}
				return;
			}
		};

		// Handle input events (backup for any input that bypasses keydown)
		const onInput = (e: Event) => {
			if (this.isComposing) return; // Skip during composition
			const target = e.target as HTMLTextAreaElement;
			const text = target.value;
			if (text && this.terminalSession.ptyProcess) {
				this.terminalSession.ptyProcess.write(text);
			}
			target.value = "";
		};

		this.imeTextarea.addEventListener(
			"compositionstart",
			onCompositionStart,
		);
		this.imeTextarea.addEventListener("compositionend", onCompositionEnd);
		this.imeTextarea.addEventListener("keydown", onTextareaKeyDown);
		this.imeTextarea.addEventListener("input", onInput);

		this.disposables.push({
			dispose: () => {
				this.imeTextarea?.removeEventListener(
					"compositionstart",
					onCompositionStart,
				);
				this.imeTextarea?.removeEventListener(
					"compositionend",
					onCompositionEnd,
				);
				this.imeTextarea?.removeEventListener(
					"keydown",
					onTextareaKeyDown,
				);
				this.imeTextarea?.removeEventListener("input", onInput);
			},
		});

		// Intercept keyboard events on the terminal container to redirect to IME textarea
		const container = this.shadowContainer;
		const onContainerKeyDown = (e: KeyboardEvent) => {
			// Check if this might trigger IME (non-ASCII input or specific keys)
			// For CJK input methods, the key is often "Process" or the event.isComposing is true
			if (e.key === "Process" || e.isComposing) {
				e.preventDefault();
				e.stopPropagation();
				this.imeTextarea?.focus();
				return;
			}
		};

		container.addEventListener("keydown", onContainerKeyDown, {
			capture: true,
		});
		this.disposables.push({
			dispose: () =>
				container.removeEventListener("keydown", onContainerKeyDown, {
					capture: true,
				}),
		});

		// When clicking on terminal, focus IME textarea to enable IME input
		const onClick = () => {
			if (this.imeTextarea && this.useGhostty) {
				this.imeTextarea.focus();
			}
		};

		container.addEventListener("click", onClick);
		this.disposables.push({
			dispose: () => container.removeEventListener("click", onClick),
		});

		// Block Ghostty's native contextmenu handler which causes layout shift
		// Ghostty registers its handler on the container element (A in open(A))
		// We intercept in capture phase and show our own menu instead
		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
			e.stopImmediatePropagation();
			// Manually show our context menu
			this.showContextMenu(e);
		};

		container.addEventListener("contextmenu", onContextMenu, {
			capture: true,
		});
		this.disposables.push({
			dispose: () =>
				container.removeEventListener("contextmenu", onContextMenu, {
					capture: true,
				}),
		});

		console.log("✅ Ghostty IME support initialized");
	}

	/**
	 * Create Shadow DOM for style isolation
	 */
	private createShadowDOM(): void {
		// Create shadow host element
		this.shadowHost = createEl("div", {
			cls: "terminal-shadow-host",
		});
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
		this.shadowContainer = this.shadowRoot.createEl("div", {
			cls: "terminal-shadow-container",
		});

		// Append shadow host to view container
		this.terminalViewContainer.appendChild(this.shadowHost);

		console.log("✅ Shadow DOM created");
	}

	/**
	 * Create terminal instance (xterm.js or ghostty-web)
	 */
	private createTerminalInstance(): void {
		const theme = this.plugin.themeColors;

		// 从插件设置读取配置，提供安全回退值
		const settings = this.plugin.settings;
		const fontSize = settings?.fontSize ?? DEFAULT_SETTINGS.fontSize;
		const fontFamily = this.useGhostty
			? "'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace"
			: (settings?.fontFamily ?? DEFAULT_SETTINGS.fontFamily);
		const cursorBlink =
			settings?.cursorBlink ?? DEFAULT_SETTINGS.cursorBlink;
		const scrollback = settings?.scrollback ?? DEFAULT_SETTINGS.scrollback;

		const terminalOptions = {
			fontSize,
			fontFamily,
			cursorBlink,
			cursorStyle: "block" as const,
			theme,
			cols: DEFAULT_TERMINAL_DIMENSIONS.cols,
			rows: DEFAULT_TERMINAL_DIMENSIONS.rows,
			scrollback,
		};

		if (this.useGhostty) {
			// Create Ghostty terminal instance
			this.terminal = new GhosttyTerminal(terminalOptions);
			console.log("✅ Ghostty Terminal instance created");
		} else {
			// Create xterm.js terminal instance
			this.terminal = new XTerminal({
				...terminalOptions,
				allowTransparency: true,
				// 启用 Windows 模式以更好支持 ConPTY
				windowsMode: process.platform === "win32",
				// 允许透明度以支持 Obsidian 主题
				allowProposedApi: true,
			});
			console.log("✅ xterm.js Terminal instance created");
		}
	}

	/**
	 * Load terminal addons
	 */
	private loadAddons(): void {
		if (this.useGhostty) {
			// Ghostty has built-in FitAddon, no need for WebLinksAddon (has built-in link detection)
			this.fitAddon = new GhosttyFitAddon();
			this.terminal.loadAddon(this.fitAddon);
			console.log("✅ Ghostty addons loaded");
		} else {
			// xterm.js addons
			this.fitAddon = new XTermFitAddon();
			this.webLinksAddon = new WebLinksAddon();
			this.terminal.loadAddon(this.fitAddon);
			this.terminal.loadAddon(this.webLinksAddon);
			console.log("✅ xterm.js addons loaded");
		}
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
	 * Update terminal theme colors
	 * Called by plugin when Obsidian theme changes (css-change event)
	 */
	updateTheme(theme: Record<string, string>): void {
		console.log("🎨 updateTheme called", {
			useGhostty: this.useGhostty,
			hasTerminal: !!this.terminal,
		});

		if (!this.terminal) return;

		if (this.useGhostty) {
			// ghostty-web 0.3.0 limitation: theme changes after open() are not supported
			// Cell colors are baked into WASM memory. We must rebuild the terminal.
			this.rebuildGhosttyTerminal(theme);
		} else {
			// xterm.js handles theme changes automatically via options
			this.terminal.options.theme = theme;
		}
	}

	/**
	 * Rebuild Ghostty terminal with new theme
	 * Extracts buffer content, destroys terminal, creates new one with new theme,
	 * and restores the buffer content.
	 */
	private rebuildGhosttyTerminal(theme: Record<string, string>): void {
		if (!this.useGhostty || !this.terminal || !this.shadowContainer) {
			return;
		}

		console.log("🔄 Rebuilding Ghostty terminal with new theme");

		const term = this.terminal as any;

		// Step 1: Extract buffer content as plain text
		const bufferContent = this.extractGhosttyBuffer(term);
		console.log("🔄 Extracted buffer:", bufferContent.length, "lines");

		// Step 2: Get current dimensions
		const cols = term.cols ?? DEFAULT_TERMINAL_DIMENSIONS.cols;
		const rows = term.rows ?? DEFAULT_TERMINAL_DIMENSIONS.rows;

		// Step 3: Dispose old terminal (but keep PTY connection)
		// Remove terminal-specific disposables, keep PTY handlers
		if (this.fitAddon) {
			try {
				this.fitAddon.dispose();
			} catch {
				// Ignore
			}
			this.fitAddon = null as any;
		}

		// Clear the shadow container
		if (this.shadowContainer) {
			this.shadowContainer.innerHTML = "";
		}

		// Dispose old terminal
		try {
			this.terminal.dispose();
		} catch {
			// Ignore disposal errors
		}

		// Step 4: Create new terminal with new theme
		const settings = this.plugin.settings;
		const fontSize = settings?.fontSize ?? DEFAULT_SETTINGS.fontSize;
		const fontFamily =
			"'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace";
		const cursorBlink =
			settings?.cursorBlink ?? DEFAULT_SETTINGS.cursorBlink;
		const scrollback = settings?.scrollback ?? DEFAULT_SETTINGS.scrollback;

		this.terminal = new GhosttyTerminal({
			fontSize,
			fontFamily,
			cursorBlink,
			cursorStyle: "block" as const,
			theme,
			cols,
			rows,
			scrollback,
		});

		console.log("🔄 New Ghostty terminal created");

		// Step 5: Load addons
		this.fitAddon = new GhosttyFitAddon();
		this.terminal.loadAddon(this.fitAddon);

		// Step 6: Open in shadow container
		this.terminal.open(this.shadowContainer);

		// Step 7: Reconnect data handler (PTY output -> terminal)
		// Note: PTY -> terminal handler was on ptyProcess, still active
		// We only need to reconnect terminal -> PTY (user input)
		const { ptyProcess } = this.terminalSession;
		const dataDisposable = this.terminal.onData((data: string) => {
			try {
				ptyProcess.write(data);
			} catch (error) {
				console.error("Failed to write to PTY:", error);
			}
		});
		this.disposables.push(dataDisposable);

		// Step 8: Restore buffer content
		if (bufferContent.length > 0) {
			// Write content back (convert to terminal format with CRLF)
			const content = bufferContent.join("\r\n");
			this.terminal.write(content);
		}

		// Step 9: Fit to container
		requestAnimationFrame(() => {
			if (this.fitAddon) {
				try {
					this.fitAddon.fit();
				} catch {
					// Ignore fit errors
				}
			}
		});

		console.log("🔄 Ghostty terminal rebuild complete");
	}

	/**
	 * Extract text content from Ghostty terminal buffer
	 */
	private extractGhosttyBuffer(term: any): string[] {
		const lines: string[] = [];

		if (!term.wasmTerm) {
			return lines;
		}

		const wasmTerm = term.wasmTerm;
		const dims = wasmTerm.getDimensions();
		const scrollbackLen = wasmTerm.getScrollbackLength();

		// Extract scrollback lines
		for (let i = 0; i < scrollbackLen; i++) {
			const cells = wasmTerm.getScrollbackLine(i);
			if (cells) {
				lines.push(this.cellsToString(cells));
			}
		}

		// Extract visible screen lines
		for (let y = 0; y < dims.rows; y++) {
			const cells = wasmTerm.getLine(y);
			if (cells) {
				lines.push(this.cellsToString(cells));
			}
		}

		// Trim trailing empty lines
		while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
			lines.pop();
		}

		return lines;
	}

	/**
	 * Convert GhosttyCell array to string
	 */
	private cellsToString(cells: any[]): string {
		let str = "";
		for (const cell of cells) {
			if (cell.codepoint > 0) {
				str += String.fromCodePoint(cell.codepoint);
			} else if (cell.width > 0) {
				str += " ";
			}
		}
		// Trim trailing spaces
		return str.trimEnd();
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
			// Clear shell session cache
			const sessionKey = this.getSessionKey();
			shellSessions.delete(sessionKey);

			// Dispose old terminal UI
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

			// Restart PTY session via manager (kills old PTY, creates new one)
			const newSession =
				await this.plugin.terminalManager.restartTerminal(
					this.terminalSession.id,
				);
			this.terminalSession = newSession;

			// Reinitialize terminal UI
			await this.initializeTerminal();
			this.isInitialized = true;

			console.log("✅ Terminal restarted successfully");
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
		// In Ghostty mode, focus IME textarea for keyboard input
		if (this.useGhostty && this.imeTextarea) {
			this.imeTextarea.focus();
		} else if (this.terminal) {
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
	 * Apply settings update to terminal
	 * Called when user changes settings to apply changes immediately
	 */
	applySettings(): void {
		if (!this.terminal || !this.plugin.settings) return;

		const { fontSize, fontFamily, cursorBlink, scrollback } =
			this.plugin.settings;

		this.terminal.options.fontSize = fontSize;
		this.terminal.options.fontFamily = fontFamily;
		this.terminal.options.cursorBlink = cursorBlink;
		this.terminal.options.scrollback = scrollback;

		// 字体大小变更后需要重新适配尺寸
		this.resize();
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

		// For Ghostty mode, contextmenu is handled in setupGhosttyIME
		// to intercept before Ghostty's handler causes layout shift
		if (this.useGhostty) return;

		this.shadowContainer.addEventListener(
			"contextmenu",
			(event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				this.showContextMenu(event);
			},
		);
	}

	/**
	 * 显示右键上下文菜单
	 */
	private showContextMenu(event: MouseEvent): void {
		const menu = new Menu();

		// Copy selected text
		if (this.terminal.hasSelection()) {
			menu.addItem((item) =>
				item
					.setTitle("Copy")
					.setIcon("copy")
					.onClick(() => {
						const selection = this.terminal.getSelection();
						if (selection) {
							navigator.clipboard
								.writeText(selection)
								.catch((err) => {
									console.error("Failed to copy:", err);
								});
						}
					}),
			);
		}

		// Paste
		menu.addItem((item) =>
			item
				.setTitle("Paste")
				.setIcon("clipboard-paste")
				.onClick(() => {
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
				}),
		);

		menu.addSeparator();

		// Clear terminal
		menu.addItem((item) =>
			item
				.setTitle("Clear")
				.setIcon("trash-2")
				.onClick(() => {
					this.clear();
				}),
		);

		// Select all
		menu.addItem((item) =>
			item
				.setTitle("Select All")
				.setIcon("text-select")
				.onClick(() => {
					this.terminal.selectAll();
				}),
		);

		menu.addSeparator();

		// Restart terminal
		menu.addItem((item) =>
			item
				.setTitle("Restart")
				.setIcon("refresh-cw")
				.onClick(() => {
					this.restartTerminal();
				}),
		);

		// New terminal (trigger plugin command)
		menu.addItem((item) =>
			item
				.setTitle("New Terminal")
				.setIcon("terminal")
				.onClick(() => {
					(this.app as any).commands.executeCommandById(
						"obsidian-terminal-view:open-terminal",
					);
				}),
		);

		menu.showAtMouseEvent(event);
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
