# install.ps1 - copy dsh-screenshot into the desktop profile and register its loader entry.
# ASCII only: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $ProfileDir 'node_modules\dsh-screenshot'
$patchFile = Join-Path $ProfileDir 'cordis.patch.yml'

if (-not (Test-Path -LiteralPath (Join-Path $ProfileDir 'package.json'))) {
  throw "Profile not found: $ProfileDir (open DeepSeek Harness Desktop once first)"
}

# 1) copy the package
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
Copy-Item -LiteralPath $packageRoot -Destination $target -Recurse -Force
Write-Output "copied -> $target"

# 1b) compile the native capture helper ahead of first use (csc ships with .NET Framework 4.x)
$source = Join-Path $target 'lib\ShotHelper.cs'
$helper = Join-Path $target 'lib\dsh-shot-helper.exe'
$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($csc -and (Test-Path -LiteralPath $source)) {
  & $csc /nologo /target:winexe /optimize+ "/out:$helper" $source /reference:System.Windows.Forms.dll /reference:System.Drawing.dll
  if ($LASTEXITCODE -eq 0) {
    Write-Output "compiled -> $helper"
  } else {
    Write-Warning "csc failed; the plugin will retry compilation on first use."
  }
} else {
  Write-Warning "csc.exe not found; the plugin will compile the helper on first use."
}

# 2) append the loader entry when it is not registered yet
$marker = 'id: dsh-screenshot'
$patch = if (Test-Path -LiteralPath $patchFile) { Get-Content -LiteralPath $patchFile -Raw } else { '' }
if ($patch -notmatch [regex]::Escape($marker)) {
  $block = @"

# dsh-screenshot: screenshot button in the composer, inserts into the current draft.
- insert:
    - id: dsh-screenshot
      name: dsh-screenshot
"@
  if ($patch.Length -gt 0 -and -not $patch.EndsWith("`n")) { $patch += "`n" }
  Set-Content -LiteralPath $patchFile -Value ($patch + $block) -Encoding UTF8
  Write-Output "patched -> $patchFile"
} else {
  Write-Output "already registered -> $patchFile"
}

Write-Output ''
Write-Output 'Done. DSH reloads this profile automatically (HMR); reopen the window if the button does not appear.'
