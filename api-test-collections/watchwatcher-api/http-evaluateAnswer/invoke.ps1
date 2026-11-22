if (-not $env:WATCHWATCHER_TOKEN) { throw 'Set WATCHWATCHER_TOKEN to a JWT from register or login first.' }
$baseUrl = 'http://localhost:7071/api'
$headers = @{ Authorization = "Bearer $env:WATCHWATCHER_TOKEN" }
$body = Get-Content (Join-Path $PSScriptRoot 'sample-data.json') -Raw
Invoke-RestMethod -Method Post -Uri "$baseUrl/exam/evaluate" -Headers $headers -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 20