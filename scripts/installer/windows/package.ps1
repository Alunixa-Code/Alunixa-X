param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$BinaryDir,
    [string]$OutputDir,
    [string]$Compiler = $env:NSIS_COMPILER
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if ($Version -notmatch '^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') { throw 'Invalid package version.' }
if (-not $BinaryDir) { $BinaryDir = Join-Path $root 'target/release' }
if (-not $OutputDir) { $OutputDir = Join-Path $root 'dist/windows' }
$source = (Resolve-Path -LiteralPath $BinaryDir).Path
$output = [IO.Path]::GetFullPath($OutputDir)
$app = Join-Path $output 'app'
New-Item -ItemType Directory -Force $app | Out-Null

$binaries = @('alunixa-x-plus.exe', 'alunixa-x-imagegen-mcp.exe')
foreach ($name in $binaries) {
    $path = Join-Path $source $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing application binary: $name" }
    $header = [IO.File]::ReadAllBytes($path)
    if ($header.Length -lt 2 -or $header[0] -ne 0x4d -or $header[1] -ne 0x5a) { throw "Not a PE binary: $name" }
    Copy-Item -LiteralPath $path -Destination (Join-Path $app $name) -Force
}
$notices = @('LICENSE', 'THIRD_PARTY_NOTICES.md')
foreach ($name in $notices) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination (Join-Path $app $name) -Force
}
$payloads = @($binaries) + @($notices)
$actual = @(Get-ChildItem -LiteralPath $app -File | ForEach-Object Name | Sort-Object)
if (Compare-Object ($payloads | Sort-Object) $actual) { throw 'Windows stage must contain only GUI, imagegen MCP, and license notices; clean the build stage before retrying.' }

if (-not $Compiler) {
    $Compiler = @(
        "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
        "$env:ProgramFiles\NSIS\makensis.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $Compiler) {
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) { $Compiler = $command.Source }
}
if (-not $Compiler) { throw 'NSIS compiler not found; run install-nsis.ps1 first.' }
$setup = Join-Path $output "Alunixa-X-$Version-windows-x64-setup.exe"
& $Compiler '/INPUTCHARSET' 'UTF8' "/DVERSION=$Version" "/DROOT=$root" "/DAPPDIR=$app" "/DOUTPUT_FILE=$setup" (Join-Path $PSScriptRoot 'AlunixaX.nsi')
if ($LASTEXITCODE -ne 0) { throw "NSIS packaging failed with exit code $LASTEXITCODE" }
if (-not (Test-Path -LiteralPath $setup -PathType Leaf) -or (Get-Item -LiteralPath $setup).Length -eq 0) { throw 'Installer output missing or empty.' }
Compress-Archive -LiteralPath ($payloads | ForEach-Object { Join-Path $app $_ }) -DestinationPath (Join-Path $output "Alunixa-X-$Version-windows-x64.zip") -Force
