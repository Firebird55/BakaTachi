. "$PSScriptRoot\common.ps1"

$confPath = Join-Path $script:RepoRoot "server\conf.json5"

Write-Section "Preparing Docker services"
Ensure-ComposeStack

Bootstrap-Tachi

if (-not (Test-Path $confPath)) {
	throw "Expected local config at $confPath after bootstrap."
}

$content = Get-Content $confPath -Raw

if ($content -match '"arcaea"') {
	Write-Host "Arcaea is already enabled in server/conf.json5."
} else {
	$needle = '"bms",'
	if (-not $content.Contains($needle)) {
		throw "Could not find the expected insertion point in server/conf.json5."
	}

	$updated = $content.Replace($needle, "`"bms`",`r`n`t`t`t`"arcaea`",")
	$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
	[System.IO.File]::WriteAllText($confPath, $updated, $utf8NoBom)

	Write-Success "Enabled Arcaea in server/conf.json5."
}

Write-Section "Reloading seeds"
Invoke-InDevContainer "cd /tachi/server && pnpm load-seeds"

Write-Section "Restarting backend"
Restart-BackendProcess
Wait-Url -Url $script:ServerStatusUrl

Write-Success "Arcaea is enabled locally."
