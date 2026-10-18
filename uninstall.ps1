# uninstall.ps1 - remove dsh-screenshot from the desktop profile.
# ASCII only: Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI.
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$target = Join-Path $ProfileDir 'node_modules\dsh-screenshot'
$patchFile = Join-Path $ProfileDir 'cordis.patch.yml'

if (Test-Path -LiteralPath $patchFile) {
  $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $patchFile)
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*- id:\s*dsh-screenshot\s*$') { $index = $i; break }
  }
  if ($index -ge 0) {
    $end = $index
    if ($end + 1 -lt $lines.Count -and $lines[$end + 1] -match '^\s*name:\s*dsh-screenshot\s*$') {
      $end++
    }
    $start = $index
    if ($start - 1 -ge 0 -and $lines[$start - 1] -match '^\s*- insert:\s*$') { $start-- }
    if ($start - 1 -ge 0 -and $lines[$start - 1] -match '^\s*#\s*dsh-screenshot') { $start-- }
    $lines.RemoveRange($start, $end - $start + 1)
    Set-Content -LiteralPath $patchFile -Value $lines -Encoding UTF8
    Write-Output "unpatched -> $patchFile"
  } else {
    Write-Output "not registered -> $patchFile"
  }
}

if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
  Write-Output "removed -> $target"
}

Write-Output ''
Write-Output 'Done. DSH reloads the profile automatically; reopen the window if the button is still visible.'
