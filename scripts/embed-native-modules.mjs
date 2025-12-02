#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Script to embed native modules as base64 strings
 */

const NATIVE_MODULES_PATH = './node_modules/.pnpm/node-pty@1.0.0/node_modules/node-pty/build/Release';
const OUTPUT_FILE = './src/core/embedded-modules.ts';

function embedNativeModules() {
    console.log('🔄 Embedding native modules as base64...');
    
    const modules = {};
    
    // Embed Windows conpty.node
    const conptyPath = join(NATIVE_MODULES_PATH, 'conpty.node');
    if (existsSync(conptyPath)) {
        const conptyBuffer = readFileSync(conptyPath);
        modules.conpty = conptyBuffer.toString('base64');
        console.log(`✅ Embedded conpty.node (${Math.round(conptyBuffer.length / 1024)}KB)`);
    }
    
    // Embed Unix pty.node
    const ptyPath = join(NATIVE_MODULES_PATH, 'pty.node');
    if (existsSync(ptyPath)) {
        const ptyBuffer = readFileSync(ptyPath);
        modules.pty = ptyBuffer.toString('base64');
        console.log(`✅ Embedded pty.node (${Math.round(ptyBuffer.length / 1024)}KB)`);
    }
    
    if (Object.keys(modules).length === 0) {
        console.warn('⚠️  No native modules found to embed');
        return;
    }
    
    // Generate TypeScript file
    const tsContent = `// Auto-generated file - DO NOT EDIT
// Generated at: ${new Date().toISOString()}

/**
 * Embedded native modules as base64 strings
 */
export const EMBEDDED_MODULES = ${JSON.stringify(modules, null, 2)} as const;

/**
 * Module metadata
 */
export const MODULE_INFO = {
    generatedAt: "${new Date().toISOString()}",
    nodeVersion: "${process.version}",
    platform: "${process.platform}",
    arch: "${process.arch}",
    totalSize: ${Object.values(modules).reduce((acc, b64) => acc + Buffer.from(b64, 'base64').length, 0)}
} as const;
`;

    writeFileSync(OUTPUT_FILE, tsContent, 'utf8');
    console.log(`📝 Generated ${OUTPUT_FILE}`);
    console.log(`📊 Total embedded size: ${Math.round(Object.values(modules).reduce((acc, b64) => acc + Buffer.from(b64, 'base64').length, 0) / 1024)}KB`);
}

// Run the script
try {
    embedNativeModules();
    console.log('✅ Native modules embedded successfully!');
} catch (error) {
    console.error('❌ Failed to embed native modules:', error);
    process.exit(1);
}