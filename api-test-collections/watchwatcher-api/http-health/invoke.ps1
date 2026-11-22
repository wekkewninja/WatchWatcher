$baseUrl = 'http://localhost:7071/api'
Invoke-RestMethod -Method Get -Uri "$baseUrl/health" | ConvertTo-Json -Depth 20