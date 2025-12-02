/**
 * Native Module Configuration
 *
 * This module provides configuration for native PTY binaries.
 * Binaries are downloaded from GitHub Release at runtime, not embedded in the plugin.
 *
 * @module embedded-modules
 */

/**
 * Module metadata and configuration
 */
export const MODULE_INFO = {
	electronVersion: "37.10.2",
	nodeABI: 136,
	supportedPlatforms: [
		"win32_x64",
		"darwin_x64",
		"darwin_arm64",
		"linux_x64",
	],
} as const;

/**
 * Required binary files per platform
 */
export const PLATFORM_BINARIES: Record<string, string[]> = {
	win32_x64: ["pty.node", "conpty.node"],
	darwin_x64: ["pty.node"],
	darwin_arm64: ["pty.node"],
	linux_x64: ["pty.node"],
};

/**
 * Get required files for a platform
 */
export function getRequiredFilesForPlatform(
	platform: string = process.platform,
	arch: string = process.arch,
): string[] {
	const key = `${platform}_${arch}`;
	return PLATFORM_BINARIES[key] || [];
}

/**
 * Check if a platform is supported
 */
export function isPlatformSupported(
	platform: string = process.platform,
	arch: string = process.arch,
): boolean {
	const key = `${platform}_${arch}`;
	return (MODULE_INFO.supportedPlatforms as readonly string[]).includes(key);
}
