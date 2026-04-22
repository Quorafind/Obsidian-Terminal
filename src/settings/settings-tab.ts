/**
 * Terminal Plugin Settings Tab
 *
 * Provides UI for managing plugin settings and native binary installation.
 * Uses Obsidian's native SettingGroup API for consistent styling.
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
	// @ts-expect-error - SettingGroup is not yet in the public API types
	SettingGroup,
} from "obsidian";

import type TerminalPlugin from "@/main";
import {
	NativeBinaryManager,
	type BinaryStatus,
	type ProgressCallback,
} from "@/core/native-binary-manager";
import {
	MODULE_INFO,
	getCurrentNodeABI,
	SUPPORTED_ABIS,
} from "@/core/embedded-modules";
import { GHOSTTY_OPTIONS } from "@/constants";
import { getDarkThemes, getLightThemes } from "@/core/themes";

/**
 * Terminal renderer type
 */
export type TerminalRenderer = "xterm" | "xterm-webgl" | "ghostty";

/**
 * Theme mode - system follows Obsidian CSS, preset uses predefined themes
 */
export type ThemeMode = "system" | "preset";

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
	githubRepo: string;
	renderer: TerminalRenderer;
	themeMode: ThemeMode;
	darkThemePreset: string;
	lightThemePreset: string;
	tabTitleShowCwd: boolean;
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
	renderer: "ghostty",
	themeMode: "system",
	darkThemePreset: "dracula",
	lightThemePreset: "github-light",
	tabTitleShowCwd: false,
};

/**
 * Terminal Plugin Settings Tab
 */
export class TerminalSettingsTab extends PluginSettingTab {
	plugin: TerminalPlugin;
	private binaryManager: NativeBinaryManager;
	private progressEl: HTMLElement | null = null;

	icon: string = "terminal";

	constructor(app: App, plugin: TerminalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.binaryManager = new NativeBinaryManager(plugin.getPluginDir());
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Native Modules Section
		this.displayBinarySection(containerEl);

		// Appearance Section
		this.displayAppearanceSection(containerEl);

		// Shell Settings Section
		this.displayShellSection(containerEl);

		// Renderer Section
		this.displayRendererSection(containerEl);
	}

	/**
	 * Display native binary management section
	 */
	private displayBinarySection(containerEl: HTMLElement): void {
		const status = this.binaryManager.getStatus();

		const group = new SettingGroup(containerEl);
		group.setHeading("Native Modules");

		// Status info
		group.addSetting((setting: Setting) => {
			setting.setName("Status");

			const descParts: string[] = [`Platform: ${status.platformKey}`];

			if (!status.platformSupported) {
				descParts.push(
					`Platform not supported. Supported: ${MODULE_INFO.supportedPlatforms.join(", ")}`,
				);
				setting.setDesc(descParts.join(" | "));
				return;
			}

			if (status.installed) {
				descParts.push("Installed");
				if (status.version) descParts.push(`v${status.version}`);
				if (status.electronVersion) {
					descParts.push(
						`Electron ${status.electronVersion} (ABI ${status.nodeABI})`,
					);
				}
				descParts.push(`Files: ${status.files.join(", ")}`);
			} else {
				descParts.push("Not installed");
			}

			setting.setDesc(descParts.join(" | "));
		});

		// Progress display
		this.progressEl = group.groupEl.createDiv() as HTMLElement;
		this.progressEl.hide();

		// Download/Update button
		group.addSetting((setting: Setting) => {
			setting
				.setName(
					status.installed
						? "Update Native Modules"
						: "Download Native Modules",
				)
				.setDesc(
					status.installed
						? `Current version: v${status.version} - Click to check for updates`
						: "Download native modules from GitHub Release",
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
		});

		// Install from local ZIP
		group.addSetting((setting: Setting) => {
			setting
				.setName("Install from Local ZIP")
				.setDesc("Select a ZIP file to install")
				.addButton((btn: ButtonComponent) => {
					btn.setButtonText("Select ZIP").onClick(async () => {
						await this.installFromLocalFile(btn);
					});
				});
		});

		// GitHub repo setting
		group.addSetting((setting: Setting) => {
			setting
				.setName("GitHub Repository")
				.setDesc("Repository for downloading native modules")
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
		});

		// Cleanup button
		if (status.installed) {
			group.addSetting((setting: Setting) => {
				setting
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
			});
		}
	}

	/**
	 * Display appearance settings section
	 */
	private displayAppearanceSection(containerEl: HTMLElement): void {
		const group = new SettingGroup(containerEl);
		group.setHeading("Appearance");

		// Theme mode
		group.addSetting((setting: Setting) => {
			setting
				.setName("Theme mode")
				.setDesc(
					"Follow Obsidian uses colors from your current theme. Preset allows choosing specific color schemes.",
				)
				.addDropdown((dropdown) => {
					dropdown
						.addOption("system", "Follow Obsidian")
						.addOption("preset", "Use Presets")
						.setValue(
							this.plugin.settings?.themeMode ??
								DEFAULT_SETTINGS.themeMode,
						)
						.onChange(async (value) => {
							if (this.plugin.settings) {
								this.plugin.settings.themeMode =
									value as ThemeMode;
								await this.plugin.saveSettings();
								this.display();
							}
						});
				});
		});

		// Preset theme options
		if (this.plugin.settings?.themeMode === "preset") {
			const darkThemes = getDarkThemes();
			const lightThemes = getLightThemes();

			group.addSetting((setting: Setting) => {
				setting
					.setName("Dark mode theme")
					.setDesc("Theme used when Obsidian is in dark mode")
					.addDropdown((dropdown) => {
						darkThemes.forEach(({ id, theme }) => {
							dropdown.addOption(id, theme.name);
						});
						dropdown
							.setValue(
								this.plugin.settings?.darkThemePreset ??
									DEFAULT_SETTINGS.darkThemePreset,
							)
							.onChange(async (value) => {
								if (this.plugin.settings) {
									this.plugin.settings.darkThemePreset =
										value;
									await this.plugin.saveSettings();
								}
							});
					});
			});

			group.addSetting((setting: Setting) => {
				setting
					.setName("Light mode theme")
					.setDesc("Theme used when Obsidian is in light mode")
					.addDropdown((dropdown) => {
						lightThemes.forEach(({ id, theme }) => {
							dropdown.addOption(id, theme.name);
						});
						dropdown
							.setValue(
								this.plugin.settings?.lightThemePreset ??
									DEFAULT_SETTINGS.lightThemePreset,
							)
							.onChange(async (value) => {
								if (this.plugin.settings) {
									this.plugin.settings.lightThemePreset =
										value;
									await this.plugin.saveSettings();
								}
							});
					});
			});
		}

		// Font size
		group.addSetting((setting: Setting) => {
			setting
				.setName("Font size")
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
		});

		// Font family
		group.addSetting((setting: Setting) => {
			setting
				.setName("Font family")
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
		});

		// Cursor blink
		group.addSetting((setting: Setting) => {
			setting
				.setName("Cursor blink")
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
		});

		// Scrollback
		group.addSetting((setting: Setting) => {
			setting
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
		});

		// Tab title: show cwd only
		group.addSetting((setting: Setting) => {
			setting
				.setName("Show current directory in tab title")
				.setDesc(
					"When enabled, the tab title shows only the current working directory name instead of the full shell title.",
				)
				.addToggle((toggle) => {
					toggle
						.setValue(
							this.plugin.settings?.tabTitleShowCwd ??
								DEFAULT_SETTINGS.tabTitleShowCwd,
						)
						.onChange(async (value) => {
							if (this.plugin.settings) {
								this.plugin.settings.tabTitleShowCwd = value;
								await this.plugin.saveSettings();
							}
						});
				});
		});
	}

	/**
	 * Display shell settings section
	 */
	private displayShellSection(containerEl: HTMLElement): void {
		const group = new SettingGroup(containerEl);
		group.setHeading("Shell");

		const alternatives =
			this.plugin.ptyManager?.getAlternativeShells() ?? [];
		const currentShell = this.plugin.settings?.defaultShell || "";

		let selectedOption = "custom";
		if (currentShell === "") {
			selectedOption = "default";
		} else if (alternatives.includes(currentShell)) {
			selectedOption = currentShell;
		}

		// References for cross-setting communication
		let customShellSettingEl: HTMLElement | null = null;
		let customShellText: any = null;
		let currentDropdownValue = selectedOption;

		// Helper to update custom shell visibility
		const updateCustomShellVisibility = (showCustom: boolean) => {
			if (customShellSettingEl) {
				if (showCustom) {
					customShellSettingEl.show();
				} else {
					customShellSettingEl.hide();
				}
			}
		};

		// Shell dropdown
		group.addSetting((setting: Setting) => {
			setting
				.setName("Default shell")
				.setDesc("Select a detected shell or choose Custom")
				.addExtraButton((btn) => {
					btn.setIcon("play")
						.setTooltip("Test shell")
						.onClick(async () => {
							const shellToTest =
								currentDropdownValue === "default"
									? (this.plugin.ptyManager?.getDefaultShell() ??
										"")
									: currentDropdownValue === "custom"
										? (this.plugin.settings?.defaultShell ??
											"")
										: currentDropdownValue;

							if (!shellToTest) {
								new Notice("No shell selected to test");
								return;
							}

							const isValid =
								this.plugin.ptyManager?.validateShellPath(
									shellToTest,
								) ?? false;

							new Notice(
								isValid
									? `Shell is valid: ${shellToTest}`
									: `Shell not found: ${shellToTest}`,
							);
						});
				})
				.addDropdown((dropdown) => {
					dropdown.addOption("default", "System Default");
					alternatives.forEach((shell) => {
						dropdown.addOption(
							shell,
							this.getShellDisplayName(shell),
						);
					});
					dropdown.addOption("custom", "Custom...");
					dropdown.setValue(selectedOption);

					dropdown.onChange(async (value) => {
						currentDropdownValue = value;

						if (value === "custom") {
							updateCustomShellVisibility(true);
						} else {
							updateCustomShellVisibility(false);
							if (this.plugin.settings) {
								this.plugin.settings.defaultShell =
									value === "default" ? "" : value;
								await this.plugin.saveSettings();
							}
							if (customShellText) {
								customShellText.setValue(
									this.plugin.settings?.defaultShell ?? "",
								);
							}
						}
					});
				});
		});

		// Custom shell path (controlled visibility)
		group.addSetting((setting: Setting) => {
			customShellSettingEl = setting.settingEl;

			setting
				.setName("Custom shell path")
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
				customShellSettingEl.hide();
			}
		});

		// Shell arguments
		group.addSetting((setting: Setting) => {
			setting
				.setName("Shell arguments")
				.setDesc("Additional arguments (comma separated)")
				.addText((text) => {
					text.setPlaceholder("--login, -i")
						.setValue(
							this.plugin.settings?.shellArgs?.join(", ") ?? "",
						)
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
		});
	}

	/**
	 * Display renderer settings section
	 */
	private displayRendererSection(containerEl: HTMLElement): void {
		const group = new SettingGroup(containerEl);
		group.setHeading("Renderer");

		group.addSetting((setting: Setting) => {
			setting
				.setName("Terminal renderer")
				.setDesc(
					"Xterm.js is stable. WebGL offers better performance. Ghostty is experimental.",
				)
				.addDropdown((dropdown) => {
					dropdown
						.addOption("xterm", "Xterm.js (Canvas)")
						.addOption("xterm-webgl", "Xterm.js (WebGL)")
						.addOption("ghostty", "Ghostty")
						.setValue(
							this.plugin.settings?.renderer ??
								DEFAULT_SETTINGS.renderer,
						)
						.onChange(async (value) => {
							if (this.plugin.settings) {
								this.plugin.settings.renderer =
									value as TerminalRenderer;
								await this.plugin.saveSettings();
								new Notice(
									"Please reload the plugin to apply this change.",
								);
							}
						});
				});
		});
	}

	/**
	 * Create a progress callback
	 */
	private createProgressCallback(): ProgressCallback {
		return (progress) => {
			if (!this.progressEl) return;

			this.progressEl.style.display = "block";
			this.progressEl.empty();

			const phaseMap: Record<string, string> = {
				checking: "Checking...",
				downloading: "Downloading...",
				extracting: "Extracting...",
				complete: "Complete",
				error: "Error",
			};

			this.progressEl.createDiv({
				text: `${phaseMap[progress.phase] || progress.phase}: ${progress.message}`,
			});

			if (progress.percent !== undefined) {
				const bar = this.progressEl.createDiv();
				bar.style.cssText =
					"height: 4px; background: var(--background-modifier-border); border-radius: 2px; margin-top: 8px;";
				const fill = bar.createDiv();
				fill.style.cssText = `height: 100%; width: ${progress.percent}%; background: var(--interactive-accent); border-radius: 2px; transition: width 0.2s;`;
			}
		};
	}

	/**
	 * Download and install from GitHub Release
	 */
	private async downloadAndInstall(btn: ButtonComponent): Promise<void> {
		btn.setDisabled(true);
		btn.setButtonText("Downloading...");

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

			setTimeout(() => this.display(), 1000);
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
	 * Install from local ZIP file
	 */
	private async installFromLocalFile(btn: ButtonComponent): Promise<void> {
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

				setTimeout(() => this.display(), 1000);
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
				btn.setButtonText("Select ZIP");
				fileInput.remove();
			}
		});

		document.body.appendChild(fileInput);
		fileInput.click();
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
