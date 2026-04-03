Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:ComposeFile = Join-Path $script:RepoRoot "docker-compose-dev.yml"
$script:ClientUrl = "http://127.0.0.1:3000/"
$script:ServerStatusUrl = "https://127.0.0.1:8080/api/v1/status"
$script:ServerConfigUrl = "https://127.0.0.1:8080/api/v1/config"

function Write-Section {
	param([string]$Message)

	Write-Host ""
	Write-Host "== $Message ==" -ForegroundColor Cyan
}

function Write-Success {
	param([string]$Message)

	Write-Host $Message -ForegroundColor Green
}

function Get-DockerCliPath {
	$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
	if ($dockerCommand) {
		return $dockerCommand.Source
	}

	$fallback = Join-Path $Env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"
	if (Test-Path $fallback) {
		return $fallback
	}

	throw "Docker CLI was not found. Install Docker Desktop first."
}

function Test-DockerReady {
	try {
		$docker = Get-DockerCliPath
		& $docker info *> $null
		return ($LASTEXITCODE -eq 0)
	} catch {
		return $false
	}
}

function Ensure-DockerDesktop {
	$docker = Get-DockerCliPath

	if (Test-DockerReady) {
		return $docker
	}

	$desktop = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
	if (-not (Test-Path $desktop)) {
		throw "Docker Desktop is installed incorrectly or missing. Expected $desktop."
	}

	Write-Host "Starting Docker Desktop..."
	Start-Process -FilePath $desktop | Out-Null

	$deadline = (Get-Date).AddMinutes(3)
	while ((Get-Date) -lt $deadline) {
		if (Test-DockerReady) {
			return $docker
		}

		Start-Sleep -Seconds 3
	}

	throw "Docker Desktop did not become ready within 3 minutes."
}

function Invoke-Docker {
	param([string[]]$Arguments)

	$docker = Ensure-DockerDesktop
	& $docker @Arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Docker command failed: docker $($Arguments -join ' ')"
	}
}

function Invoke-DockerBestEffort {
	param([string[]]$Arguments)

	$docker = Ensure-DockerDesktop
	& $docker @Arguments
}

function Ensure-ComposeStack {
	param([switch]$Build)

	$args = @("compose", "-f", $script:ComposeFile, "up", "-d")
	if ($Build) {
		$args += "--build"
	}

	Invoke-Docker $args
	Wait-DevContainerReady
}

function Test-ContainerRunning {
	param([string]$ContainerName)

	try {
		$docker = Ensure-DockerDesktop
		$result = & $docker inspect -f "{{.State.Running}}" $ContainerName 2>$null
		return (($LASTEXITCODE -eq 0) -and (($result | Select-Object -First 1).Trim() -eq "true"))
	} catch {
		return $false
	}
}

function Wait-DevContainerReady {
	$docker = Ensure-DockerDesktop
	$deadline = (Get-Date).AddMinutes(2)

	while ((Get-Date) -lt $deadline) {
		if (Test-ContainerRunning "tachi-dev") {
			& $docker exec tachi-dev bash -lc "true" *> $null
			if ($LASTEXITCODE -eq 0) {
				return
			}
		}

		Start-Sleep -Seconds 2
	}

	throw "The tachi-dev container did not become ready in time."
}

function Invoke-InDevContainer {
	param([string]$Command)

	if (-not (Test-ContainerRunning "tachi-dev")) {
		Ensure-ComposeStack
	}

	Wait-DevContainerReady

	Invoke-Docker @("exec", "tachi-dev", "bash", "-lc", $Command)
}

function Invoke-InDevContainerDetached {
	param([string]$Command)

	if (-not (Test-ContainerRunning "tachi-dev")) {
		Ensure-ComposeStack
	}

	Wait-DevContainerReady

	Invoke-Docker @("exec", "-d", "tachi-dev", "bash", "-lc", $Command)
}

function Bootstrap-Tachi {
	$bootstrapMarker = Invoke-InDevContainer "if [ -f /tachi/BOOTSTRAP_OK ]; then echo yes; else echo no; fi"
	if (($bootstrapMarker | Select-Object -First 1).Trim() -eq "yes") {
		Write-Host "Bootstrap already present."
		return
	}

	Write-Section "Bootstrapping Tachi"
	Invoke-InDevContainer "cd /tachi && ./dev/bootstrap.sh"
}

function Stop-TachiProcesses {
$command = @'
set +e
if [ -f /tmp/tachi-server.pid ]; then
	xargs -r kill < /tmp/tachi-server.pid 2>/dev/null || true
	rm -f /tmp/tachi-server.pid
fi
if [ -f /tmp/tachi-client.pid ]; then
	xargs -r kill < /tmp/tachi-client.pid 2>/dev/null || true
	rm -f /tmp/tachi-client.pid
fi
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /ts-node \.\/src\/main\.ts/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /\/ts-node\/dist\/bin\.js \.\/src\/main\.ts/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /\/usr\/local\/bin\/pnpm dev/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /nodemon\/bin\/nodemon\.js/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /vite\/bin\/vite\.js/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "sh" && ($0 ~ /NODE_PATH=js\/ nodemon/ || $0 ~ /ts-node \.\/src\/main\.ts/) { print $1 }' | xargs -r kill -9 2>/dev/null || true
sleep 2
'@

	Invoke-InDevContainer $command
}

function Start-TachiProcesses {
	$serverCommand = @'
set -e
cd /tachi/server
nohup pnpm dev > /tmp/tachi-server.log 2>&1 &
echo $! > /tmp/tachi-server.pid
'@

	$clientCommand = @'
set -e
cd /tachi/client
nohup pnpm exec vite --host 0.0.0.0 --port 3000 --strictPort > /tmp/tachi-client.log 2>&1 &
echo $! > /tmp/tachi-client.pid
'@

	Invoke-InDevContainer $serverCommand
	Invoke-InDevContainer $clientCommand
}

function Restart-BackendProcess {
$stopCommand = @'
set +e
if [ -f /tmp/tachi-server.pid ]; then
	xargs -r kill < /tmp/tachi-server.pid 2>/dev/null || true
	rm -f /tmp/tachi-server.pid
fi
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /ts-node \.\/src\/main\.ts/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /\/ts-node\/dist\/bin\.js \.\/src\/main\.ts/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /\/usr\/local\/bin\/pnpm dev/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "node" && $0 ~ /nodemon\/bin\/nodemon\.js/ { print $1 }' | xargs -r kill -9 2>/dev/null || true
ps -eo pid=,cmd= | awk '$2 == "sh" && ($0 ~ /NODE_PATH=js\/ nodemon/ || $0 ~ /ts-node \.\/src\/main\.ts/) { print $1 }' | xargs -r kill -9 2>/dev/null || true
sleep 2
'@

	$startCommand = @'
set -e
cd /tachi/server
nohup pnpm dev > /tmp/tachi-server.log 2>&1 &
echo $! > /tmp/tachi-server.pid
'@

	Invoke-InDevContainer $stopCommand
	Invoke-InDevContainer $startCommand
}

function Wait-Url {
	param(
		[string]$Url,
		[int]$TimeoutSeconds = 180
	)

	$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
	while ((Get-Date) -lt $deadline) {
		if ($Url.StartsWith("https://")) {
			curl.exe -ksf $Url *> $null
		} else {
			curl.exe -sf $Url *> $null
		}

		if ($LASTEXITCODE -eq 0) {
			return
		}

		Start-Sleep -Seconds 2
	}

	throw "Timed out waiting for $Url"
}

function Get-UrlText {
	param([string]$Url)

	if ($Url.StartsWith("https://")) {
		return (curl.exe -ks $Url)
	}

	return (curl.exe -s $Url)
}

function Write-TachiEndpoints {
	Write-Success "Frontend: $script:ClientUrl"
	Write-Success "Backend:  https://127.0.0.1:8080/"
}
