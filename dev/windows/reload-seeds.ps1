. "$PSScriptRoot\common.ps1"

Write-Section "Preparing Docker services"
Ensure-ComposeStack

Bootstrap-Tachi

Write-Section "Reloading seeds into MongoDB"
Invoke-InDevContainer "cd /tachi/server && pnpm load-seeds"

Write-Success "Seed reload finished."
