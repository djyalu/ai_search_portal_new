param(
  [int]$Tail = 200,
  [int]$Port = 3000,
  [string]$LogPath = "server.log"
)

$ErrorActionPreference = "SilentlyContinue"

function Show-Header($title) {
  Write-Host "`n==== $title ===="
}

function Show-ServerLog {
  Show-Header "Live server.log (tail $Tail)"
  if (Test-Path $LogPath) {
    Get-Content -Path $LogPath -Tail $Tail -Wait
  } else {
    Write-Host "Log file not found: $LogPath"
  }
}

function Show-ProcessInfo {
  Show-Header "Node processes"
  Get-Process -Name node | Select-Object Id,ProcessName,CPU,WS,StartTime
}

function Show-PortInfo {
  Show-Header "Port $Port connections"
  Get-NetTCPConnection -LocalPort $Port | Select-Object LocalAddress,LocalPort,State,OwningProcess
}

function Show-ErrorSummary {
  Show-Header "Recent error keywords"
  if (Test-Path $LogPath) {
    Get-Content -Path $LogPath -Tail 500 | Select-String -Pattern "ERROR|Error|Dispatch|Collect|agent_status|timeout"
  } else {
    Write-Host "Log file not found: $LogPath"
  }
}

Show-ProcessInfo
Show-PortInfo
Show-ErrorSummary
Show-ServerLog
