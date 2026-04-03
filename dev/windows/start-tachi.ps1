. "$PSScriptRoot\common.ps1"

Write-Section "Preparing Docker services"
Ensure-ComposeStack

Bootstrap-Tachi

Write-Section "Restarting Tachi dev servers"
Stop-TachiProcesses
Start-TachiProcesses

Write-Section "Waiting for Tachi to come online"
Wait-Url -Url $script:ServerStatusUrl
Wait-Url -Url $script:ClientUrl

Write-Section "Tachi is running"
Write-TachiEndpoints
