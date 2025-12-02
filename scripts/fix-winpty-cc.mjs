#!/usr/bin/env node
/**
 * Fix winpty.cc compilation errors on MSVC
 *
 * The issue is that MSVC doesn't allow goto to jump over variable initialization.
 * Solution: Move variable declarations before the first goto, or initialize to defaults.
 *
 * Error: "goto cleanup" 跳过了 "xxx" 的初始化
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const WINPTY_CC_PATH = join(process.cwd(), 'node_modules', 'node-pty', 'src', 'win', 'winpty.cc');

function fixWinptyCc() {
    if (!existsSync(WINPTY_CC_PATH)) {
        console.error(`❌ File not found: ${WINPTY_CC_PATH}`);
        process.exit(1);
    }

    let content = readFileSync(WINPTY_CC_PATH, 'utf8');
    const originalContent = content;

    // The problem is in PtyStartProcess function
    // Variables are declared after "goto cleanup" statements, but goto jumps over them
    //
    // Solution: Find the function and restructure it to declare variables at the top
    // or wrap the variable declarations in blocks

    // Find the PtyStartProcess function and fix the variable declarations
    // The issue is lines like:
    //   goto cleanup;
    //   int cols = ...;  // This is skipped by goto

    // We need to move all variable declarations that are after any goto to before all gotos
    // Or, we can change the initialization pattern

    // Simpler fix: Change variable declarations with initialization to declarations + assignments
    // e.g., "int cols = info[4]->..." becomes "int cols; cols = info[4]->..."

    // But this is complex. Let's use a different approach:
    // Add braces around the entire function body after variable declarations
    // to create proper scope.

    // Actually, the cleanest fix is to add "= 0" or "= nullptr" default values
    // and move declarations before the first goto.

    // Let me find the PtyStartProcess function and apply a targeted fix

    const functionStart = content.indexOf('static NAN_METHOD(PtyStartProcess)');
    if (functionStart === -1) {
        console.error('❌ Could not find PtyStartProcess function');
        process.exit(1);
    }

    const functionEnd = content.indexOf('static NAN_METHOD(PtyResize)');
    if (functionEnd === -1) {
        console.error('❌ Could not find PtyResize function');
        process.exit(1);
    }

    const functionBody = content.substring(functionStart, functionEnd);

    // Apply fixes to the function body
    let fixedFunction = functionBody;

    // Fix 1: Move "int cols" and "int rows" declarations before first goto
    // Current: "goto cleanup;\n  int cols = ..."
    // Change to: Declare at top of function with default values

    // We'll insert variable declarations right after the opening brace of the function
    // First, find where to insert (after the first {)

    const firstBrace = fixedFunction.indexOf('{');
    const insertPoint = firstBrace + 1;

    // Variables that need to be declared early (with default values)
    const earlyDeclarations = `
  // Variables declared early to avoid goto-skip issues (MSVC fix)
  int cols = 80;
  int rows = 24;
  bool debug = false;
  winpty_error_ptr_t error_ptr = nullptr;
  winpty_config_t* winpty_config = nullptr;
  winpty_t *pc = nullptr;
  winpty_spawn_config_t* config = nullptr;
  HANDLE handle = nullptr;
  BOOL spawnSuccess = FALSE;
  v8::Local<v8::Object> marshal;
`;

    // Now remove the original declarations and replace with assignments
    // Pattern: "int cols = info[4]->..." -> "cols = info[4]->..."
    fixedFunction = fixedFunction.replace(/\bint cols = /g, 'cols = ');
    fixedFunction = fixedFunction.replace(/\bint rows = /g, 'rows = ');
    fixedFunction = fixedFunction.replace(/\bbool debug = /g, 'debug = ');
    fixedFunction = fixedFunction.replace(/\bwinpty_error_ptr_t error_ptr = nullptr;/g, '');
    fixedFunction = fixedFunction.replace(/\bwinpty_config_t\* winpty_config = /g, 'winpty_config = ');
    fixedFunction = fixedFunction.replace(/\bwinpty_t \*pc = /g, 'pc = ');
    fixedFunction = fixedFunction.replace(/\bwinpty_spawn_config_t\* config = /g, 'config = ');
    fixedFunction = fixedFunction.replace(/\bHANDLE handle = nullptr;/g, '');
    fixedFunction = fixedFunction.replace(/\bBOOL spawnSuccess = /g, 'spawnSuccess = ');
    fixedFunction = fixedFunction.replace(/\bv8::Local<v8::Object> marshal = /g, 'marshal = ');

    // Insert early declarations
    fixedFunction = fixedFunction.substring(0, insertPoint) + earlyDeclarations + fixedFunction.substring(insertPoint);

    // Replace the function in the content
    content = content.substring(0, functionStart) + fixedFunction + content.substring(functionEnd);

    if (content !== originalContent) {
        // Backup
        const backupPath = WINPTY_CC_PATH + '.bak';
        if (!existsSync(backupPath)) {
            writeFileSync(backupPath, originalContent, 'utf8');
            console.log(`📦 Backup created: ${backupPath}`);
        }

        writeFileSync(WINPTY_CC_PATH, content, 'utf8');
        console.log(`✅ Patched ${WINPTY_CC_PATH}`);
        return true;
    } else {
        console.log(`ℹ️  No changes needed: ${WINPTY_CC_PATH}`);
        return false;
    }
}

console.log('🔧 Fixing winpty.cc for MSVC compilation...');
fixWinptyCc();
console.log('✅ Done. Now run rebuild again.');
