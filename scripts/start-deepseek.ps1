# Preferred cross-platform entry: npm run dev:deepseek (Node launcher).
# This PowerShell script remains a Windows alternative via npm run dev:deepseek:ps1.

param(
  [string]$CredentialFile = "",
  [string]$HostAddress = "127.0.0.1",
  [ValidateRange(1, 65535)]
  [int]$Port = 3000,
  [ValidateSet("enabled", "disabled")]
  [string]$Thinking = "disabled",
  [ValidateSet("deepseek-v4-flash", "deepseek-v4-pro")]
  [string]$Model = "deepseek-v4-flash"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($CredentialFile)) {
  $credentialCandidate = Get-ChildItem -LiteralPath $projectRoot -File -Filter "*.txt" |
    Where-Object {
      $candidateText = Get-Content -LiteralPath $_.FullName -Raw
      $candidateText -match "(?m)^\s*Base URL\s*[:=\uFF1A]" -and
        $candidateText -match "(?m)^\s*API Key\s*[:=\uFF1A]"
    } |
    Select-Object -First 1
  if ($null -eq $credentialCandidate) {
    throw "No local .txt credential file with Base URL and API Key lines was found."
  }
  $credentialPath = $credentialCandidate.FullName
} else {
  $credentialPath = (Resolve-Path $CredentialFile).Path
}
$lines = Get-Content -LiteralPath $credentialPath |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

$baseUrlLine = $lines |
  Where-Object { $_ -match "^\s*Base URL\s*[:=\uFF1A]" } |
  Select-Object -First 1
$apiKeyLine = $lines |
  Where-Object { $_ -match "^\s*API Key\s*[:=\uFF1A]" } |
  Select-Object -First 1

$baseUrlMatch = [regex]::Match([string]$baseUrlLine, "https?://\S+")
$apiKey = ([string]$apiKeyLine -replace "^\s*API Key\s*[:=\uFF1A]\s*", "").Trim()
if (-not $baseUrlMatch.Success -or [string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Credential file must contain 'Base URL: https://...' and 'API Key: ...' lines."
}

$baseUrl = $baseUrlMatch.Value.TrimEnd("/")
$configurationPath = Join-Path $projectRoot "config\llm.example.json"
$configuration = Get-Content -LiteralPath $configurationPath -Raw |
  ConvertFrom-Json

foreach ($agent in $configuration.agents) {
  $agent.endpoint.url = "$baseUrl/chat/completions"
  $agent.endpoint.bodyTemplate.model = $Model
  $agent.endpoint.bodyTemplate.thinking = [pscustomobject]@{ type = $Thinking }
  $maxOutputTokens = if ($agent.id -eq "captain") {
    1200
  } elseif ($agent.id -eq "passenger-service") {
    500
  } else {
    700
  }
  $agent.endpoint.bodyTemplate |
    Add-Member -NotePropertyName max_tokens -NotePropertyValue $maxOutputTokens -Force
  if ($Thinking -eq "enabled") {
    $agent.endpoint.bodyTemplate |
      Add-Member -NotePropertyName reasoning_effort -NotePropertyValue "high" -Force
  } else {
    $agent.endpoint.bodyTemplate.PSObject.Properties.Remove("reasoning_effort")
  }
  $agent.endpoint |
    Add-Member -NotePropertyName requestTimeoutMs -NotePropertyValue 120000 -Force

  foreach ($secretHeader in $agent.endpoint.secretHeaders) {
    [Environment]::SetEnvironmentVariable(
      [string]$secretHeader.secretRef,
      $apiKey,
      [EnvironmentVariableTarget]::Process
    )
  }
}

$env:LLM_CONFIG_JSON = $configuration |
  ConvertTo-Json -Depth 100 -Compress
# The Cloudflare Vite runtime is an isolated Worker environment. Opt in to
# forwarding this launcher's process-local values; no dotenv file is written.
$env:CLOUDFLARE_INCLUDE_PROCESS_ENV = "true"

$endpointHost = ([uri]$baseUrl).Host
Write-Host "Far Horizon LLM: provider=$endpointHost model=$Model thinking=$Thinking fixed-slots=40"
Write-Host "Credential remains process-local; starting http://${HostAddress}:$Port"

Push-Location $projectRoot
try {
  & npm.cmd run dev -- --host $HostAddress --port $Port
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}
