param([switch] $Resume)

. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$editorCmd = Join-Path $engineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$buildScript = Join-Path $Script:ProjectRoot 'Content\Python\mn_build_project.py'
$ddc = Join-Path $Script:ProjectRoot 'DerivedDataCache'
New-Item -ItemType Directory -Force -Path $ddc | Out-Null

if (-not (Test-Path -LiteralPath $editorCmd)) {
    throw "UnrealEditor-Cmd.exe nao encontrado em $editorCmd"
}

try {
    if ($Resume) {
        $env:MN_RESUME_BUILD = '1'
    }
    Invoke-Checked -FilePath $editorCmd -ArgumentList @(
        $Script:ProjectFile,
        "-LocalDataCachePath=$ddc",
        '-run=PythonScript',
        "-script=$buildScript",
        '-unattended',
        '-nop4',
        '-nosplash',
        '-NoSound',
        '-stdout',
        '-FullStdOutLogOutput'
    )
}
finally {
    Remove-Item Env:MN_RESUME_BUILD -ErrorAction SilentlyContinue
}
