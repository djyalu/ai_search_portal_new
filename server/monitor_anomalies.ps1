param(
  [string]$LogPath = "server.log",
  [string]$AlertPath = "monitor_alerts.log",
  [int]$IntervalSec = 5,
  [int]$StaleSec = 120,
  [int]$Port = 3000,
  [int]$ErrorWindowSec = 60,
  [int]$ErrorBurstThreshold = 5,
  [switch]$Once
)

$ErrorActionPreference = "SilentlyContinue"

$ErrorPatterns = @(
  "ERROR",
  "Analysis failed",
  "analysis-error",
  "send_failed",
  "Signed out",
  "short_output",
  "noisy_output",
  "Reasoning Timeout",
  "dispatch_failed",
  "collect.*failed",
  "worker .* failed",
  "timeout"
)

$WarnPatterns = @(
  "agent_status",
  "Retrying",
  "Wait for .* timed out",
  "signed out"
)

$state = [ordered]@{
  LastPosition = 0L
  LastLogTime = $null
  ErrorTimes = New-Object System.Collections.Generic.List[datetime]
}

function Write-Alert([string]$message) {
  $line = "{0} [ALERT] {1}" -f (Get-Date).ToString("s"), $message
  Write-Host $line
  Add-Content -Path $AlertPath -Value $line
}

function Read-NewLines([string]$path) {
  if (-not (Test-Path $path)) { return @() }
  $fs = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    if ($state.LastPosition -gt $fs.Length) { $state.LastPosition = 0 }
    $fs.Seek($state.LastPosition, [System.IO.SeekOrigin]::Begin) | Out-Null
    $sr = New-Object System.IO.StreamReader($fs)
    $text = $sr.ReadToEnd()
    $state.LastPosition = $fs.Position
    if ([string]::IsNullOrWhiteSpace($text)) { return @() }
    return ($text -split "`r?`n")
  } finally {
    $fs.Close()
  }
}

function Track-Errors([datetime]$now) {
  $cutoff = $now.AddSeconds(-$ErrorWindowSec)
  $state.ErrorTimes = [System.Collections.Generic.List[datetime]]($state.ErrorTimes | Where-Object { $_ -gt $cutoff })
  if ($state.ErrorTimes.Count -ge $ErrorBurstThreshold) {
    Write-Alert "Error burst detected: $($state.ErrorTimes.Count) errors in last $ErrorWindowSec sec"
    $state.ErrorTimes.Clear()
  }
}

function Check-ProcessAndPort {
  $nodeCount = (Get-Process -Name node | Measure-Object).Count
  if ($nodeCount -eq 0) {
    Write-Alert "No node process detected"
  }

  $listening = Get-NetTCPConnection -LocalPort $Port -State Listen
  if (-not $listening) {
    Write-Alert "Port $Port is not listening"
  }
}

function Check-StaleLog {
  if (-not $state.LastLogTime) { return }
  $age = (Get-Date) - $state.LastLogTime
  if ($age.TotalSeconds -ge $StaleSec) {
    Write-Alert "Log is stale: last entry $([int]$age.TotalSeconds)s ago"
  }
}

do {
  Check-ProcessAndPort

  $now = Get-Date
  $lines = Read-NewLines -path $LogPath
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    # Parse ISO timestamp at line head if present
    if ($line -match "^(?<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})") {
      $state.LastLogTime = [datetime]$Matches.ts
    } else {
      $state.LastLogTime = $now
    }

    foreach ($p in $ErrorPatterns) {
      if ($line -match $p) {
        $state.ErrorTimes.Add($now)
        Write-Alert "Error pattern matched: '$p' | $line"
        break
      }
    }

    foreach ($p in $WarnPatterns) {
      if ($line -match $p) {
        Write-Host ("{0} [WARN] {1}" -f $now.ToString("s"), $line)
        break
      }
    }
  }

  Track-Errors -now $now
  Check-StaleLog

  if (-not $Once) { Start-Sleep -Seconds $IntervalSec }
} while (-not $Once)

