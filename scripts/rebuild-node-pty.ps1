# rebuild-node-pty.ps1
# Automatically switch Node.js version and rebuild node-pty for Obsidian's Electron
#
# Usage: .\scripts\rebuild-node-pty.ps1
#
# This script will:
# 1. Detect the required NODE_MODULE_VERSION from Obsidian's Electron
# 2. Find or install the matching Node.js version via nvm
# 3. Rebuild node-pty with @electron/rebuild
# 4. Switch back to original Node.js version

param(
    [string]$ElectronVersion = "37.10.2",  # Obsidian's Electron version
    [string]$TargetABI = "136",            # NODE_MODULE_VERSION 136 = Node.js 24.x
    [switch]$SkipRestore                   # Don't restore original Node.js version after build
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

# NODE_MODULE_VERSION to Node.js version mapping
$ABI_TO_NODE = @{
    "127" = "22"   # Node.js 22.x
    "131" = "23"   # Node.js 23.0-23.5
    "132" = "23"   # Node.js 23.6+ (Electron 34+)
    "133" = "24"   # Node.js 24.0-24.1
    "135" = "24"   # Node.js 24.2+ (Electron 36+)
    "136" = "24"   # Node.js 24.x (Electron 37+)
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  node-pty Rebuild Script for Obsidian" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

# Step 1: Get current Node.js version
Write-Info "Detecting current Node.js version..."
$originalVersion = $null
try {
    $nvmCurrent = & nvm current 2>&1
    if ($nvmCurrent -match "v?(\d+\.\d+\.\d+)") {
        $originalVersion = $Matches[1]
        Write-Success "Current Node.js version: $originalVersion"
    }
} catch {
    $nodeVersion = & node --version 2>&1
    if ($nodeVersion -match "v?(\d+\.\d+\.\d+)") {
        $originalVersion = $Matches[1]
        Write-Success "Current Node.js version: $originalVersion"
    }
}

# Step 2: Determine target Node.js major version
$targetMajor = $ABI_TO_NODE[$TargetABI]
if (-not $targetMajor) {
    Write-Err "Unknown ABI version: $TargetABI"
    Write-Info "Supported ABI versions: $($ABI_TO_NODE.Keys -join ', ')"
    exit 1
}
Write-Info "Target ABI: $TargetABI (Node.js $targetMajor.x)"

# Step 3: Check if target Node.js is installed
Write-Info "Checking installed Node.js versions..."
$nvmList = & nvm list 2>&1
$installedVersions = @()
foreach ($line in $nvmList) {
    if ($line -match "(\d+\.\d+\.\d+)") {
        $installedVersions += $Matches[1]
    }
}

$targetVersion = $installedVersions | Where-Object { $_ -match "^$targetMajor\." } | Select-Object -First 1

if (-not $targetVersion) {
    Write-Warn "Node.js $targetMajor.x is not installed"
    Write-Info "Installing Node.js $targetMajor (latest)..."

    & nvm install $targetMajor
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to install Node.js $targetMajor"
        exit 1
    }

    # Re-check installed versions
    $nvmList = & nvm list 2>&1
    foreach ($line in $nvmList) {
        if ($line -match "($targetMajor\.\d+\.\d+)") {
            $targetVersion = $Matches[1]
            break
        }
    }
}

Write-Success "Target Node.js version: $targetVersion"

# Step 4: Switch to target Node.js version
Write-Info "Switching to Node.js $targetVersion..."
& nvm use $targetVersion
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to switch Node.js version"
    exit 1
}

# Verify the switch
$currentNode = & node --version 2>&1
Write-Success "Now using Node.js $currentNode"

# Step 5: Navigate to project directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
Write-Info "Project directory: $projectDir"
Set-Location $projectDir

# Step 6: Fix Electron headers (required for MSVC compilation)
Write-Host ""
Write-Info "Step 1/4: Fixing Electron headers..."
& node scripts/fix-electron-headers.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to fix Electron headers"
    exit 1
}

# Step 7: Fix winpty.cc for MSVC
Write-Info "Step 2/5: Fixing winpty.cc for MSVC..."
& node scripts/fix-winpty-cc.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to fix winpty.cc"
    exit 1
}

# Step 7b: Fix conpty.cc for MSVC (Windows SDK compatibility)
Write-Info "Step 3/5: Fixing conpty.cc for MSVC..."
& node scripts/fix-conpty-cc.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to fix conpty.cc"
    exit 1
}

# Step 8: Rebuild node-pty using @electron/rebuild
Write-Host ""
Write-Info "Step 4/5: Rebuilding node-pty for Electron $ElectronVersion..."

# Use node to run the rebuild script directly to avoid npx path issues
$rebuildScript = "node_modules/@electron/rebuild/lib/cli.js"
if (Test-Path $rebuildScript) {
    & node $rebuildScript -m node_modules/node-pty -v $ElectronVersion
} else {
    # Fallback: try pnpm path
    $pnpmRebuildScript = "node_modules/.pnpm/@electron+rebuild@4.0.1/node_modules/@electron/rebuild/lib/cli.js"
    if (Test-Path $pnpmRebuildScript) {
        & node $pnpmRebuildScript -m node_modules/node-pty -v $ElectronVersion
    } else {
        Write-Err "@electron/rebuild not found. Please run 'npm install' first."
        exit 1
    }
}
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to rebuild node-pty"
    exit 1
}

# Step 9: Copy binaries to pnpm location
Write-Info "Step 5/5: Copying binaries to pnpm directory..."
& node scripts/copy-node-pty-binaries.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Err "Failed to copy binaries"
    exit 1
}

# Step 10: Verify the build
Write-Host ""
Write-Info "Verifying build..."

$releaseDir = "node_modules\node-pty\build\Release"
$binaries = @("pty.node", "conpty.node", "winpty.dll", "winpty-agent.exe")

foreach ($binary in $binaries) {
    $path = Join-Path $releaseDir $binary
    if (Test-Path $path) {
        $size = (Get-Item $path).Length / 1KB
        Write-Success "Found $binary ($([math]::Round($size, 1)) KB)"
    } else {
        Write-Warn "Missing: $binary"
    }
}

# Step 11: Restore original Node.js version
if (-not $SkipRestore -and $originalVersion) {
    Write-Host ""
    Write-Info "Restoring original Node.js version: $originalVersion"
    & nvm use $originalVersion
    $restoredNode = & node --version 2>&1
    Write-Success "Restored to Node.js $restoredNode"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Rebuild Complete!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Info "Next steps:"
Write-Host "  1. Run 'npm run build' to build the plugin"
Write-Host "  2. Reload Obsidian to test the terminal plugin"
Write-Host ""
