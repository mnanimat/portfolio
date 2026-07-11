. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$runUat = Join-Path $engineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
$archive = Join-Path $Script:ProjectRoot 'Packaged\Win64'
New-Item -ItemType Directory -Force -Path $archive | Out-Null

Invoke-Checked -FilePath $runUat -ArgumentList @(
    'BuildCookRun',
    "-project=$Script:ProjectFile",
    '-noP4',
    '-platform=Win64',
    '-clientconfig=Shipping',
    '-build',
    '-cook',
    '-stage',
    '-pak',
    '-iostore',
    '-prereqs',
    '-archive',
    "-archivedirectory=$archive",
    '-AdditionalCookerOptions=-DDC-ForceMemoryCache',
    '-utf8output'
)
