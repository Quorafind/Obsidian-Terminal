#!/usr/bin/env node
/**
 * Fix conpty.cc compilation errors on newer Windows SDK
 *
 * The issue is that newer Windows SDK versions define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
 * but don't expose the PFNCREATEPSEUDOCONSOLE and related function pointer typedefs.
 *
 * Solution: Always define the function pointer types, regardless of whether
 * PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE is defined.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CONPTY_CC_PATH = join(
	process.cwd(),
	"node_modules",
	"node-pty",
	"src",
	"win",
	"conpty.cc",
);

function fixConptyCc() {
	if (!existsSync(CONPTY_CC_PATH)) {
		console.error(`❌ File not found: ${CONPTY_CC_PATH}`);
		process.exit(1);
	}

	let content = readFileSync(CONPTY_CC_PATH, "utf8");
	const originalContent = content;

	// Check if already patched
	if (content.includes("// PATCHED: Always define function pointer types")) {
		console.log(`ℹ️  Already patched: ${CONPTY_CC_PATH}`);
		return false;
	}

	// The problem is that the typedefs are inside #ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
	// but newer SDK defines this macro without providing the typedefs.
	//
	// Original code structure:
	// #ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
	// #define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE ...
	// typedef VOID* HPCON;
	// typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(...);
	// ...
	// #endif
	//
	// Fix: Move typedefs outside the #ifndef block

	const oldBlock = `// Taken from the RS5 Windows SDK, but redefined here in case we're targeting <= 17134
#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)

typedef VOID* HPCON;
typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);

#endif`;

	const newBlock = `// Taken from the RS5 Windows SDK, but redefined here in case we're targeting <= 17134
#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)
#endif

// PATCHED: Always define function pointer types (needed for dynamic loading via GetProcAddress)
// These may not be provided by the SDK even when PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE is defined
#ifndef _HPCON_DEFINED
#define _HPCON_DEFINED
typedef VOID* HPCON;
#endif

typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);`;

	if (content.includes(oldBlock)) {
		content = content.replace(oldBlock, newBlock);
	} else {
		// Try a more flexible match
		const regex = /#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE[\s\S]*?typedef void \(__stdcall \*PFNCLOSEPSEUDOCONSOLE\)\(HPCON hpc\);[\s\S]*?#endif/;

		if (regex.test(content)) {
			content = content.replace(regex, newBlock);
		} else {
			console.error("❌ Could not find the code block to patch");
			console.error("   The file structure may have changed");
			process.exit(1);
		}
	}

	if (content !== originalContent) {
		// Backup
		const backupPath = CONPTY_CC_PATH + ".bak";
		if (!existsSync(backupPath)) {
			writeFileSync(backupPath, originalContent, "utf8");
			console.log(`📦 Backup created: ${backupPath}`);
		}

		writeFileSync(CONPTY_CC_PATH, content, "utf8");
		console.log(`✅ Patched ${CONPTY_CC_PATH}`);
		return true;
	} else {
		console.log(`ℹ️  No changes needed: ${CONPTY_CC_PATH}`);
		return false;
	}
}

console.log("🔧 Fixing conpty.cc for MSVC compilation...");
fixConptyCc();
console.log("✅ Done. Now run rebuild again.");
