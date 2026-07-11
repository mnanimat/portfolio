. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$editorCmd = Join-Path $engineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$buildScript = Join-Path $Script:ProjectRoot 'Content\Python\mn_build_project.py'

if (-not (Test-Path -LiteralPath $editorCmd)) {
    throw "UnrealEditor-Cmd.exe nao encontrado em $editorCmd"
}

Invoke-Checked -FilePath $editorCmd -ArgumentList @(
    $Script:ProjectFile,
    '-DDC-ForceMemoryCache',
    '-run=PythonScript',
    "-script=$buildScript",
    '-unattended',
    '-nop4',
    '-nosplash',
    '-NoSound',
    '-stdout',
    '-FullStdOutLogOutput'
)
