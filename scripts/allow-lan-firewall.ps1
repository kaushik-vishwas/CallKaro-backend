# Run in PowerShell AS ADMINISTRATOR:
#   cd "C:\Users\kaush\Downloads\CALL KARO\backend"
#   powershell -ExecutionPolicy Bypass -File .\scripts\allow-lan-firewall.ps1
#
# Opens TCP 5000 on Domain/Private/Public so Expo phones on Wi‑Fi can hit the API.

$ErrorActionPreference = 'Stop'
$port = 5000
$ruleName = 'Callkaro Backend API (LAN)'

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  Remove-NetFirewallRule -DisplayName $ruleName
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort $port `
  -Profile Any `
  -Description 'Allow any LAN device to reach Callkaro API (Expo / phones)' | Out-Null

Write-Host "OK: firewall allows inbound TCP $port on all profiles ($ruleName)"
Write-Host "Test from your phone browser: http://<PC-LAN-IP>:$port/api/health"
