[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $env:LOCALAPPDATA 'Programs\MNPortfolio'
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

New-Item -ItemType Directory -Force -Path $target | Out-Null
Get-ChildItem -LiteralPath $source -Force |
    Where-Object { $_.Name -notin @('Install-MNPortfolio.cmd', 'Install-MNPortfolio.ps1') } |
    Copy-Item -Destination $target -Recurse -Force

$exe = Join-Path $target 'MNPortfolio.exe'
if (-not (Test-Path -LiteralPath $exe)) {
    throw 'MNPortfolio.exe nao foi encontrado ao lado do instalador.'
}

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @(
    (Join-Path $desktop 'MN Portfolio 3D.lnk'),
    (Join-Path $startMenu 'MN Portfolio 3D.lnk')
)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $target
    $shortcut.Description = 'MN Portfolio 3D - MN Animation'
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Save()
}

Write-Host "MN Portfolio 3D instalado em: $target"
Start-Process -FilePath $exe
