param(
  [string]$Python = "python",
  [string]$VenvPath = ".\.venv-contamxpy",
  [string]$Version = "0.0.9"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = git rev-parse --show-toplevel 2>$null
  if ([string]::IsNullOrWhiteSpace($root)) {
    throw "Run this script from inside the contam_MCP repository."
  }
  return $root.Trim()
}

$repoRoot = Resolve-RepoRoot
$resolvedVenvPath = if ([System.IO.Path]::IsPathRooted($VenvPath)) {
  $VenvPath
} else {
  Join-Path $repoRoot $VenvPath
}

if (-not (Test-Path -LiteralPath $resolvedVenvPath -PathType Container)) {
  & $Python -m venv $resolvedVenvPath
}

$venvPython = Join-Path $resolvedVenvPath "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
  throw "Virtual environment Python was not created: $venvPython"
}

& $venvPython -m pip install "contamxpy==$Version"
@'
import importlib.metadata
import contamxpy
print("OK: contamxpy", importlib.metadata.version("contamxpy"))
print("OK: module", contamxpy.__file__)
'@ | & $venvPython -

Write-Host "Set CONTAMXPY_PYTHON to override the MCP Python path if needed:"
Write-Host "`$env:CONTAMXPY_PYTHON = '$venvPython'"
