. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$editorCmd = Join-Path $engineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$validationScript = Join-Path $Script:ProjectRoot 'Content\Python\mn_validate_project.py'
$ddc = Join-Path $Script:ProjectRoot 'DerivedDataCache'
New-Item -ItemType Directory -Force -Path $ddc | Out-Null

Invoke-Checked -FilePath $editorCmd -ArgumentList @(
    $Script:ProjectFile,
    "-LocalDataCachePath=$ddc",
    '-run=PythonScript',
    "-script=$validationScript",
    '-unattended',
    '-nop4',
    '-nosplash',
    '-NoSound',
    '-stdout',
    '-FullStdOutLogOutput'
)
