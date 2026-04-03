. "$PSScriptRoot\common.ps1"

Write-Section "Ensuring Docker Desktop is ready"
$null = Ensure-DockerDesktop

Write-Section "Starting Docker compose services"
Ensure-ComposeStack -Build

Bootstrap-Tachi

Write-Section "Environment ready"
Write-Host "Use start-tachi.ps1 to launch the frontend and backend."
Write-TachiEndpoints
