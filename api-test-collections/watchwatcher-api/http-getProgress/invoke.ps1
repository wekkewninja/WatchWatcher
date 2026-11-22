if (-not $env:WATCHWATCHER_TOKEN) { throw 'Set WATCHWATCHER_TOKEN to a JWT from register or login first.' }
$baseUrl = 'http://localhost:7071/api'
$headers = @{ Authorization = "Bearer $env:WATCHWATCHER_TOKEN" }
Invoke-RestMethod -Method Get -Uri "$baseUrl/progress" -Headers $headers | ConvertTo-Json -Depth 20