# Obsidian Terminal

![Version](https://img.shields.io/github/package-json/v/quorafind/obsidian-terminal)
![License](https://img.shields.io/github/license/quorafind/obsidian-terminal)
![Downloads](https://img.shields.io/github/downloads/quorafind/obsidian-terminal/total)
![Issues](https://img.shields.io/github/issues/quorafind/obsidian-terminal)

**Obsidian Terminal** is a powerful, integrated terminal plugin for Obsidian, built with `xterm.js` and `node-pty`. It brings a fully functional terminal environment directly into your Obsidian workspace, allowing you to run shell commands, git operations, and scripts without leaving your notes.

> [!NOTE]
> This plugin is designed for **Desktop only** (Windows, macOS, Linux). Mobile devices are not supported due to system limitations.

---

## ✨ Features

- **🖥️ Integrated Terminal View**: Open terminal instances directly within Obsidian panes.
- **🚀 Multi-Terminal Support**: Run multiple terminal sessions simultaneously.
- **🎨 Theme Integration**: Terminal colors automatically adapt to your current Obsidian theme (Light/Dark mode).
- **🐚 Custom Shell Configuration**: Configure your preferred shell (PowerShell, Bash, Zsh, CMD) and startup arguments.
- **📦 Smart Native Binaries**: Automatically detects your platform and manages native dependencies via GitHub Releases—no local compilation required.
- **🔗 Link Support**: Clickable web links within the terminal output.
- **💻 Cross-Platform**: Full support for Windows, macOS (Intel & Apple Silicon), and Linux.

## 📸 Screenshots

<!-- Add your screenshots here -->
![Terminal Preview](https://via.placeholder.com/800x400?text=Terminal+Preview+Placeholder)

## 🛠️ Tech Stack

| Component | Version | Description |
| :--- | :--- | :--- |
| [xterm.js](https://xtermjs.org/) | v5.5.0 | Web-based terminal rendering |
| [node-pty](https://github.com/microsoft/node-pty) | v1.0.0 | Pseudo-terminal backend |
| [@xterm/addon-fit](https://www.npmjs.com/package/@xterm/addon-fit) | v0.10.0 | Auto-resize support |
| [@xterm/addon-web-links](https://www.npmjs.com/package/@xterm/addon-web-links) | v0.11.0 | Clickable links |

## ⚙️ Requirements

- **Obsidian**: v1.10.0 or higher
- **Platform**: Windows (x64), macOS (x64/arm64), Linux (x64)

## 💿 Installation

### Method 1: Community Plugins (Recommended)

*Coming Soon...*

1. Open Obsidian Settings > **Community plugins**.
2. Turn off **Safe mode**.
3. Click **Browse** and search for `Terminal`.
4. Click **Install** and then **Enable**.

### Method 2: BRAT (Beta Testing)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin via Community Plugins.
2. Open command palette and run `BRAT: Add a beta plugin for testing`.
3. Enter the repository URL: `quorafind/obsidian-terminal`.
4. Click **Add Plugin**.

### Method 3: Manual Installation

1. Download the latest release from the [Releases Page](https://github.com/quorafind/obsidian-terminal/releases).
2. Extract `main.js`, `manifest.json`, `styles.css` into your vault's plugin folder:
   ```
   <Vault>/.obsidian/plugins/terminal/
   ```
3. Reload Obsidian and enable the plugin in settings.

## 🚀 Usage

### Open Terminal

- **Command Palette**: Press `Ctrl/Cmd + P`, then search for `Terminal: Open new terminal`
- **Ribbon Icon**: Click the Terminal icon in the left sidebar (if enabled)

### Close Terminal

- Type `exit` in the terminal, or
- Close the terminal pane directly

### Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl/Cmd + C` | Copy selected text |
| `Ctrl/Cmd + V` | Paste from clipboard |
| `Ctrl/Cmd + Shift + C` | Copy (when selection exists) |

## ⚙️ Configuration

Go to **Settings > Terminal** to customize your experience.

### Appearance

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Font Size** | Terminal text size (10px - 24px) | `14` |
| **Font Family** | Custom font family for the terminal | Obsidian monospace |
| **Cursor Blink** | Enable/disable cursor blinking | `On` |
| **Scrollback** | Number of lines to keep in history (100 - 10000) | `1000` |

### Shell Environment

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Default Shell** | Path to your preferred shell executable | System default |
| **Shell Arguments** | Arguments passed to shell on startup | Empty |

**Example Shell Paths:**
- Windows: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
- macOS/Linux: `/bin/zsh` or `/bin/bash`

### Native Modules

The plugin requires native `node-pty` binaries to function. These are managed automatically:

| Feature | Description |
| :--- | :--- |
| **Status** | Shows installation status, version, and platform |
| **Download** | Downloads pre-built binaries from GitHub Releases |
| **Clean Up** | Removes installed native modules |
| **GitHub Repo** | Configure the repository for binary downloads |

## 🏗️ Development

### Prerequisites

- Node.js 16+
- npm or pnpm

### Setup

```bash
# Clone the repository
git clone https://github.com/quorafind/obsidian-terminal.git
cd obsidian-terminal

# Install dependencies
npm install

# Build native modules for Electron
npm run rebuild:electron

# Development mode (watch)
npm run dev

# Production build
npm run build
```

### Available Scripts

| Script | Description |
| :--- | :--- |
| `npm run dev` | Start development with watch mode |
| `npm run build` | Production build with type checking |
| `npm run build:all` | Rebuild native modules + production build |
| `npm run rebuild:electron` | Rebuild node-pty for Obsidian's Electron |
| `npm run lint:check` | Run ESLint |
| `npm run clean` | Clean build artifacts |

### Project Structure

```
src/
├── main.ts                 # Plugin entry point
├── constants.ts            # Configuration constants
├── main.css                # Global styles
├── core/
│   ├── electron-bridge.ts  # Electron integration
│   ├── pty-manager.ts      # PTY process management
│   ├── terminal-manager.ts # Terminal session management
│   ├── native-binary-manager.ts # Binary download/install
│   └── embedded-modules.ts # Platform detection
├── views/
│   └── terminal-view.ts    # Terminal UI component
├── settings/
│   └── settings-tab.ts     # Plugin settings UI
└── types/                  # TypeScript type definitions
```

## 🤝 Contributing

Contributions are welcome!

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.

## 🙏 Acknowledgements

- [Obsidian](https://obsidian.md) - The amazing knowledge base app
- [xterm.js](https://github.com/xtermjs/xterm.js) - The terminal component
- [node-pty](https://github.com/microsoft/node-pty) - Pseudo-terminal implementation

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/Boninall">Boninall</a>
</p>
