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
import type TerminalPlugin from "../../main";
import {
	NativeBinaryManager,
	type BinaryStatus,
	type ProgressCallback,
} from "../core/native-binary-manager";
import { isPlatformSupported, MODULE_INFO } from "../core/embedded-modules";

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
	fontSize: 14,
	fontFamily: 'Consolas, "Courier New", monospace',
	cursorBlink: true,
	scrollback: 1000,
	githubRepo: "user/obsidian-terminal", // TODO: Update with actual repo
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

		// Header
		containerEl.createEl("h1", { text: "Terminal 设置" });

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
		containerEl.createEl("h2", { text: "原生模块" });

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
			.setName(status.installed ? "更新原生模块" : "下载原生模块")
			.setDesc(
				status.installed
					? `当前版本: v${status.version} - 点击检查更新`
					: "从 GitHub Release 下载原生模块以启用终端功能",
			)
			.addButton((btn: ButtonComponent) => {
				btn.setButtonText(status.installed ? "检查更新" : "下载安装")
					.setCta()
					.onClick(async () => {
						await this.downloadAndInstall(btn);
					});
			});

		// GitHub repo setting
		new Setting(actionContainer)
			.setName("GitHub 仓库")
			.setDesc("用于下载原生模块的 GitHub 仓库")
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
				.setName("清理模块")
				.setDesc("删除已安装的原生模块文件")
				.addButton((btn: ButtonComponent) => {
					btn.setButtonText("清理")
						.setWarning()
						.onClick(async () => {
							this.binaryManager.cleanup();
							new Notice("原生模块已清理");
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
		platformRow.createSpan({ text: "当前平台: ", cls: "status-label" });
		platformRow.createSpan({
			text: status.platformKey,
			cls: status.platformSupported ? "status-ok" : "status-error",
		});

		if (!status.platformSupported) {
			statusDiv.createDiv({
				text: `⚠️ 当前平台不受支持。支持的平台: ${MODULE_INFO.supportedPlatforms.join(", ")}`,
				cls: "status-warning",
			});
			return;
		}

		// Installation status
		const installRow = statusDiv.createDiv({ cls: "status-row" });
		installRow.createSpan({ text: "安装状态: ", cls: "status-label" });

		if (status.installed) {
			installRow.createSpan({ text: "✓ 已安装", cls: "status-ok" });

			// Version info
			if (status.version) {
				const versionRow = statusDiv.createDiv({ cls: "status-row" });
				versionRow.createSpan({ text: "版本: ", cls: "status-label" });
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
			filesRow.createSpan({ text: "文件: ", cls: "status-label" });
			filesRow.createSpan({ text: status.files.join(", ") });
		} else {
			installRow.createSpan({ text: "✗ 未安装", cls: "status-error" });
			statusDiv.createDiv({
				text: "请点击下方按钮下载原生模块以启用终端功能",
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
				checking: "🔍 检查中",
				downloading: "⬇️ 下载中",
				extracting: "📦 解压中",
				complete: "✅ 完成",
				error: "❌ 错误",
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
		btn.setButtonText("下载中...");

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

			new Notice("原生模块安装成功！请重新加载插件。");

			// Refresh display
			setTimeout(() => {
				this.display();
			}, 1000);
		} catch (error) {
			console.error("Installation failed:", error);
			new Notice(`安装失败: ${(error as Error).message}`);

			progressCallback({
				phase: "error",
				message: (error as Error).message,
				error: error as Error,
			});
		} finally {
			btn.setDisabled(false);
			btn.setButtonText("下载安装");
		}
	}

	/**
	 * Display appearance settings section
	 */
	private displayAppearanceSection(containerEl: HTMLElement): void {
		containerEl.createEl("h2", { text: "外观设置" });

		new Setting(containerEl)
			.setName("字体大小")
			.setDesc("终端字体大小（像素）")
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
			.setName("字体系列")
			.setDesc("终端使用的字体")
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
			.setName("光标闪烁")
			.setDesc("启用光标闪烁效果")
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
			.setName("滚动缓冲区")
			.setDesc("保留的历史行数")
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
		containerEl.createEl("h2", { text: "Shell 设置" });

		new Setting(containerEl)
			.setName("默认 Shell")
			.setDesc("留空使用系统默认 Shell")
			.addText((text) => {
				text.setPlaceholder(
					Platform.isWin ? "powershell.exe" : "/bin/bash",
				)
					.setValue(this.plugin.settings?.defaultShell ?? "")
					.onChange(async (value) => {
						if (this.plugin.settings) {
							this.plugin.settings.defaultShell = value;
							await this.plugin.saveSettings();
						}
					});
			});

		new Setting(containerEl)
			.setName("Shell 参数")
			.setDesc("启动 Shell 时的额外参数（逗号分隔）")
			.addText((text) => {
				text.setPlaceholder("例如: --login, -i")
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
}
