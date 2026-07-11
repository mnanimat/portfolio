[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$target = Join-Path $env:LOCALAPPDATA 'Programs\MNPortfolio'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MN Portfolio 3D.lnk'
$startMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MN Portfolio 3D.lnk'

Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $startMenuShortcut -Force -ErrorAction SilentlyContinue

Get-Process -Name MNPortfolio,UnrealGame-Win64-Shipping -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Set-Location -LiteralPath $env:TEMP
Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'MN Portfolio 3D removido.'
