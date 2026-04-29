param(
  [string]$Path = "",
  [switch]$User,
  [switch]$Check
)

$ErrorActionPreference = "Stop"

function Resolve-ReleasePath([string]$PathValue) {
  if (-not [string]::IsNullOrWhiteSpace($PathValue)) {
    return (Resolve-Path -LiteralPath $PathValue -ErrorAction Stop).Path
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CONTAM_CHINESE_HOME)) {
    $existing = Resolve-Path -LiteralPath $env:CONTAM_CHINESE_HOME -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
      return $existing.Path
    }
  }

  $repoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
  $candidates = @(
    (Join-Path $repoRoot.Path "..\contam_chinese\local\release_seed"),
    (Join-Path $repoRoot.Path "..\contam_chinese"),
    (Join-Path $repoRoot.Path "..\contam_cn\local\release_seed"),
    (Join-Path $repoRoot.Path "..\contam_cn")
  )

  foreach ($candidate in $candidates) {
    $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction SilentlyContinue
    if ($null -ne $resolved -and (Test-Path -LiteralPath (Join-Path $resolved.Path "contamx3.exe") -PathType Leaf)) {
      return $resolved.Path
    }
  }

  throw "Could not find a contam_chinese release folder. Pass -Path <folder> or set CONTAM_CHINESE_HOME."
}

function Assert-ReleaseFiles([string]$ReleasePath) {
  $required = @(
    "contamw3.exe",
    "contamx3.exe",
    "prjup.exe",
    "simread.exe",
    "simcomp.exe",
    "olch2d32.dll"
  )

  foreach ($item in $required) {
    $fullPath = Join-Path $ReleasePath $item
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      throw "Missing contam_chinese release file: $item"
    }
  }
}

$releasePath = Resolve-ReleasePath $Path
Assert-ReleaseFiles $releasePath

if ($Check) {
  Write-Output "OK: contam_chinese release files are available."
  Write-Output $releasePath
  exit 0
}

if ($User) {
  [Environment]::SetEnvironmentVariable("CONTAM_CHINESE_HOME", $releasePath, "User")
  Write-Output "Set user CONTAM_CHINESE_HOME."
  Write-Output "Restart your MCP host so it can read the updated environment."
} else {
  $env:CONTAM_CHINESE_HOME = $releasePath
  Write-Output "Set CONTAM_CHINESE_HOME for this PowerShell session."
  Write-Output '$env:CONTAM_CHINESE_HOME is ready for the current session.'
}
