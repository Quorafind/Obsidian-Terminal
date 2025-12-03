/**
 * Native Binary Manager
 *
 * Manages native PTY binaries lifecycle:
 * 1. Check if binaries exist and match the required Electron ABI
 * 2. Download from GitHub Release when missing
 *
 * @module native-binary-manager
 */

import {
	existsSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	unlinkSync,
	statSync,
	readdirSync,
	rmSync,
} from "fs";
import { join, dirname } from "path";
import { requestUrl } from "obsidian";
import {
	MODULE_INFO,
	PLATFORM_BINARIES,
	isPlatformSupported,
} from "./embedded-modules";

/**
 * Binary manifest describing installed files
 */
export interface BinaryManifest {
	version: string;
	electronVersion: string;
	nodeABI: number;
	platform: string;
	arch: string;
	installedAt: string;
	files: BinaryFileInfo[];
}

export interface BinaryFileInfo {
	name: string;
	size: number;
	sha256?: string;
}

/**
 * Download progress callback
 */
export type ProgressCallback = (progress: {
	phase: "checking" | "downloading" | "extracting" | "complete" | "error";
	message: string;
	percent?: number;
	error?: Error;
}) => void;

/**
 * Binary status
 */
export interface BinaryStatus {
	installed: boolean;
	version?: string;
	electronVersion?: string;
	nodeABI?: number;
	files: string[];
	needsUpdate: boolean;
	platformKey: string;
	platformSupported: boolean;
}

/**
 * GitHub Release info structure
 */
export interface ReleaseInfo {
	version: string;
	downloadUrl: string;
	releaseUrl: string;
	publishedAt: string;
}

/**
 * Current configuration
 */
const CURRENT_CONFIG = {
	electronVersion: MODULE_INFO.electronVersion,
	nodeABI: MODULE_INFO.nodeABI,
	// Default GitHub repository (can be overridden in settings)
	defaultGitHubRepo: "quorafind/obsidian-terminal",
};

/**
 * Native Binary Manager
 */
export class NativeBinaryManager {
	private pluginDir: string;
	private binaryDir: string;
	private nodePtyDir: string;
	private manifestPath: string;
	private platformKey: string;

	constructor(pluginDir: string) {
		this.pluginDir = pluginDir;
		this.binaryDir = join(pluginDir, "native");
		this.nodePtyDir = join(this.binaryDir, "node-pty");
		this.manifestPath = join(this.binaryDir, "manifest.json");
		this.platformKey = `${process.platform}_${process.arch}`;
	}

	/**
	 * Get current binary status
	 *
	 * Check if complete node-pty structure exists:
	 * - native/node-pty/package.json
	 * - native/node-pty/lib/index.js
	 * - native/node-pty/build/Release/*.node
	 */
	getStatus(): BinaryStatus {
		const requiredBinaries = PLATFORM_BINARIES[this.platformKey] || [];
		const existingFiles: string[] = [];
		let manifest: BinaryManifest | null = null;

		// Check manifest (optional, for version info display only)
		if (existsSync(this.manifestPath)) {
			try {
				manifest = JSON.parse(readFileSync(this.manifestPath, "utf8"));
			} catch {
				// Invalid manifest - not critical
			}
		}

		// Check for complete node-pty structure
		const hasPackageJson = existsSync(
			join(this.nodePtyDir, "package.json"),
		);
		const hasIndexJs = existsSync(join(this.nodePtyDir, "lib", "index.js"));

		// Check each required binary in build/Release
		for (const file of requiredBinaries) {
			const filePath = join(this.nodePtyDir, "build", "Release", file);
			if (existsSync(filePath)) {
				existingFiles.push(file);
			}
		}

		const allBinariesExist =
			requiredBinaries.length > 0 &&
			requiredBinaries.every((f) => existingFiles.includes(f));

		const installed = hasPackageJson && hasIndexJs && allBinariesExist;

		return {
			installed,
			version: manifest?.version,
			electronVersion: manifest?.electronVersion,
			nodeABI: manifest?.nodeABI,
			files: existingFiles,
			needsUpdate: !installed,
			platformKey: this.platformKey,
			platformSupported: isPlatformSupported(),
		};
	}

	/**
	 * Check if binaries are ready to use
	 */
	isReady(): boolean {
		const status = this.getStatus();
		return status.installed && !status.needsUpdate;
	}

	/**
	 * Get the binary directory path
	 */
	getBinaryDir(): string {
		return this.binaryDir;
	}

	/**
	 * Get path to a specific binary file
	 */
	getBinaryPath(fileName: string): string {
		return join(this.nodePtyDir, "build", "Release", fileName);
	}

	/**
	 * Get path to node-pty directory
	 */
	getNodePtyDir(): string {
		return this.nodePtyDir;
	}

	/**
	 * Fetch the latest release info from GitHub
	 */
	async fetchLatestRelease(repo: string): Promise<ReleaseInfo> {
		const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

		console.log(`🔍 Fetching latest release from ${repo}...`);

		const response = await requestUrl({
			url: apiUrl,
			method: "GET",
			headers: {
				Accept: "application/vnd.github.v3+json",
				"User-Agent": "Obsidian-Terminal",
			},
		});

		if (response.status !== 200) {
			if (response.status === 403) {
				// Check if it's a rate limit issue
				const rateLimitRemaining =
					response.headers?.["x-ratelimit-remaining"];
				if (rateLimitRemaining === "0") {
					throw new Error(
						"GitHub API rate limit exceeded. Please wait an hour or try again later.",
					);
				}
				throw new Error(
					"GitHub API access denied (403). The repository may be private or inaccessible.",
				);
			}
			if (response.status === 404) {
				throw new Error(
					`Repository not found: ${repo}. Please check the repository URL in settings.`,
				);
			}
			throw new Error(
				`Failed to fetch releases: HTTP ${response.status}`,
			);
		}

		const release = response.json;
		const version = release.tag_name.replace(/^v/, "");

		// Find the native bundle asset
		const bundleAsset = release.assets?.find(
			(a: { name: string }) =>
				a.name.startsWith("obsidian-terminal-v") &&
				a.name.endsWith(".zip"),
		);

		if (!bundleAsset) {
			throw new Error(
				"Release does not contain native module bundle (obsidian-terminal-v*.zip)",
			);
		}

		return {
			version,
			downloadUrl: bundleAsset.browser_download_url,
			releaseUrl: release.html_url,
			publishedAt: release.published_at,
		};
	}

	/**
	 * Install binaries from GitHub Release
	 */
	async installFromGitHubRelease(
		repo: string,
		onProgress?: ProgressCallback,
	): Promise<void> {
		onProgress?.({
			phase: "checking",
			message: "检查最新版本...",
		});

		try {
			// Check platform support first
			if (!isPlatformSupported()) {
				const supported = (
					MODULE_INFO.supportedPlatforms as readonly string[]
				).join(", ");
				throw new Error(
					`平台 ${this.platformKey} 不支持。支持的平台: ${supported}`,
				);
			}

			// Fetch release info
			const releaseInfo = await this.fetchLatestRelease(repo);

			console.log(`📦 Latest release: v${releaseInfo.version}`);
			console.log(
				`📦 Required Electron: ${MODULE_INFO.electronVersion}, ABI: ${MODULE_INFO.nodeABI}`,
			);

			onProgress?.({
				phase: "downloading",
				message: `下载原生模块包 v${releaseInfo.version}...`,
				percent: 0,
			});

			// Download the bundle
			console.log(`⬇️ Downloading: ${releaseInfo.downloadUrl}`);
			const bundleResponse = await requestUrl({
				url: releaseInfo.downloadUrl,
				method: "GET",
			});

			if (bundleResponse.status !== 200) {
				throw new Error(`下载失败: HTTP ${bundleResponse.status}`);
			}

			onProgress?.({
				phase: "extracting",
				message: "解压原生模块...",
				percent: 50,
			});

			// Clean up existing node-pty directory
			if (existsSync(this.nodePtyDir)) {
				rmSync(this.nodePtyDir, { recursive: true, force: true });
			}

			// Ensure directories exist
			mkdirSync(join(this.nodePtyDir, "build", "Release"), {
				recursive: true,
			});
			mkdirSync(join(this.nodePtyDir, "lib"), { recursive: true });

			// Extract ZIP (complete node-pty structure)
			const zipBuffer = Buffer.from(bundleResponse.arrayBuffer);
			await this.extractNodePtyZip(zipBuffer, this.platformKey);

			// Verify structure
			const expectedBinaries = PLATFORM_BINARIES[this.platformKey] || [];
			const extractedFiles: Array<{ name: string; size: number }> = [];
			const missingFiles: string[] = [];

			// Check package.json
			if (!existsSync(join(this.nodePtyDir, "package.json"))) {
				missingFiles.push("package.json");
			}

			// Check lib/index.js
			if (!existsSync(join(this.nodePtyDir, "lib", "index.js"))) {
				missingFiles.push("lib/index.js");
			}

			// Check binaries
			for (const file of expectedBinaries) {
				const filePath = join(
					this.nodePtyDir,
					"build",
					"Release",
					file,
				);
				if (!existsSync(filePath)) {
					missingFiles.push(`build/Release/${file}`);
				} else {
					const stat = statSync(filePath);
					extractedFiles.push({ name: file, size: stat.size });
					console.log(`✅ Extracted: ${file}`);
				}
			}

			if (missingFiles.length > 0) {
				throw new Error(`缺少文件: ${missingFiles.join(", ")}`);
			}

			// Write manifest
			this.writeManifest(
				releaseInfo.version,
				MODULE_INFO.electronVersion,
				MODULE_INFO.nodeABI,
				extractedFiles,
			);

			onProgress?.({
				phase: "complete",
				message: `安装完成 (v${releaseInfo.version})`,
				percent: 100,
			});
		} catch (error) {
			onProgress?.({
				phase: "error",
				message: `安装失败: ${(error as Error).message}`,
				error: error as Error,
			});
			throw error;
		}
	}

	/**
	 * Install binaries from local ZIP file
	 */
	async installFromLocalZip(
		zipBuffer: ArrayBuffer,
		onProgress?: ProgressCallback,
	): Promise<void> {
		onProgress?.({
			phase: "extracting",
			message: "Extracting native modules from local file...",
			percent: 10,
		});

		try {
			// Check platform support first
			if (!isPlatformSupported()) {
				const supported = (
					MODULE_INFO.supportedPlatforms as readonly string[]
				).join(", ");
				throw new Error(
					`Platform ${this.platformKey} is not supported. Supported: ${supported}`,
				);
			}

			// Clean up existing node-pty directory
			if (existsSync(this.nodePtyDir)) {
				rmSync(this.nodePtyDir, { recursive: true, force: true });
			}

			// Ensure directories exist
			mkdirSync(join(this.nodePtyDir, "build", "Release"), {
				recursive: true,
			});
			mkdirSync(join(this.nodePtyDir, "lib"), { recursive: true });

			onProgress?.({
				phase: "extracting",
				message: "Extracting files...",
				percent: 30,
			});

			// Extract ZIP
			const buffer = Buffer.from(zipBuffer);
			await this.extractNodePtyZip(buffer, this.platformKey);

			onProgress?.({
				phase: "extracting",
				message: "Verifying installation...",
				percent: 70,
			});

			// Verify structure
			const expectedBinaries = PLATFORM_BINARIES[this.platformKey] || [];
			const extractedFiles: Array<{ name: string; size: number }> = [];
			const missingFiles: string[] = [];

			// Check package.json
			if (!existsSync(join(this.nodePtyDir, "package.json"))) {
				missingFiles.push("package.json");
			}

			// Check lib/index.js
			if (!existsSync(join(this.nodePtyDir, "lib", "index.js"))) {
				missingFiles.push("lib/index.js");
			}

			// Check binaries
			for (const file of expectedBinaries) {
				const filePath = join(
					this.nodePtyDir,
					"build",
					"Release",
					file,
				);
				if (!existsSync(filePath)) {
					missingFiles.push(`build/Release/${file}`);
				} else {
					const stat = statSync(filePath);
					extractedFiles.push({ name: file, size: stat.size });
					console.log(`✅ Extracted: ${file}`);
				}
			}

			if (missingFiles.length > 0) {
				throw new Error(
					`Missing files in ZIP: ${missingFiles.join(", ")}. Make sure the ZIP contains your platform (${this.platformKey}).`,
				);
			}

			// Write manifest (use "local" as version indicator)
			this.writeManifest(
				"local",
				MODULE_INFO.electronVersion,
				MODULE_INFO.nodeABI,
				extractedFiles,
			);

			onProgress?.({
				phase: "complete",
				message: "Installation complete from local file",
				percent: 100,
			});
		} catch (error) {
			onProgress?.({
				phase: "error",
				message: `Installation failed: ${(error as Error).message}`,
				error: error as Error,
			});
			throw error;
		}
	}

	/**
	 * Extract ZIP file containing complete node-pty structure
	 *
	 * ZIP structure:
	 *   win32_x64/node-pty/package.json
	 *   win32_x64/node-pty/lib/*.js
	 *   win32_x64/node-pty/build/Release/*.node
	 */
	private async extractNodePtyZip(
		buffer: Buffer,
		platformKey: string,
	): Promise<void> {
		const files = await this.parseZip(buffer);
		const platformPrefix = `${platformKey}/node-pty/`;

		for (const [path, entry] of Object.entries(files)) {
			// Skip directories
			if (entry.dir) continue;

			// Only extract files from our platform's node-pty folder
			if (!path.startsWith(platformPrefix)) {
				continue;
			}

			// Get relative path within node-pty
			const relativePath = path.substring(platformPrefix.length);
			if (!relativePath) continue;

			const content = await entry.getData();
			const targetPath = join(this.nodePtyDir, relativePath);

			// Ensure parent directory exists
			const parentDir = dirname(targetPath);
			if (!existsSync(parentDir)) {
				mkdirSync(parentDir, { recursive: true });
			}

			writeFileSync(targetPath, content);
			console.log(
				`📄 Extracted: ${relativePath} (${Math.round(content.length / 1024)} KB)`,
			);
		}
	}

	/**
	 * Parse ZIP file and return file entries
	 */
	private async parseZip(
		buffer: Buffer,
	): Promise<
		Record<string, { dir: boolean; getData: () => Promise<Buffer> }>
	> {
		const files: Record<
			string,
			{ dir: boolean; getData: () => Promise<Buffer> }
		> = {};
		const zlib = require("zlib");

		let offset = 0;
		while (offset < buffer.length - 4) {
			const signature = buffer.readUInt32LE(offset);

			if (signature === 0x04034b50) {
				// Local file header
				const compressionMethod = buffer.readUInt16LE(offset + 8);
				const compressedSize = buffer.readUInt32LE(offset + 18);
				const fileNameLength = buffer.readUInt16LE(offset + 26);
				const extraLength = buffer.readUInt16LE(offset + 28);

				const fileName = buffer.toString(
					"utf8",
					offset + 30,
					offset + 30 + fileNameLength,
				);
				const dataStart = offset + 30 + fileNameLength + extraLength;
				const fileData = buffer.slice(
					dataStart,
					dataStart + compressedSize,
				);

				const isDir = fileName.endsWith("/");

				files[fileName] = {
					dir: isDir,
					getData: async () => {
						if (compressionMethod === 0) {
							// Stored (no compression)
							return fileData;
						} else if (compressionMethod === 8) {
							// Deflate
							return new Promise<Buffer>((resolve, reject) => {
								zlib.inflateRaw(
									fileData,
									(err: Error | null, result: Buffer) => {
										if (err) reject(err);
										else resolve(result);
									},
								);
							});
						} else {
							throw new Error(
								`Unsupported compression: ${compressionMethod}`,
							);
						}
					},
				};

				offset = dataStart + compressedSize;
			} else if (signature === 0x02014b50) {
				// Central directory - stop
				break;
			} else {
				offset++;
			}
		}

		return files;
	}

	/**
	 * Write binary manifest file
	 */
	private writeManifest(
		version: string,
		electronVersion: string,
		nodeABI: number,
		files: Array<{ name: string; size: number; sha256?: string }>,
	): void {
		const manifest: BinaryManifest = {
			version,
			electronVersion,
			nodeABI,
			platform: process.platform,
			arch: process.arch,
			installedAt: new Date().toISOString(),
			files: files.map((f) => ({
				name: f.name,
				size: f.size,
				sha256: f.sha256,
			})),
		};

		writeFileSync(
			this.manifestPath,
			JSON.stringify(manifest, null, 2),
			"utf8",
		);
		console.log("📝 Manifest written");
	}

	/**
	 * Clean up binary files
	 */
	cleanup(): void {
		// Remove entire node-pty directory
		if (existsSync(this.nodePtyDir)) {
			try {
				rmSync(this.nodePtyDir, { recursive: true, force: true });
				console.log("🗑️ Removed: node-pty directory");
			} catch (error) {
				console.warn("Failed to remove node-pty directory:", error);
			}
		}

		if (existsSync(this.manifestPath)) {
			try {
				unlinkSync(this.manifestPath);
			} catch {
				// Ignore
			}
		}
	}

	/**
	 * Get current configuration
	 */
	static getConfig() {
		return { ...CURRENT_CONFIG };
	}

	/**
	 * Get required files for current platform
	 */
	static getRequiredFiles(): string[] {
		const platformKey = `${process.platform}_${process.arch}`;
		return PLATFORM_BINARIES[platformKey] || [];
	}

	/**
	 * Get current platform key
	 */
	static getPlatformKey(): string {
		return `${process.platform}_${process.arch}`;
	}

	/**
	 * Check if current platform is supported
	 */
	static isPlatformSupported(): boolean {
		return isPlatformSupported();
	}
}
