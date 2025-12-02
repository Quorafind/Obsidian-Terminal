import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { EMBEDDED_MODULES, MODULE_INFO } from './embedded-modules';

/**
 * Native module extractor - handles runtime extraction of embedded .node files
 */
export class NativeModuleExtractor {
    private extractionPath: string;
    private isExtracted: boolean = false;

    constructor(pluginDir: string) {
        this.extractionPath = join(pluginDir, 'native-modules');
        console.log(`📦 NativeModuleExtractor initialized with plugin dir: ${pluginDir}`);
        console.log(`📂 Extraction path will be: ${this.extractionPath}`);
    }

    /**
     * Check if native modules are already extracted and up to date
     */
    private isUpToDate(): boolean {
        const metaFile = join(this.extractionPath, 'module-info.json');
        
        if (!existsSync(metaFile)) {
            return false;
        }

        try {
            const existingMeta = JSON.parse(require('fs').readFileSync(metaFile, 'utf8'));
            return existingMeta.generatedAt === MODULE_INFO.generatedAt &&
                   existingMeta.platform === MODULE_INFO.platform &&
                   existingMeta.arch === MODULE_INFO.arch;
        } catch (error) {
            console.warn('Failed to read module metadata:', error);
            return false;
        }
    }

    /**
     * Extract embedded native modules to the plugin directory
     */
    async extractModules(): Promise<string> {
        if (this.isExtracted || this.isUpToDate()) {
            console.log('Native modules already extracted and up to date');
            return this.extractionPath;
        }

        console.log('🔄 Extracting embedded native modules...');

        try {
            // Create extraction directory
            if (!existsSync(this.extractionPath)) {
                mkdirSync(this.extractionPath, { recursive: true });
            }

            let extractedCount = 0;

            // Extract Windows module
            if (EMBEDDED_MODULES.conpty && process.platform === 'win32') {
                const filePath = join(this.extractionPath, 'conpty.node');
                const buffer = Buffer.from(EMBEDDED_MODULES.conpty, 'base64');
                writeFileSync(filePath, buffer);
                console.log(`✅ Extracted conpty.node (${Math.round(buffer.length / 1024)}KB)`);
                extractedCount++;
            }

            // Extract Unix module
            if (EMBEDDED_MODULES.pty && process.platform !== 'win32') {
                const filePath = join(this.extractionPath, 'pty.node');
                const buffer = Buffer.from(EMBEDDED_MODULES.pty, 'base64');
                writeFileSync(filePath, buffer);
                console.log(`✅ Extracted pty.node (${Math.round(buffer.length / 1024)}KB)`);
                extractedCount++;
            }

            // Write metadata file
            const metaFile = join(this.extractionPath, 'module-info.json');
            writeFileSync(metaFile, JSON.stringify(MODULE_INFO, null, 2), 'utf8');

            console.log(`📁 Extracted ${extractedCount} native modules to: ${this.extractionPath}`);
            this.isExtracted = true;

            return this.extractionPath;

        } catch (error) {
            console.error('❌ Failed to extract native modules:', error);
            throw new Error(`Failed to extract native modules: ${error.message}`);
        }
    }

    /**
     * Get the path to the extracted native modules
     */
    getExtractionPath(): string {
        return this.extractionPath;
    }

    /**
     * Get the path to a specific native module
     */
    getModulePath(moduleName: 'conpty' | 'pty'): string {
        return join(this.extractionPath, `${moduleName}.node`);
    }

    /**
     * Check if a specific module is available for the current platform
     */
    isModuleAvailable(moduleName: 'conpty' | 'pty'): boolean {
        if (moduleName === 'conpty') {
            return process.platform === 'win32' && !!EMBEDDED_MODULES.conpty;
        } else if (moduleName === 'pty') {
            return process.platform !== 'win32' && !!EMBEDDED_MODULES.pty;
        }
        return false;
    }
}