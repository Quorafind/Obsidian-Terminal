#!/usr/bin/env node
/**
 * Embed native modules as base64 strings (Multi-platform support)
 *
 * This script embeds compiled node-pty native modules into a TypeScript file
 * so they can be extracted at runtime without requiring npm install.
 *
 * Usage:
 *   npm run embed                    # Embed current platform
 *   npm run embed -- --platform win32_x64    # Embed specific platform
 *   npm run embed -- --merge         # Merge with existing embeddings
 *   npm run embed -- --list          # List embedded platforms
 *
 * Prerequisites:
 *   - Run `npm run rebuild:electron` first to compile the native modules
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

// Configuration
const CONFIG = {
	electronVersion: "37.10.2",
	nodeABI: 136,
};

// Supported platforms
const SUPPORTED_PLATFORMS = [
	"win32_x64",
	"darwin_x64",
	"darwin_arm64",
	"linux_x64",
];

// Possible binary locations (in priority order)
const BINARY_SEARCH_PATHS = [
	join(ROOT_DIR, "node_modules", "node-pty", "build", "Release"),
	join(
		ROOT_DIR,
		"node_modules",
		".pnpm",
		"node-pty@1.0.0",
		"node_modules",
		"node-pty",
		"build",
		"Release",
	),
];

// Platform-specific binary files
// Note: Windows 7/8 support (winpty) removed, only ConPTY for Windows 10+
const PLATFORM_BINARIES = {
	win32: ["pty.node", "conpty.node"],
	darwin: ["pty.node"],
	linux: ["pty.node"],
};

const OUTPUT_FILE = join(ROOT_DIR, "src", "core", "embedded-modules.ts");

/**
 * Parse command line arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const result = {
		platform: null,
		merge: false,
		list: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--platform" && args[i + 1]) {
			result.platform = args[++i];
		} else if (arg === "--merge") {
			result.merge = true;
		} else if (arg === "--list") {
			result.list = true;
		}
	}

	return result;
}

/**
 * Get current platform key
 */
function getCurrentPlatformKey() {
	return `${process.platform}_${process.arch}`;
}

/**
 * Parse platform key into platform and arch
 */
function parsePlatformKey(key) {
	const [platform, arch] = key.split("_");
	return { platform, arch };
}

/**
 * Find the binary directory
 */
function findBinaryDir() {
	for (const searchPath of BINARY_SEARCH_PATHS) {
		if (existsSync(searchPath)) {
			const requiredFiles = PLATFORM_BINARIES[process.platform] || [];
			const hasRequired = requiredFiles.some((f) =>
				existsSync(join(searchPath, f)),
			);
			if (hasRequired) {
				return searchPath;
			}
		}
	}
	return null;
}

/**
 * Calculate SHA256 hash of a buffer
 */
function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Load existing embedded modules
 */
function loadExistingModules() {
	if (!existsSync(OUTPUT_FILE)) {
		return { platforms: {}, files: {} };
	}

	try {
		const content = readFileSync(OUTPUT_FILE, "utf8");

		// Extract EMBEDDED_PLATFORMS
		const platformsMatch = content.match(
			/export const EMBEDDED_PLATFORMS:\s*Record<string,\s*Record<string,\s*string>>\s*=\s*({[\s\S]*?});/,
		);

		// Extract EMBEDDED_FILES
		const filesMatch = content.match(
			/export const EMBEDDED_FILES:\s*Record<string,\s*Array<[\s\S]*?>>\s*=\s*({[\s\S]*?});/,
		);

		let platforms = {};
		let files = {};

		if (platformsMatch) {
			try {
				// Simple JSON-like parsing (works for our generated format)
				platforms = eval(`(${platformsMatch[1]})`);
			} catch {
				console.warn("⚠️  Could not parse existing EMBEDDED_PLATFORMS");
			}
		}

		if (filesMatch) {
			try {
				files = eval(`(${filesMatch[1]})`);
			} catch {
				console.warn("⚠️  Could not parse existing EMBEDDED_FILES");
			}
		}

		return { platforms, files };
	} catch (error) {
		console.warn(
			"⚠️  Could not load existing embedded modules:",
			error.message,
		);
		return { platforms: {}, files: {} };
	}
}

/**
 * List embedded platforms
 */
function listEmbeddedPlatforms() {
	const { platforms, files } = loadExistingModules();
	const platformKeys = Object.keys(platforms);

	console.log("");
	console.log("📦 Embedded Platforms:");
	console.log("");

	if (platformKeys.length === 0) {
		console.log("   (none)");
	} else {
		for (const key of platformKeys) {
			const platformFiles = files[key] || [];
			const totalSize = platformFiles.reduce((acc, f) => acc + f.size, 0);
			console.log(`   ✅ ${key}`);
			for (const f of platformFiles) {
				console.log(
					`      - ${f.name} (${Math.round(f.size / 1024)} KB)`,
				);
			}
			console.log(`      Total: ${Math.round(totalSize / 1024)} KB`);
			console.log("");
		}
	}

	console.log("📋 Supported platforms:");
	for (const p of SUPPORTED_PLATFORMS) {
		const status = platformKeys.includes(p) ? "✅" : "⬜";
		console.log(`   ${status} ${p}`);
	}
	console.log("");
}

/**
 * Embed native modules for current platform
 */
function embedNativeModules(options) {
	const platformKey = options.platform || getCurrentPlatformKey();
	const { platform } = parsePlatformKey(platformKey);

	console.log("🔄 Embedding native modules as base64...");
	console.log(
		`📦 Target: Electron ${CONFIG.electronVersion} (ABI ${CONFIG.nodeABI})`,
	);
	console.log(`🖥️  Platform: ${platformKey}`);
	console.log(`🔀 Merge mode: ${options.merge ? "enabled" : "disabled"}`);
	console.log("");

	// Load existing modules if merging
	let existingData = { platforms: {}, files: {} };
	if (options.merge) {
		existingData = loadExistingModules();
		const existingPlatforms = Object.keys(existingData.platforms);
		if (existingPlatforms.length > 0) {
			console.log(
				`📂 Existing platforms: ${existingPlatforms.join(", ")}`,
			);
		}
	}

	const binaryDir = findBinaryDir();
	if (!binaryDir) {
		console.error("❌ No binary directory found!");
		console.error("   Please run 'npm run rebuild:electron' first.");
		console.error("");
		console.error("   Searched paths:");
		for (const p of BINARY_SEARCH_PATHS) {
			console.error(`     - ${p}`);
		}
		process.exit(1);
	}

	console.log(`📂 Binary directory: ${binaryDir}`);
	console.log("");

	const modules = {};
	const fileInfos = [];
	const requiredFiles = PLATFORM_BINARIES[platform] || [];

	for (const fileName of requiredFiles) {
		const filePath = join(binaryDir, fileName);

		if (existsSync(filePath)) {
			const buffer = readFileSync(filePath);
			const base64 = buffer.toString("base64");
			const hash = sha256(buffer);

			// Use filename without extension as key for .node files
			const key = fileName.endsWith(".node")
				? fileName.replace(".node", "")
				: fileName;

			modules[key] = base64;
			fileInfos.push({
				name: fileName,
				key,
				size: buffer.length,
				sha256: hash,
			});

			const sizeKB = Math.round(buffer.length / 1024);
			console.log(`✅ Embedded: ${fileName} (${sizeKB} KB)`);
		} else {
			console.warn(`⚠️  Missing: ${fileName}`);
		}
	}

	if (Object.keys(modules).length === 0) {
		console.error("❌ No native modules found to embed!");
		process.exit(1);
	}

	// Merge with existing data
	const allPlatforms = { ...existingData.platforms, [platformKey]: modules };
	const allFiles = { ...existingData.files, [platformKey]: fileInfos };

	// Calculate total size
	let totalSize = 0;
	let totalFileCount = 0;
	for (const key of Object.keys(allFiles)) {
		const platformFiles = allFiles[key];
		totalSize += platformFiles.reduce((acc, f) => acc + f.size, 0);
		totalFileCount += platformFiles.length;
	}

	// Generate TypeScript file
	const tsContent = generateTypeScriptFile(
		allPlatforms,
		allFiles,
		totalSize,
		totalFileCount,
	);

	writeFileSync(OUTPUT_FILE, tsContent, "utf8");

	console.log("");
	console.log(`📝 Generated: ${OUTPUT_FILE}`);
	console.log(`📊 Total embedded size: ${Math.round(totalSize / 1024)} KB`);
	console.log(`📄 Files embedded: ${totalFileCount}`);
	console.log(`🖥️  Platforms: ${Object.keys(allPlatforms).join(", ")}`);
	console.log("");
	console.log("✅ Native modules embedded successfully!");
	console.log("");
	console.log("Next steps:");
	console.log("  1. Run 'npm run build' to build the plugin");
	console.log("  2. The embedded modules will be available in settings");
	if (Object.keys(allPlatforms).length < SUPPORTED_PLATFORMS.length) {
		console.log("");
		console.log("💡 To add more platforms:");
		console.log("   - Build on macOS: npm run embed -- --merge");
		console.log("   - Build on Linux: npm run embed -- --merge");
	}
}

/**
 * Generate TypeScript file content
 */
function generateTypeScriptFile(platforms, files, totalSize, totalFileCount) {
	const platformKeys = Object.keys(platforms).sort();

	return `// Auto-generated file - DO NOT EDIT
// Generated at: ${new Date().toISOString()}
// Run 'npm run embed' to regenerate

/**
 * Embedded native modules as base64 strings (Multi-platform)
 *
 * Compiled for Electron ${CONFIG.electronVersion} (ABI ${CONFIG.nodeABI})
 *
 * Supported platforms:
${platformKeys.map((k) => ` *   - ${k}`).join("\n")}
 */

/**
 * Platform-specific embedded modules
 * Key format: {platform}_{arch} (e.g., "win32_x64", "darwin_arm64")
 */
export const EMBEDDED_PLATFORMS: Record<string, Record<string, string>> = ${JSON.stringify(platforms, null, "\t")};

/**
 * File information for each platform
 */
export const EMBEDDED_FILES: Record<string, Array<{
	name: string;
	key: string;
	size: number;
	sha256: string;
}>> = ${JSON.stringify(files, null, "\t")};

/**
 * Module metadata
 */
export const MODULE_INFO = {
	generatedAt: "${new Date().toISOString()}",
	electronVersion: "${CONFIG.electronVersion}",
	nodeABI: ${CONFIG.nodeABI},
	platforms: ${JSON.stringify(platformKeys)},
	totalSize: ${totalSize},
	totalFileCount: ${totalFileCount},
} as const;

/**
 * Get embedded modules for current platform
 */
export function getEmbeddedModulesForPlatform(
	platform: string = process.platform,
	arch: string = process.arch
): Record<string, string> | null {
	const key = \`\${platform}_\${arch}\`;
	return EMBEDDED_PLATFORMS[key] || null;
}

/**
 * Get embedded file info for current platform
 */
export function getEmbeddedFilesForPlatform(
	platform: string = process.platform,
	arch: string = process.arch
): Array<{ name: string; key: string; size: number; sha256: string }> | null {
	const key = \`\${platform}_\${arch}\`;
	return EMBEDDED_FILES[key] || null;
}

/**
 * Check if current platform has embedded modules
 */
export function hasPlatformSupport(
	platform: string = process.platform,
	arch: string = process.arch
): boolean {
	const key = \`\${platform}_\${arch}\`;
	return key in EMBEDDED_PLATFORMS;
}
`;
}

// Main entry point
try {
	const options = parseArgs();

	if (options.list) {
		listEmbeddedPlatforms();
	} else {
		embedNativeModules(options);
	}
} catch (error) {
	console.error("❌ Failed to embed native modules:", error);
	process.exit(1);
}
