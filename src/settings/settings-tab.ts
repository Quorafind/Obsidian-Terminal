/**
 * Terminal Plugin Settings Tab
 *
 * Provides UI for managing plugin settings and native binary installation.
 *
 * @module settings-tab
 */

import {
	App,
	PluginSettingTab,
	Setting,
	Notice,
	ButtonComponent,
	Platform,
} from "obsidian";

// Import settings styles (will be bundled into styles.css)
import "./settings-styles.css";
import type TerminalPlugin from "@/main";
import {
	NativeBinaryManager,
	type BinaryStatus,
	type ProgressCallback,
} from "@/core/native-binary-manager";
import { isPlatformSupported, MODULE_INFO } from "@/core/embedded-modules";
import { GHOSTTY_OPTIONS } from "@/constants";

/**
 * Plugin settings interface
 */
export interface TerminalPluginSettings {
	defaultShell: string;
	shellArgs: string[];
	fontSize: number;
	fontFamily: string;
	cursorBlink: boolean;
	scrollback: number;
	// Native binary settings
	githubRepo: string;
}

/**
 * Default settings
 */
export const DEFAULT_SETTINGS: TerminalPluginSettings = {
	defaultShell: "",
	shellArgs: [],
	fontSize: GHOSTTY_OPTIONS.fontSize,
	fontFamily: GHOSTTY_OPTIONS.fontFamily,
	cursorBlink: true,
	scrollback: 1000,
	githubRepo: "quorafind/obsidian-terminal",
};

/**
 * Terminal Plugin Settings Tab
 */
export class TerminalSettingsTab extends PluginSettingTab {
	plugin: TerminalPlugin;
	private binaryManager: NativeBinaryManager;
	private progressEl: HTMLElement | null = null;

	constructor(app: App, plugin: TerminalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.binaryManager = new NativeBinaryManager(plugin.getPluginDir());
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Apply terminal theme class to container
		containerEl.addClass("terminal-settings");

		// Header
		containerEl.createEl("h1", { text: "Terminal Settings" });

		// Native Binary Section
		this.displayBinarySection(containerEl);

		// Terminal Appearance Section
		this.displayAppearanceSection(containerEl);

		// Shell Settings Section
		this.displayShellSection(containerEl);
	}

	/**
	 * Display native binary management section
	 */
	private displayBinarySection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Native Modules" });

		const status = this.binaryManager.getStatus();
		const platformKey = this.getPlatformKey();

		// Status display
		this.renderBinaryStatus(containerEl, status);

		// Progress display (hidden by default)
		this.progressEl = containerEl.createDiv({
			cls: "terminal-binary-progress",
		});
		this.progressEl.style.display = "none";

		// Action buttons
		const actionContainer = containerEl.createDiv({
			cls: "terminal-binary-actions",
		});

		// Download/Update button
		new Setting(actionContainer)
			.setName(
				status.installed
					? "Update Native Modules"
					: "Download Native Modules",
			)
			.setDesc(
				status.installed
					? `Current version: v${status.version} - Click to check for updates`
					: "Download native modules from GitHub Release to enable terminal functionality",
			)
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(
					status.installed ? "Check Updates" : "Download",
				)
					.setCta()
					.onClick(async () => {
						await this.downloadAndInstall(btn);
					});
			});

		// Install from local ZIP button
		new Setting(actionContainer)
			.setName("Install from Local ZIP")
			.setDesc(
				"Select a ZIP file to install. Supports both plugin core updates (main.js, manifest.json, styles.css) and native module bundles (for your platform).",
			)
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText("Select ZIP File").onClick(async () => {
					await this.installFromLocalFile(btn);
				});
			});

		// GitHub repo setting
		new Setting(actionContainer)
			.setName("GitHub Repository")
			.setDesc("GitHub repository for downloading native modules")
			.addText((text) => {
				text.setPlaceholder("user/repo")
					.setValue(
						this.plugin.settings?.githubRepo ??
							DEFAULT_SETTINGS.githubRepo,
					)
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.githubRepo =
								value || DEFAULT_SETTINGS.githubRepo;
							await this.plugin.saveSettings();
						}
					});
			});

		// Cleanup button (only show if installed)
		if (status.installed) {
			new Setting(actionContainer)
				.setName("Clean Up Modules")
				.setDesc("Remove installed native module files")
				.addButton((btn: ButtonComponent) => {
					btn.setButtonText("Clean Up")
						.setWarning()
						.onClick(async () => {
							this.binaryManager.cleanup();
							new Notice("Native modules cleaned up");
							this.display();
						});
				});
		}
	}

	/**
	 * Render binary status information
	 */
	private renderBinaryStatus(
		container: HTMLElement,
		status: BinaryStatus,
	): void {
		const statusDiv = container.createDiv({ cls: "terminal-status-card" });

		// Platform info
		const platformRow = statusDiv.createDiv({ cls: "status-row" });
		platformRow.createSpan({ text: "Platform: ", cls: "status-label" });
		platformRow.createSpan({
			text: status.platformKey,
			cls: status.platformSupported ? "status-ok" : "status-error",
		});

		if (!status.platformSupported) {
			statusDiv.createDiv({
				text: `⚠️ Current platform is not supported. Supported platforms: ${MODULE_INFO.supportedPlatforms.join(", ")}`,
				cls: "status-warning",
			});
			return;
		}

		// Installation status
		const installRow = statusDiv.createDiv({ cls: "status-row" });
		installRow.createSpan({ text: "Status: ", cls: "status-label" });

		if (status.installed) {
			installRow.createSpan({ text: "✓ Installed", cls: "status-ok" });

			// Version info
			if (status.version) {
				const versionRow = statusDiv.createDiv({ cls: "status-row" });
				versionRow.createSpan({
					text: "Version: ",
					cls: "status-label",
				});
				versionRow.createSpan({ text: `v${status.version}` });
			}

			// Electron/ABI info
			if (status.electronVersion) {
				const abiRow = statusDiv.createDiv({ cls: "status-row" });
				abiRow.createSpan({ text: "Electron: ", cls: "status-label" });
				abiRow.createSpan({
					text: `${status.electronVersion} (ABI ${status.nodeABI})`,
				});
			}

			// File list
			const filesRow = statusDiv.createDiv({ cls: "status-row" });
			filesRow.createSpan({ text: "Files: ", cls: "status-label" });
			filesRow.createSpan({ text: status.files.join(", ") });
		} else {
			installRow.createSpan({
				text: "✗ Not installed",
				cls: "status-error",
			});
			statusDiv.createDiv({
				text: "Click the button below to download native modules and enable terminal functionality",
				cls: "status-hint",
			});
		}
	}

	/**
	 * Get current platform key using Obsidian Platform API
	 */
	private getPlatformKey(): string {
		if (Platform.isWin) {
			return "win32_x64";
		} else if (Platform.isMacOS) {
			return process.arch === "arm64" ? "darwin_arm64" : "darwin_x64";
		} else if (Platform.isLinux) {
			return "linux_x64";
		}
		return `${process.platform}_${process.arch}`;
	}

	/**
	 * Create a progress callback
	 */
	private createProgressCallback(): ProgressCallback {
		return (progress) => {
			if (!this.progressEl) return;

			this.progressEl.empty();
			const progressDiv = this.progressEl.createDiv({
				cls: "progress-info",
			});

			const phaseMap: Record<string, string> = {
				checking: "🔍 Checking",
				downloading: "⬇️ Downloading",
				extracting: "📦 Extracting",
				complete: "✅ Complete",
				error: "❌ Error",
			};

			progressDiv.createEl("div", {
				text: phaseMap[progress.phase] || progress.phase,
				cls: `phase-${progress.phase}`,
			});

			progressDiv.createEl("div", {
				text: progress.message,
				cls: "progress-message",
			});

			if (progress.percent !== undefined) {
				const progressBar = progressDiv.createDiv({
					cls: "progress-bar",
				});
				const progressFill = progressBar.createDiv({
					cls: "progress-fill",
				});
				progressFill.style.width = `${progress.percent}%`;
			}
		};
	}

	/**
	 * Download and install from GitHub Release
	 */
	private async downloadAndInstall(btn: ButtonComponent): Promise<void> {
		btn.setDisabled(true);
		btn.setButtonText("Downloading...");

		if (this.progressEl) {
			this.progressEl.style.display = "block";
			this.progressEl.empty();
		}

		const progressCallback = this.createProgressCallback();

		try {
			const repo =
				this.plugin.settings?.githubRepo || DEFAULT_SETTINGS.githubRepo;
			await this.binaryManager.installFromGitHubRelease(
				repo,
				progressCallback,
			);

			new Notice(
				"Native modules installed successfully! Please reload the plugin.",
			);

			// Refresh display
			setTimeout(() => {
				this.display();
			}, 1000);
		} catch (error) {
			console.error("Installation failed:", error);
			new Notice(`Installation failed: ${(error as Error).message}`);

			progressCallback({
				phase: "error",
				message: (error as Error).message,
				error: error as Error,
			});
		} finally {
			btn.setDisabled(false);
			btn.setButtonText("Download");
		}
	}

	/**
	 * Install from local ZIP file using file picker
	 */
	private async installFromLocalFile(btn: ButtonComponent): Promise<void> {
		// Create a hidden file input
		const fileInput = document.createElement("input");
		fileInput.type = "file";
		fileInput.accept = ".zip";
		fileInput.style.display = "none";

		fileInput.addEventListener("change", async () => {
			const file = fileInput.files?.[0];
			if (!file) {
				fileInput.remove();
				return;
			}

			btn.setDisabled(true);
			btn.setButtonText("Installing...");

			if (this.progressEl) {
				this.progressEl.style.display = "block";
				this.progressEl.empty();
			}

			const progressCallback = this.createProgressCallback();

			try {
				const arrayBuffer = await file.arrayBuffer();
				await this.binaryManager.installFromLocalZip(
					arrayBuffer,
					progressCallback,
				);

				new Notice(
					"Native modules installed successfully! Please reload the plugin.",
				);

				// Refresh display
				setTimeout(() => {
					this.display();
				}, 1000);
			} catch (error) {
				console.error("Installation from local file failed:", error);
				new Notice(`Installation failed: ${(error as Error).message}`);

				progressCallback({
					phase: "error",
					message: (error as Error).message,
					error: error as Error,
				});
			} finally {
				btn.setDisabled(false);
				btn.setButtonText("Select ZIP File");
				fileInput.remove();
			}
		});

		document.body.appendChild(fileInput);
		fileInput.click();
	}

	/**
	 * Display appearance settings section
	 */
	private displayAppearanceSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Appearance" });

		new Setting(containerEl)
			.setName("Font Size")
			.setDesc("Terminal font size in pixels")
			.addSlider((slider) => {
				slider
					.setLimits(10, 24, 1)
					.setValue(
						this.plugin.settings?.fontSize ??
							DEFAULT_SETTINGS.fontSize,
					)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.fontSize = value;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Font Family")
			.setDesc("Font used in the terminal")
			.addText((text) => {
				text.setPlaceholder(DEFAULT_SETTINGS.fontFamily)
					.setValue(this.plugin.settings?.fontFamily ?? "")
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.fontFamily =
								value || DEFAULT_SETTINGS.fontFamily;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Cursor Blink")
			.setDesc("Enable cursor blinking effect")
			.addToggle((toggle) => {
				toggle
					.setValue(
						this.plugin.settings?.cursorBlink ??
							DEFAULT_SETTINGS.cursorBlink,
					)
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.cursorBlink = value;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Scrollback")
			.setDesc("Number of lines to keep in history")
			.addSlider((slider) => {
				slider
					.setLimits(100, 10000, 100)
					.setValue(
						this.plugin.settings?.scrollback ??
							DEFAULT_SETTINGS.scrollback,
					)
					.setDynamicTooltip()
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.scrollback = value;
							await this.plugin.saveSettings();
						}
					});
			});
	}

	/**
	 * Display shell settings section
	 */
	private displayShellSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "Shell Settings" });

		// Get available shells from PTYManager
		const alternatives =
			this.plugin.ptyManager?.getAlternativeShells() ?? [];
		const currentShell = this.plugin.settings?.defaultShell || "";

		// Determine initial dropdown state
		let selectedOption = "custom";
		if (currentShell === "") {
			selectedOption = "default";
		} else if (alternatives.includes(currentShell)) {
			selectedOption = currentShell;
		}

		// Container for the Custom Shell Input (to toggle visibility)
		const customShellContainer = containerEl.createDiv();
		let customShellText: any;

		// 1. Shell Preset Dropdown
		new Setting(containerEl)
			.setName("Default Shell")
			.setDesc(
				"Select a detected shell or choose 'Custom' to enter a path manually.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("default", "System Default");
				alternatives.forEach((shell) => {
					// Show friendly name for common shells
					const name = this.getShellDisplayName(shell);
					dropdown.addOption(shell, name);
				});
				dropdown.addOption("custom", "Custom...");

				dropdown.setValue(selectedOption);

				dropdown.onChange(async (value) => {
					if (value === "custom") {
						customShellContainer.style.display = "block";
					} else {
						customShellContainer.style.display = "none";

						if (this.plugin.settings) {
							this.plugin.settings.defaultShell =
								value === "default" ? "" : value;
							await this.plugin.saveSettings();
						}

						// Sync text input
						if (customShellText) {
							customShellText.setValue(
								this.plugin.settings?.defaultShell ?? "",
							);
						}
					}
				});
			});

		// 2. Custom Shell Path Input
		new Setting(customShellContainer)
			.setName("Custom Shell Path")
			.setDesc("Absolute path to the shell executable")
			.addText((text) => {
				customShellText = text;
				text.setPlaceholder(
					Platform.isWin
						? "C:\\Windows\\System32\\powershell.exe"
						: "/usr/local/bin/fish",
				)
					.setValue(currentShell)
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.defaultShell = value;
							await this.plugin.saveSettings();
						}
					});
			});

		// Set initial visibility
		if (selectedOption !== "custom") {
			customShellContainer.style.display = "none";
		}

		// 3. Shell Arguments
		new Setting(containerEl)
			.setName("Shell Arguments")
			.setDesc(
				"Additional arguments when starting the shell (comma separated)",
			)
			.addText((text) => {
				text.setPlaceholder("e.g.: --login, -i")
					.setValue(this.plugin.settings?.shellArgs?.join(", ") ?? "")
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.shellArgs = value
								.split(",")
								.map((s) => s.trim())
								.filter((s) => s.length > 0);
							await this.plugin.saveSettings();
						}
					});
			});
	}

	/**
	 * Get display name for shell path
	 */
	private getShellDisplayName(shellPath: string): string {
		const basename = shellPath.split(/[/\\]/).pop() || shellPath;
		const nameMap: Record<string, string> = {
			zsh: "Zsh",
			bash: "Bash",
			sh: "Shell (sh)",
			fish: "Fish",
			"powershell.exe": "PowerShell",
			"pwsh.exe": "PowerShell Core",
			"cmd.exe": "Command Prompt",
		};
		return nameMap[basename] || shellPath;
	}
}
