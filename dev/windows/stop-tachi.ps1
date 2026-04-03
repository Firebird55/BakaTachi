. "$PSScriptRoot\common.ps1"

if (-not (Test-DockerReady)) {
	Write-Host "Docker Desktop is not running, so there is nothing to stop."
	exit 0
}

if (-not (Test-ContainerRunning "tachi-dev")) {
	Write-Host "The tachi-dev container is not running."
	exit 0
}

Write-Section "Stopping Tachi dev servers"
Stop-TachiProcesses

Write-Success "Stopped the frontend and backend processes inside tachi-dev."
