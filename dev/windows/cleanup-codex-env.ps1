. "$PSScriptRoot\common.ps1"

if (-not (Test-DockerReady)) {
	Write-Host "Docker Desktop is not running, so there is nothing to clean up."
	exit 0
}

if (Test-ContainerRunning "tachi-dev") {
	Write-Section "Stopping Tachi dev servers"
	Stop-TachiProcesses
}

Write-Section "Stopping Docker compose services"
Invoke-DockerBestEffort @("compose", "-f", $script:ComposeFile, "down", "--remove-orphans")

Write-Success "Cleanup complete."
