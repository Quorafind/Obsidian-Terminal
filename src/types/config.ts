/**
 * Terminal configuration interface
 */
export interface TerminalConfig {
	defaultShell: string;
	shellArgs: string[];
	workingDirectory: string;
	environment: Record<string, string>;
	theme: TerminalTheme;
	font: FontConfig;
	behavior: BehaviorConfig;
}

/**
 * Terminal theme configuration
 */
export interface TerminalTheme {
	background: string;
	foreground: string;
	cursor: string;
	selection: string;
	colors: {
		black: string;
		red: string;
		green: string;
		yellow: string;
		blue: string;
		magenta: string;
		cyan: string;
		white: string;
		brightBlack: string;
		brightRed: string;
		brightGreen: string;
		brightYellow: string;
		brightBlue: string;
		brightMagenta: string;
		brightCyan: string;
		brightWhite: string;
	};
}

/**
 * Font configuration
 */
export interface FontConfig {
	family: string;
	size: number;
	weight: string;
	lineHeight: number;
}

/**
 * Behavior configuration
 */
export interface BehaviorConfig {
	cursorBlink: boolean;
	scrollback: number;
	tabStopWidth: number;
	bellSound: boolean;
	rightClickSelectsWord: boolean;
}

/**
 * Default terminal configuration
 */
export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
	defaultShell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
	shellArgs: [],
	workingDirectory: process.cwd(),
	environment: Object.fromEntries(
		Object.entries(process.env).filter(([_, value]) => value !== undefined)
	) as Record<string, string>,
	theme: {
		background: "#1e1e1e",
		foreground: "#d4d4d4",
		cursor: "#d4d4d4",
		selection: "#264f78",
		colors: {
			black: "#000000",
			red: "#cd3131",
			green: "#0dbc79",
			yellow: "#e5e510",
			blue: "#2472c8",
			magenta: "#bc3fbc",
			cyan: "#11a8cd",
			white: "#e5e5e5",
			brightBlack: "#666666",
			brightRed: "#f14c4c",
			brightGreen: "#23d18b",
			brightYellow: "#f5f543",
			brightBlue: "#3b8eea",
			brightMagenta: "#d670d6",
			brightCyan: "#29b8db",
			brightWhite: "#e5e5e5",
		},
	},
	font: {
		family: 'Consolas, "Courier New", monospace',
		size: 14,
		weight: "normal",
		lineHeight: 1.2,
	},
	behavior: {
		cursorBlink: true,
		scrollback: 1000,
		tabStopWidth: 4,
		bellSound: false,
		rightClickSelectsWord: true,
	},
};
