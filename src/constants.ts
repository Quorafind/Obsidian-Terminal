/**
 * Plugin constants and configuration
 */

export const PLUGIN_ID = "obsidian-terminal-view";
export const PLUGIN_NAME = "Terminal View";

export const VIEW_TYPE_TERMINAL = "terminal-view";
export const TERMINAL_VIEW_DISPLAY_TEXT = "Terminal";

export const COMMAND_OPEN_TERMINAL = "open-terminal";
export const COMMAND_OPEN_TERMINAL_NAME = "打开终端";

export const DEFAULT_TERMINAL_DIMENSIONS = {
	cols: 80,
	rows: 24,
};

export const TERMINAL_BUFFER_SIZE = 1000;
export const TERMINAL_SCROLL_BACK = 1000;

export const PLATFORM_SHELLS = {
	win32: "powershell.exe",
	darwin: "/bin/zsh",
	linux: "/bin/bash",
} as const;

/**
 * Ghostty terminal default configuration
 * Theme colors are dynamically extracted from Obsidian CSS variables at runtime
 */
export const GHOSTTY_OPTIONS = {
	fontSize: 14,
	fontFamily:
		'var(--font-monospace-default, Consolas), "Cascadia Mono", Menlo, Monaco, monospace',
} as const;
