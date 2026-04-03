. "$PSScriptRoot\common.ps1"

if (-not (Test-DockerReady)) {
	Write-Host "Docker Desktop is not ready."
	exit 1
}

if (-not (Test-ContainerRunning "tachi-dev")) {
	Write-Host "The tachi-dev container is not running."
	exit 1
}

$command = @'
echo "[server]"
tail -n 80 /tmp/tachi-server.log 2>/dev/null || echo "No server log yet."
echo
echo "[client]"
tail -n 80 /tmp/tachi-client.log 2>/dev/null || echo "No client log yet."
'@

Invoke-InDevContainer $command
