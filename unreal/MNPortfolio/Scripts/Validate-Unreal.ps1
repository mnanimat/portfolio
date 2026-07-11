. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$editorCmd = Join-Path $engineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$validationScript = Join-Path $Script:ProjectRoot 'Content\Python\mn_validate_project.py'

Invoke-Checked -FilePath $editorCmd -ArgumentList @(
    $Script:ProjectFile,
    '-DDC-ForceMemoryCache',
    '-run=PythonScript',
    "-script=$validationScript",
    '-unattended',
    '-nop4',
    '-nosplash',
    '-NoSound',
    '-stdout',
    '-FullStdOutLogOutput'
)
