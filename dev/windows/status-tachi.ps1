. "$PSScriptRoot\common.ps1"

Write-Section "Docker"

try {
	$docker = Get-DockerCliPath
	Write-Host "Docker CLI: $docker"
} catch {
	Write-Host $_.Exception.Message
	exit 1
}

if (-not (Test-DockerReady)) {
	Write-Host "Docker Desktop is not ready."
	exit 1
}

Write-Host "Docker Desktop: ready"
Invoke-Docker @("ps", "--filter", "name=tachi-dev", "--filter", "name=mongo", "--filter", "name=redis")

Write-Section "HTTP checks"

$frontendOk = $false
$backendOk = $false

curl.exe -sf $script:ClientUrl *> $null
if ($LASTEXITCODE -eq 0) {
	$frontendOk = $true
}

curl.exe -ksf $script:ServerStatusUrl *> $null
if ($LASTEXITCODE -eq 0) {
	$backendOk = $true
}

Write-Host "Frontend: $(if ($frontendOk) { 'up' } else { 'down' })"
Write-Host "Backend:  $(if ($backendOk) { 'up' } else { 'down' })"

if ($backendOk) {
	$configText = Get-UrlText -Url $script:ServerConfigUrl
	if ($configText -match '"arcaea"') {
		Write-Host "Arcaea: enabled"
	} else {
		Write-Host "Arcaea: not enabled in live config"
	}
}
