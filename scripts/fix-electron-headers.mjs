#!/usr/bin/env node
/**
 * Fix Electron header files for Windows MSVC compilation
 *
 * This script patches the V8 header files to avoid min/max macro conflicts
 * with Windows SDK headers. The issue is that windows.h defines min/max as
 * macros, which conflict with std::numeric_limits<T>::min/max() calls in V8.
 *
 * Solution: Wrap the entire expression with parentheses:
 *   std::numeric_limits<T>::min() -> (std::numeric_limits<T>::min)()
 *
 * Reference: https://github.com/nodejs/node/issues/52895
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ELECTRON_VERSION = process.argv[2] || "34.2.0";
const ELECTRON_GYP_DIR = join(
	homedir(),
	".electron-gyp",
	ELECTRON_VERSION,
	"include",
	"node",
);

// Files that need patching
const FILES_TO_PATCH = ["v8-internal.h", "v8-function-callback.h"];

/**
 * Fix min/max macro conflicts by wrapping the function name with parentheses
 *
 * Transforms:
 *   std::numeric_limits<int16_t>::min()  -> (std::numeric_limits<int16_t>::min)()
 *   std::numeric_limits<int16_t>::max()  -> (std::numeric_limits<int16_t>::max)()
 */
function fixMinMaxMacros(content) {
	// First, find all std::numeric_limits<...>::min() or max() that are NOT already wrapped
	// We check by ensuring there's no ( immediately before std::
	// But we need to handle cases where it appears after ( like: IsValidSmi(std::numeric_limits<...>::min())

	// Strategy: Replace all occurrences, but only if not already wrapped with ()
	// An already wrapped one looks like: (std::numeric_limits<...>::min)()

	// Match std::numeric_limits<anything>::min() or max()
	// Negative lookbehind for ( to avoid matching already-wrapped ones isn't enough
	// because (IsValidSmi(std::... should still match

	// Better approach: match any std::numeric_limits<...>::min/max() that is followed by ()
	// and NOT already wrapped (i.e., the ::min or ::max is not preceded by ()

	const pattern = /std::numeric_limits<([^>]+)>::(min|max)\(\)/g;

	let result = content;
	let match;
	let replacements = [];

	// Find all matches first
	while ((match = pattern.exec(content)) !== null) {
		const fullMatch = match[0];
		const typeParam = match[1];
		const minMax = match[2];
		const startIndex = match.index;

		// Check if this is already wrapped: look for ( before std::
		// If the character before is ( and the character after the match is ), it might be wrapped
		// But we need to check if it's (std::numeric_limits<...>::min)() pattern
		// vs IsValidSmi(std::numeric_limits<...>::min()) pattern

		// The already wrapped pattern has ) before the final ()
		// e.g., (std::numeric_limits<int16_t>::min)()
		//                                       ^-- ) here

		// The unwrapped pattern has :: before min/max
		// e.g., std::numeric_limits<int16_t>::min()

		// Since we're looking at the match "std::numeric_limits<...>::min()"
		// we need to check what comes before "std::"
		// If it's "(", check if this ( is part of the wrapping or a function call

		// Simpler check: Look at what comes immediately after the match
		// If we have std::numeric_limits<T>::min() and it's not wrapped,
		// the char before would be something like ( from a function call or space/newline

		// Actually, the safest way is to check if the pattern appears as part of
		// (std::numeric_limits<T>::min)() - note the ) before ()

		// Let's just check if there's a ( right before std:: AND a ) right after ::min or ::max (before the ())
		const charBefore = startIndex > 0 ? content[startIndex - 1] : "";

		// Check if already wrapped: pattern would be (std::...::min)()
		// In this case, there would be a ) right before ()
		// Our match is std::...::min() so we need to look at what's before std::

		// If char before is ( and the content after our match position continues with more code,
		// we're in a function call like IsValidSmi(std::...) - this needs fixing
		// If the wrap pattern was applied, it would be (std::...::min)() and our regex wouldn't match
		// because ::min would be followed by ) not ()

		// So any match we find needs to be fixed
		replacements.push({
			original: fullMatch,
			replacement: `(std::numeric_limits<${typeParam}>::${minMax})()`,
			index: startIndex,
		});
	}

	// Apply replacements in reverse order to preserve indices
	replacements.reverse();
	for (const r of replacements) {
		result =
			result.substring(0, r.index) +
			r.replacement +
			result.substring(r.index + r.original.length);
	}

	return result;
}

function patchFile(filePath) {
	if (!existsSync(filePath)) {
		console.log(`⚠️  File not found: ${filePath}`);
		return false;
	}

	const originalContent = readFileSync(filePath, "utf8");
	const fixedContent = fixMinMaxMacros(originalContent);

	if (fixedContent !== originalContent) {
		// Backup original file if not already backed up
		const backupPath = filePath + ".bak";
		if (!existsSync(backupPath)) {
			writeFileSync(backupPath, originalContent, "utf8");
			console.log(`📦 Backup created: ${backupPath}`);
		}

		writeFileSync(filePath, fixedContent, "utf8");

		// Count replacements
		const origMatches =
			originalContent.match(
				/std::numeric_limits<[^>]+>::(min|max)\(\)/g,
			) || [];
		const fixedMatches =
			fixedContent.match(
				/\(std::numeric_limits<[^>]+>::(min|max)\)\(\)/g,
			) || [];

		console.log(`✅ Patched ${filePath}`);
		console.log(
			`   Found ${origMatches.length} unfixed patterns, now have ${fixedMatches.length} fixed patterns`,
		);
		return true;
	} else {
		// Check if already fixed
		const alreadyFixed =
			originalContent.match(
				/\(std::numeric_limits<[^>]+>::(min|max)\)\(\)/g,
			) || [];
		if (alreadyFixed.length > 0) {
			console.log(
				`ℹ️  Already patched: ${filePath} (${alreadyFixed.length} patterns)`,
			);
		} else {
			console.log(`ℹ️  No patterns found: ${filePath}`);
		}
		return false;
	}
}

function main() {
	console.log(
		`🔧 Fixing Electron ${ELECTRON_VERSION} headers for Windows MSVC...`,
	);
	console.log(`📂 Headers directory: ${ELECTRON_GYP_DIR}`);
	console.log("");

	if (!existsSync(ELECTRON_GYP_DIR)) {
		console.error(`❌ Electron headers not found at ${ELECTRON_GYP_DIR}`);
		console.error(
			'   Run "npx @electron/rebuild" first to download headers.',
		);
		process.exit(1);
	}

	let patchedCount = 0;
	for (const file of FILES_TO_PATCH) {
		const filePath = join(ELECTRON_GYP_DIR, file);
		if (patchFile(filePath)) {
			patchedCount++;
		}
	}

	console.log("");
	if (patchedCount > 0) {
		console.log(
			`✅ Patched ${patchedCount} file(s). Now run rebuild again.`,
		);
	} else {
		console.log("ℹ️  All files already patched or no patches needed.");
	}
}

main();
