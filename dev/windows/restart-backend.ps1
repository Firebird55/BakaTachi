. "$PSScriptRoot\common.ps1"

Write-Section "Preparing Docker services"
Ensure-ComposeStack

Bootstrap-Tachi

Write-Section "Restarting backend"
Restart-BackendProcess
Wait-Url -Url $script:ServerStatusUrl

Write-Success "Backend restarted successfully."
Write-Host "Status endpoint: $script:ServerStatusUrl"
