#!/usr/bin/env node
/**
 * Copy compiled node-pty binaries to pnpm nested directory structure
 *
 * pnpm creates a nested node_modules structure:
 *   node_modules/.pnpm/node-pty@1.0.0/node_modules/node-pty/
 *
 * @electron/rebuild compiles to:
 *   node_modules/node-pty/build/Release/
 *
 * This script copies the compiled .node files to the correct pnpm location.
 */

import { existsSync, mkdirSync, readdirSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

// Source: where @electron/rebuild puts the compiled files
const SOURCE_BUILD_DIR = join(ROOT_DIR, "node_modules", "node-pty", "build");

// Destination: where pnpm's require resolution looks for them
const PNPM_NODE_PTY_DIR = join(
	ROOT_DIR,
	"node_modules",
	".pnpm",
	"node-pty@1.0.0",
	"node_modules",
	"node-pty",
);

function findPnpmNodePtyDir() {
	// pnpm version might vary, search for it
	const pnpmDir = join(ROOT_DIR, "node_modules", ".pnpm");

	if (!existsSync(pnpmDir)) {
		console.log("ℹ️  No .pnpm directory found - not using pnpm");
		return null;
	}

	// Find node-pty directory in .pnpm
	const entries = readdirSync(pnpmDir);
	const nodePtyEntry = entries.find((e) => e.startsWith("node-pty@"));

	if (!nodePtyEntry) {
		console.log("ℹ️  No node-pty in .pnpm directory");
		return null;
	}

	return join(pnpmDir, nodePtyEntry, "node_modules", "node-pty");
}

function copyBuildDirectory(srcDir, destDir) {
	if (!existsSync(srcDir)) {
		console.error(`❌ Source directory not found: ${srcDir}`);
		return false;
	}

	// Ensure destination exists
	if (!existsSync(destDir)) {
		mkdirSync(destDir, { recursive: true });
		console.log(`📁 Created directory: ${destDir}`);
	}

	// Copy Release directory
	const srcReleaseDir = join(srcDir, "Release");
	const destReleaseDir = join(destDir, "Release");

	if (existsSync(srcReleaseDir)) {
		if (!existsSync(destReleaseDir)) {
			mkdirSync(destReleaseDir, { recursive: true });
		}

		const files = readdirSync(srcReleaseDir);
		for (const file of files) {
			// Copy .node, .dll, and .exe files for both ConPTY and WinPTY support
			if (
				file.endsWith(".node") ||
				file.endsWith(".dll") ||
				file.endsWith(".exe")
			) {
				const srcFile = join(srcReleaseDir, file);
				const destFile = join(destReleaseDir, file);
				copyFileSync(srcFile, destFile);
				console.log(`✅ Copied: ${file} -> ${destReleaseDir}`);
			}
		}
	}

	// Also check Debug directory (in case debug build was done)
	const srcDebugDir = join(srcDir, "Debug");
	const destDebugDir = join(destDir, "Debug");

	if (existsSync(srcDebugDir)) {
		if (!existsSync(destDebugDir)) {
			mkdirSync(destDebugDir, { recursive: true });
		}

		const files = readdirSync(srcDebugDir);
		for (const file of files) {
			// Copy .node, .dll, and .exe files for both ConPTY and WinPTY support
			if (
				file.endsWith(".node") ||
				file.endsWith(".dll") ||
				file.endsWith(".exe")
			) {
				const srcFile = join(srcDebugDir, file);
				const destFile = join(destDebugDir, file);
				copyFileSync(srcFile, destFile);
				console.log(`✅ Copied: ${file} -> ${destDebugDir}`);
			}
		}
	}

	return true;
}

function main() {
	console.log("🔧 Copying node-pty binaries to pnpm directory...\n");

	const pnpmNodePtyDir = findPnpmNodePtyDir();

	if (!pnpmNodePtyDir) {
		console.log("✅ No pnpm structure detected, skipping copy.");
		return;
	}

	console.log(`📦 Source: ${SOURCE_BUILD_DIR}`);
	console.log(`📦 Destination: ${join(pnpmNodePtyDir, "build")}\n`);

	if (!existsSync(SOURCE_BUILD_DIR)) {
		console.error(`❌ Source build directory not found!`);
		console.error(`   Expected: ${SOURCE_BUILD_DIR}`);
		console.error(
			`   Run 'pnpm rebuild:electron' first to compile node-pty`,
		);
		process.exit(1);
	}

	const destBuildDir = join(pnpmNodePtyDir, "build");
	const success = copyBuildDirectory(SOURCE_BUILD_DIR, destBuildDir);

	if (success) {
		console.log("\n✅ Done! node-pty binaries copied to pnpm location.");
	} else {
		console.error("\n❌ Failed to copy binaries.");
		process.exit(1);
	}
}

main();
