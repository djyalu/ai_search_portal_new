# Example: call the demo aggregator (PowerShell)
$body = @{ prompt = "한국의 수도는 어디인가요?"; simulate = $true } | ConvertTo-Json
$url = 'http://localhost:4000/aggregate'
Write-Host "POST $url`nBody:" $body
$resp = Invoke-RestMethod -Method Post -Uri $url -Body $body -ContentType 'application/json'
Write-Host "Response:`n" ($resp | ConvertTo-Json -Depth 5)
