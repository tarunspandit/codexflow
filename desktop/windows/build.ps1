param(
  [ValidateSet("x64", "arm64")]
  [string]$Architecture = "x64",
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Runtime = "win-$Architecture"
$OutputRoot = Join-Path $PSScriptRoot "dist\$Runtime"
$Stage = Join-Path $OutputRoot "CodexFlow"
$HelperStage = Join-Path $OutputRoot "helper"
$Version = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version

Remove-Item $OutputRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item $Stage -ItemType Directory -Force | Out-Null

dotnet publish (Join-Path $PSScriptRoot "CodexFlow.Windows\CodexFlow.Windows.csproj") `
  -c $Configuration -r $Runtime --self-contained true -p:PublishSingleFile=false -o $Stage
dotnet publish (Join-Path $PSScriptRoot "CodexFlowComputer\CodexFlowComputer.csproj") `
  -c $Configuration -r $Runtime --self-contained true -p:PublishSingleFile=false -o $HelperStage

Copy-Item (Join-Path $HelperStage "*") $Stage -Recurse -Force
Set-Content (Join-Path $Stage "version.txt") $Version -NoNewline

$Archive = Join-Path $OutputRoot "CodexFlow-Windows-$Architecture.zip"
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Archive -CompressionLevel Optimal
$Hash = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content "$Archive.sha256" "$Hash  $(Split-Path $Archive -Leaf)" -NoNewline

Write-Output $Archive
