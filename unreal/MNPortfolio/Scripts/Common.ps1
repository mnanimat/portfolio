Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$Script:ProjectFile = Join-Path $Script:ProjectRoot 'MNPortfolio.uproject'

function Get-UnrealRoot {
    if ($env:UE_ROOT -and (Test-Path -LiteralPath $env:UE_ROOT)) {
        return (Resolve-Path -LiteralPath $env:UE_ROOT).Path
    }

    $launcherData = 'C:\ProgramData\Epic\UnrealEngineLauncher\LauncherInstalled.dat'
    if (Test-Path -LiteralPath $launcherData) {
        $manifest = Get-Content -Raw -LiteralPath $launcherData | ConvertFrom-Json
        $match = $manifest.InstallationList |
            Where-Object { $_.AppName -eq 'UE_5.8' -or $_.ArtifactId -eq 'UE_5.8' } |
            Select-Object -First 1
        if ($match -and (Test-Path -LiteralPath $match.InstallLocation)) {
            return (Resolve-Path -LiteralPath $match.InstallLocation).Path
        }
    }

    $known = 'D:\Unreal Engine\UE_5.8'
    if (Test-Path -LiteralPath $known) {
        return (Resolve-Path -LiteralPath $known).Path
    }
    throw 'Unreal Engine 5.8 nao encontrada. Defina UE_ROOT com a pasta da engine.'
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [string] $FilePath,
        [Parameter(Mandatory)] [string[]] $ArgumentList
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Comando falhou com codigo $LASTEXITCODE`: $FilePath"
    }
}
