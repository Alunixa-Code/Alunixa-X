$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__AX_REQUEST__')) | ConvertFrom-Json
    $directory = [IO.Path]::GetFullPath($inputData.appDirectory).TrimEnd('\')
    if ($directory.StartsWith('\\?\')) { $directory = $directory.Substring(4) }
    $packages = @(Get-AppxPackage | Where-Object {
        $_.Name -in @('OpenAI.Codex', 'OpenAI.CodexBeta', 'OpenAI.ChatGPT-Desktop')
    } | Where-Object {
        $root = [IO.Path]::GetFullPath($_.InstallLocation).TrimEnd('\')
        $directory.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
        $directory.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)
    })
    if ($packages.Count -ne 1) { exit 2 }
    $package = $packages[0]
    $manifest = Get-AppxPackageManifest -Package $package
    $appId = @($manifest.Package.Applications.Application)[0].Id
    if (-not $appId -or -not (Test-Path -LiteralPath $inputData.launcher -PathType Leaf)) { exit 3 }
    $inputData.request.package = $package.PackageFullName
    $utf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($inputData.requestPath, ($inputData.request | ConvertTo-Json -Depth 8 -Compress), $utf8)
    Invoke-CommandInDesktopPackage -PackageFamilyName $package.PackageFamilyName -AppId $appId `
        -Command $inputData.launcher -Args ('--alunixa-x-proxy-probe "' + $inputData.requestPath + '"') `
        -PreventBreakaway | Out-Null
    $deadline = [DateTime]::UtcNow.AddSeconds(18)
    while (-not (Test-Path -LiteralPath $inputData.request.output)) {
        if ([DateTime]::UtcNow -ge $deadline) { exit 4 }
        Start-Sleep -Milliseconds 80
    }
    exit 0
} catch {
    # Do not echo arguments, registry values or process errors containing credentials.
    exit 5
}
