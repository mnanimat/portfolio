. "$PSScriptRoot\Common.ps1"

$engineRoot = Get-UnrealRoot
$editor = Join-Path $engineRoot 'Engine\Binaries\Win64\UnrealEditor.exe'
if (-not (Test-Path -LiteralPath $editor)) {
    throw "UnrealEditor.exe nao encontrado em $editor"
}

Start-Process -FilePath $editor -ArgumentList @($Script:ProjectFile) -WindowStyle Normal
