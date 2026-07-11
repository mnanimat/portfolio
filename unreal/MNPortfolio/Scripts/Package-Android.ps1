. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$runUat = Join-Path $engineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
$archive = Join-Path $Script:ProjectRoot 'Packaged\Android'
$ddc = Join-Path $Script:ProjectRoot 'DerivedDataCache'
New-Item -ItemType Directory -Force -Path $archive | Out-Null
New-Item -ItemType Directory -Force -Path $ddc | Out-Null

if (-not $env:ANDROID_HOME -or -not (Test-Path -LiteralPath $env:ANDROID_HOME)) {
    throw 'ANDROID_HOME nao esta configurado. Use Platforms > Android > Install SDK no Unreal Editor/Turnkey antes de empacotar; este script nao instala SDKs.'
}

Invoke-Checked -FilePath $runUat -ArgumentList @(
    'BuildCookRun',
    "-project=$Script:ProjectFile",
    '-noP4',
    '-platform=Android',
    '-cookflavor=ASTC',
    '-clientconfig=Shipping',
    '-build',
    '-cook',
    '-stage',
    '-pak',
    '-iostore',
    '-archive',
    "-archivedirectory=$archive",
    "-AdditionalCookerOptions=-LocalDataCachePath=`"$ddc`"",
    '-utf8output'
)
