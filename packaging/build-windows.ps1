param(
  [string]$NodeVersion = '24.22.1',
  [string]$OutputDir = 'build'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$output = [System.IO.Path]::GetFullPath((Join-Path $repo $OutputDir))
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
$bundleName = "pnb-pilot-win-x64-$stamp"
$stage = Join-Path $output $bundleName
$archive = Join-Path $output "$bundleName.zip"
$nodeZipName = "node-v$NodeVersion-win-x64.zip"
$downloads = Join-Path $output 'downloads'
$nodeZip = Join-Path $downloads $nodeZipName
$checksums = Join-Path $downloads "SHASUMS256-$NodeVersion.txt"

New-Item -ItemType Directory -Force -Path $downloads | Out-Null
if (-not (Test-Path -LiteralPath $nodeZip)) {
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/$nodeZipName" -OutFile $nodeZip
}
Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $checksums
$line = Get-Content -LiteralPath $checksums | Where-Object { $_ -match "\s$([regex]::Escape($nodeZipName))$" } | Select-Object -First 1
if (-not $line) { throw "Official checksum for $nodeZipName was not found" }
$expected = ($line -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Node runtime SHA-256 mismatch' }

New-Item -ItemType Directory -Path $stage | Out-Null
$expanded = Join-Path $stage '_node-download'
Expand-Archive -LiteralPath $nodeZip -DestinationPath $expanded
$nodeRoot = Join-Path $expanded "node-v$NodeVersion-win-x64"
Copy-Item -LiteralPath (Join-Path $nodeRoot 'node.exe') -Destination (Join-Path $stage 'node.exe')
Copy-Item -LiteralPath (Join-Path $nodeRoot 'LICENSE') -Destination (Join-Path $stage 'NODE-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $repo 'README.md') -Destination (Join-Path $stage 'README.md')
Copy-Item -LiteralPath (Join-Path $repo 'PLAN.md') -Destination (Join-Path $stage 'PLAN.md')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-PNB.cmd') -Destination (Join-Path $stage 'Start-PNB.cmd')
New-Item -ItemType Directory -Path (Join-Path $stage 'pnb') | Out-Null
$files = @('app.mjs','cli.mjs','demo.mjs','evm.html','evm.mjs','evm-ui.mjs','index.html','ledger.mjs','node.mjs','peer.mjs','sample-ledger.json','server.mjs')
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path (Join-Path $repo 'pnb') $file) -Destination (Join-Path (Join-Path $stage 'pnb') $file)
}
New-Item -ItemType Directory -Path (Join-Path $stage 'pnb/examples') | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'pnb/examples/test-contract.txt') -Destination (Join-Path $stage 'pnb/examples/test-contract.txt')
Copy-Item -LiteralPath (Join-Path $repo 'pnb/examples/second-audit-finding.json') -Destination (Join-Path $stage 'pnb/examples/second-audit-finding.json')

$resolvedStage = [System.IO.Path]::GetFullPath($stage)
$resolvedOutput = [System.IO.Path]::GetFullPath($output)
if (-not $resolvedStage.StartsWith($resolvedOutput + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unsafe temporary directory path'
}
Remove-Item -LiteralPath $expanded -Recurse -Force
Compress-Archive -LiteralPath $stage -DestinationPath $archive
$zipHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "PACKAGE=$archive"
Write-Output "SHA256=$zipHash"
Write-Output "NODE_SHA256=$actual"
