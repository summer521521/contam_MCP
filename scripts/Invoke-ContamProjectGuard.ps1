param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath,

  [ValidateSet("Inspect", "InputCheck", "Run", "Clean")]
  [string]$Mode = "InputCheck",

  [ValidateSet("Leave", "NoResults", "GuiSafeResults", "FullResults")]
  [string]$ResultProfile = "Leave",

  [string]$ContamxPath = "",

  [switch]$RequireSingleProject,

  [switch]$CleanOutputs,

  [switch]$RepairEncoding,

  [int]$ExpectedZoneCount = 0,

  [int]$ExpectedPathCount = 0,

  [int]$ExpectedSourceSinkCount = 0
)

$ErrorActionPreference = "Stop"

$resultExtensions = @(
  ".sim", ".rst", ".ach", ".csm", ".xrf", ".xlog", ".srf", ".log",
  ".pfq", ".zfq", ".zcq", ".bcx", ".dcx", ".lfr"
)

function Resolve-RequiredPath([string]$PathValue, [string]$Name, [string]$PathType) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    throw "$Name is not set."
  }

  $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved.Path -PathType $PathType)) {
    throw "$Name is not a $PathType path: $PathValue"
  }

  return $resolved.Path
}

function Resolve-Contamx([string]$ExplicitPath) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    return Resolve-RequiredPath $ExplicitPath "ContamxPath" "Leaf"
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CONTAMX_PATH)) {
    return Resolve-RequiredPath $env:CONTAMX_PATH "CONTAMX_PATH" "Leaf"
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CONTAM_HOME)) {
    $candidate = Join-Path $env:CONTAM_HOME "contamx3.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CONTAM_CHINESE_HOME)) {
    $candidate = Join-Path $env:CONTAM_CHINESE_HOME "contamx3.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CONTAM_PLUGIN_ROOT)) {
    $candidate = Join-Path $env:CONTAM_PLUGIN_ROOT "contamx3.exe"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  $command = Get-Command "contamx3.exe" -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  throw "Could not resolve contamx3.exe. Set -ContamxPath, CONTAMX_PATH, CONTAM_HOME, CONTAM_CHINESE_HOME, CONTAM_PLUGIN_ROOT, or put contamx3.exe on PATH."
}

function Test-Utf8Bom([string]$PathValue) {
  $stream = [System.IO.File]::OpenRead($PathValue)
  try {
    if ($stream.Length -lt 3) {
      return $false
    }

    $bytes = New-Object byte[] 3
    [void]$stream.Read($bytes, 0, 3)
    return ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  } finally {
    $stream.Dispose()
  }
}

function Repair-Utf8Bom([string]$PathValue) {
  $text = [System.IO.File]::ReadAllText($PathValue)
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($PathValue, $text, $utf8NoBom)
}

function Get-ProjectLines([string]$PathValue) {
  return [System.Collections.Generic.List[string]]::new([string[]](Get-Content -LiteralPath $PathValue))
}

function Find-CountSection([System.Collections.Generic.List[string]]$Lines, [string]$Label) {
  $pattern = "^\s*(\d+)\s+!\s*$([Regex]::Escape($Label)):\s*$"
  for ($i = 0; $i -lt $Lines.Count; $i += 1) {
    if ($Lines[$i] -match $pattern) {
      $end = $i + 1
      while ($end -lt $Lines.Count -and $Lines[$end].Trim() -ne "-999") {
        $end += 1
      }

      return [pscustomobject]@{
        Label = $Label
        Count = [int]$Matches[1]
        HeaderIndex = $i
        EndIndex = $end
        Header = $Lines[$i].Trim()
      }
    }
  }

  return $null
}

function Set-NextLine([System.Collections.Generic.List[string]]$Lines, [string]$LabelPattern, [string]$ValueLine) {
  for ($i = 0; $i -lt $Lines.Count - 1; $i += 1) {
    if ($Lines[$i] -match $LabelPattern) {
      $Lines[$i + 1] = $ValueLine
      return
    }
  }

  throw "Could not find run-control line matching: $LabelPattern"
}

function Set-ResultProfile([string]$PathValue, [string]$Profile) {
  if ($Profile -eq "Leave") {
    return
  }

  $lines = Get-ProjectLines $PathValue

  if ($Profile -eq "NoResults") {
    Set-NextLine $lines "^!list doDlg pfsave zfsave zcsave" "   0     0      0      0      0"
    Set-NextLine $lines "^!vol ach -bw cbw exp -bw age -bw" "  0   0   0   0   0   0   0   0"
    Set-NextLine $lines "^!rzf rzm rz1 csm srf log" "  0   0   0   0   0   0"
  } elseif ($Profile -eq "GuiSafeResults") {
    Set-NextLine $lines "^!list doDlg pfsave zfsave zcsave" "   1     1      1      1      0"
    Set-NextLine $lines "^!vol ach -bw cbw exp -bw age -bw" "  0   1   0   0   0   0   0   0"
    Set-NextLine $lines "^!rzf rzm rz1 csm srf log" "  0   0   0   1   1   1"
  } elseif ($Profile -eq "FullResults") {
    Set-NextLine $lines "^!list doDlg pfsave zfsave zcsave" "   1     1      1      1      1"
    Set-NextLine $lines "^!vol ach -bw cbw exp -bw age -bw" "  0   1   0   0   0   0   0   0"
    Set-NextLine $lines "^!rzf rzm rz1 csm srf log" "  0   0   0   1   1   1"
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines($PathValue, [string[]]$lines, $utf8NoBom)
}

function Remove-ProjectOutputs([string]$PathValue) {
  $directory = Split-Path -Parent $PathValue
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($PathValue)

  Get-ChildItem -LiteralPath $directory -File |
    Where-Object {
      $_.BaseName -like "$baseName*" -and $resultExtensions -contains $_.Extension.ToLowerInvariant()
    } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

function Get-RunControl([System.Collections.Generic.List[string]]$Lines) {
  $values = [ordered]@{}
  for ($i = 0; $i -lt $Lines.Count - 1; $i += 1) {
    if ($Lines[$i] -match "^!list doDlg pfsave zfsave zcsave") {
      $values.list = $Lines[$i + 1].Trim()
    } elseif ($Lines[$i] -match "^!vol ach -bw cbw exp -bw age -bw") {
      $values.volume = $Lines[$i + 1].Trim()
    } elseif ($Lines[$i] -match "^!rzf rzm rz1 csm srf log") {
      $values.results = $Lines[$i + 1].Trim()
    }
  }

  return $values
}

function Find-LatestXLog([string]$PathValue) {
  $directory = Split-Path -Parent $PathValue
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($PathValue)
  return Get-ChildItem -LiteralPath $directory -File -Filter "$baseName*.xlog" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Quote-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-NativeCommand([string]$ExePath, [string[]]$Arguments) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ExePath
  $psi.Arguments = ($Arguments | ForEach-Object { Quote-NativeArgument ([string]$_) }) -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($block in @($stdout, $stderr)) {
    if (-not [string]::IsNullOrWhiteSpace($block)) {
      foreach ($line in ($block -split "\r?\n")) {
        if (-not [string]::IsNullOrWhiteSpace($line)) {
          $lines.Add($line) | Out-Null
        }
      }
    }
  }

  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    Lines = [string[]]$lines
  }
}

function Read-XLogSummary($XLogFile) {
  if ($null -eq $XLogFile) {
    return [ordered]@{
      path = $null
      completed = $false
      warnings = @()
      errors = @()
      notable = @()
    }
  }

  $text = Get-Content -LiteralPath $XLogFile.FullName -ErrorAction SilentlyContinue
  $warnings = @($text |
    Where-Object { $_ -match "WARNING|zones linked to only one other zone|SketchPad results not available" } |
    ForEach-Object { [string]$_ })
  $errors = @($text |
    Where-Object { $_ -match "ERROR|FATAL|terminated abnormally|PRJ read error|Bad float value" } |
    ForEach-Object { [string]$_ })
  $notable = @($text | Where-Object {
      $_ -match "Simulation completed successfully|airflow paths:|source/sinks:|time steps|Maximum air exchange rate|Minimum gage pressure"
    } | ForEach-Object { [string]$_ })

  return [ordered]@{
    path = $XLogFile.FullName
    completed = [bool]($text | Where-Object { $_ -match "Simulation completed successfully" } | Select-Object -First 1)
    warnings = $warnings
    errors = $errors
    notable = $notable
  }
}

$resolvedProject = Resolve-RequiredPath $ProjectPath "ProjectPath" "Leaf"
$projectDirectory = Split-Path -Parent $resolvedProject
$failures = New-Object System.Collections.Generic.List[string]
$recommendations = New-Object System.Collections.Generic.List[string]

if ($RequireSingleProject) {
  $projects = @(Get-ChildItem -LiteralPath $projectDirectory -File -Filter "*.prj")
  if ($projects.Count -ne 1) {
    $failures.Add("Expected exactly one .prj in project directory; found $($projects.Count).") | Out-Null
  }
}

$hasBom = Test-Utf8Bom $resolvedProject
if ($hasBom) {
  if ($RepairEncoding) {
    Repair-Utf8Bom $resolvedProject
    $recommendations.Add("Removed UTF-8 BOM from PRJ because CONTAM expects the format line at byte 0.") | Out-Null
  } else {
    $failures.Add("PRJ has a UTF-8 BOM. Re-run with -RepairEncoding or rewrite without BOM.") | Out-Null
  }
}

Set-ResultProfile $resolvedProject $ResultProfile

if ($CleanOutputs -or $Mode -eq "Clean") {
  Remove-ProjectOutputs $resolvedProject
}

$lines = Get-ProjectLines $resolvedProject
$sections = [ordered]@{}
foreach ($label in @("zones", "flow paths", "source/sinks")) {
  $section = Find-CountSection $lines $label
  if ($null -eq $section) {
    $failures.Add("Missing PRJ section: $label.") | Out-Null
  } else {
    $sections[$label] = $section.Count
  }
}

if ($ExpectedZoneCount -gt 0 -and $sections["zones"] -ne $ExpectedZoneCount) {
  $failures.Add("Zone count mismatch: expected $ExpectedZoneCount, got $($sections["zones"]).") | Out-Null
}
if ($ExpectedPathCount -gt 0 -and $sections["flow paths"] -ne $ExpectedPathCount) {
  $failures.Add("Flow path count mismatch: expected $ExpectedPathCount, got $($sections["flow paths"]).") | Out-Null
}
if ($ExpectedSourceSinkCount -gt 0 -and $sections["source/sinks"] -ne $ExpectedSourceSinkCount) {
  $failures.Add("Source/sink count mismatch: expected $ExpectedSourceSinkCount, got $($sections["source/sinks"]).") | Out-Null
}

$runControl = Get-RunControl $lines
if ($runControl.list -match "\s1\s*$") {
  $recommendations.Add("zcsave appears enabled. Use -ResultProfile GuiSafeResults for ContamW GUI result handoff unless CLI-only full outputs are required.") | Out-Null
}

$absolutePathLines = @($lines |
  Where-Object { $_ -match "[A-Za-z]:\\" } |
  Select-Object -First 5 |
  ForEach-Object { [string]$_.Trim() })
if ($absolutePathLines.Count -gt 0) {
  $recommendations.Add("PRJ appears to contain local absolute paths. Prefer relative case-local references before sharing the project with another user.") | Out-Null
}

$contamx = $null
$exitCode = $null
$stdout = @()
if ($Mode -eq "InputCheck" -or $Mode -eq "Run") {
  $contamx = Resolve-Contamx $ContamxPath
  if ($Mode -eq "InputCheck") {
    $run = Invoke-NativeCommand $contamx @($resolvedProject, "-t")
  } else {
    $run = Invoke-NativeCommand $contamx @($resolvedProject)
  }
  $stdout = @($run.Lines)
  $exitCode = $run.ExitCode
  if ($exitCode -ne 0) {
    $failures.Add("contamx3 exited with code $exitCode.") | Out-Null
  }
}

$xlogSummary = Read-XLogSummary (Find-LatestXLog $resolvedProject)
foreach ($line in $xlogSummary.warnings) {
  if ($line -match "zones linked to only one other zone") {
    $recommendations.Add("A one-link zone warning usually means hidden or missing inter-zone paths. Put real door/path icons on valid shared walls before saving/running from ContamW.") | Out-Null
  }
}
foreach ($line in $xlogSummary.errors) {
  if ($line -match "Bad float value|PRJ read error") {
    $recommendations.Add("A PRJ parse error often means section shape/description lines are wrong; inspect the named section before editing more fields.") | Out-Null
  }
}

$summary = [ordered]@{
  projectPath = $resolvedProject
  mode = $Mode
  resultProfile = $ResultProfile
  contamxPath = $contamx
  sectionCounts = $sections
  runControl = $runControl
  exitCode = $exitCode
  xlog = $xlogSummary
  commandOutputTail = @($stdout | Select-Object -Last 20)
  recommendations = @($recommendations)
  failures = @($failures)
}

$summary | ConvertTo-Json -Depth 8

if ($failures.Count -gt 0) {
  exit 1
}

exit 0
