$baseUrl = 'http://localhost:7071/api'
$body = Get-Content (Join-Path $PSScriptRoot 'sample-data.json') -Raw
Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/session" -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 20