/**
 * Plugin constants and configuration
 */

export const PLUGIN_ID = "terminal";
export const PLUGIN_NAME = "Terminal";

export const VIEW_TYPE_TERMINAL = "terminal-view";
export const TERMINAL_VIEW_DISPLAY_TEXT = "Terminal";

export const COMMAND_OPEN_TERMINAL = "open-terminal";
export const COMMAND_OPEN_TERMINAL_NAME = "Open";

// Custom ribbon icon for terminal (distinct from Obsidian's built-in terminal icon)
export const RIBBON_ICON_ID = "terminal-box";
export const RIBBON_ICON_SVG = `
<rect x="12" y="12" width="76" height="76" rx="16" ry="16" stroke="currentColor" stroke-width="8" fill="none" />
<path d="M 28 36 L 42 50 L 28 64" stroke="currentColor" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
<line x1="52" y1="64" x2="72" y2="64" stroke="currentColor" stroke-width="8" stroke-linecap="round" />
`;

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
	fontFamily: "'Monaco', 'Menlo', 'Consolas', 'Courier New', monospace",
} as const;
