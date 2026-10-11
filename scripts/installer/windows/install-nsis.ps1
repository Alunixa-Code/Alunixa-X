$ErrorActionPreference = 'Stop'

for ($attempt = 1; $attempt -le 3; $attempt++) {
    $candidates = @(
        "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
        "$env:ProgramFiles\NSIS\makensis.exe"
    )
    $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $compiler = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($compiler) {
        & $compiler /VERSION
        if ($LASTEXITCODE -eq 0) {
            if ($env:GITHUB_ENV) {
                "NSIS_COMPILER=$compiler" | Add-Content -LiteralPath $env:GITHUB_ENV -Encoding utf8
            }
            return
        }
    }
    if ($attempt -lt 3) {
        choco install nsis -y --no-progress
        # Check the executable on the next pass, even if Chocolatey reports success.
        Start-Sleep -Seconds (5 * $attempt)
    }
}
throw 'NSIS compiler is unavailable after installation retries.'
