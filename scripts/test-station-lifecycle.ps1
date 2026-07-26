$ErrorActionPreference = "Stop"

function Require-Value([string]$name) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing required environment variable: $name" }
  return $value
}

function Json-Request([string]$method, [string]$uri, $headers, $body, $session) {
  $params = @{ Method = $method; Uri = $uri; Headers = $headers; ErrorAction = "Stop" }
  if ($session) { $params.WebSession = $session }
  if ($null -ne $body) { $params.ContentType = "application/json"; $params.Body = $body | ConvertTo-Json -Depth 12 -Compress }
  return Invoke-RestMethod @params
}

$subUrl = $env:RELAYHUB_E2E_SUB2_URL ?? "https://chat.178266.xyz"
$newUrl = $env:RELAYHUB_E2E_NEWAPI_URL ?? "https://sadai.cc"
$subKeyId = $null; $newKeyId = $null
try {
  $subLogin = Json-Request POST "$subUrl/api/v1/auth/login" @{} @{ email = Require-Value "RELAYHUB_E2E_SUB2_EMAIL"; password = Require-Value "RELAYHUB_E2E_SUB2_PASSWORD" } $null
  $subHeaders = @{ Authorization = "Bearer $($subLogin.data.access_token)" }
  $null = Json-Request GET "$subUrl/api/v1/user/profile" $subHeaders $null $null
  $null = Json-Request GET "$subUrl/api/v1/usage?page=1&page_size=5" $subHeaders $null $null
  $subName = "relayhub-e2e-$([guid]::NewGuid().ToString('N'))"
  $subKeyId = [string](Json-Request POST "$subUrl/api/v1/keys" $subHeaders @{ name = $subName; quota = 10; status = "active" } $null).data.id
  if (!$subKeyId) { throw "Sub2API did not return a created key ID" }
  $null = Json-Request GET "$subUrl/api/v1/keys/$subKeyId" $subHeaders $null $null
  foreach ($body in @(@{ name = "$subName-updated" }, @{ status = "inactive" }, @{ status = "active" })) {
    try { $null = Json-Request PATCH "$subUrl/api/v1/keys/$subKeyId" $subHeaders $body $null }
    catch { $null = Json-Request PUT "$subUrl/api/v1/keys/$subKeyId" $subHeaders $body $null }
  }

  $newSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $newLogin = Json-Request POST "$newUrl/api/user/login" @{} @{ username = Require-Value "RELAYHUB_E2E_NEWAPI_USERNAME"; password = Require-Value "RELAYHUB_E2E_NEWAPI_PASSWORD" } $newSession
  $newHeaders = @{ "New-Api-User" = [string]$newLogin.data.id }
  $null = Json-Request GET "$newUrl/api/user/self" $newHeaders $null $newSession
  $null = Json-Request GET "$newUrl/api/log/self?p=0&page_size=5" $newHeaders $null $newSession
  $newName = "relayhub-e2e-$([guid]::NewGuid().ToString('N'))"
  $null = Json-Request POST "$newUrl/api/token/" $newHeaders @{ name = $newName; remain_quota = 10; unlimited_quota = $false; expired_time = 0; status = 1; model_limits_enabled = $false; model_limits = ""; cross_group_retry = $false; allow_ips = "" } $newSession
  $tokens = (Json-Request GET "$newUrl/api/token/?p=0&size=100" $newHeaders $null $newSession).data.items
  $newKeyId = [string](($tokens | Where-Object name -eq $newName | Select-Object -First 1).id)
  if (!$newKeyId) { throw "NewAPI did not expose the created key in its list" }
  $token = (Json-Request GET "$newUrl/api/token/$newKeyId" $newHeaders $null $newSession).data
  $token.name = "$newName-updated"
  $null = Json-Request PUT "$newUrl/api/token/" $newHeaders $token $newSession
  $null = Json-Request PUT "$newUrl/api/token/?status_only=true" $newHeaders @{ id = $token.id; status = 2 } $newSession
  $null = Json-Request PUT "$newUrl/api/token/?status_only=true" $newHeaders @{ id = $token.id; status = 1 } $newSession
}
finally {
  if ($subKeyId) { try { $null = Json-Request DELETE "$subUrl/api/v1/keys/$subKeyId" $subHeaders $null $null } catch { Write-Error "Failed to clean up Sub2API test key" } }
  if ($newKeyId) { try { $null = Json-Request DELETE "$newUrl/api/token/$newKeyId/" $newHeaders $null $newSession } catch { Write-Error "Failed to clean up NewAPI test key" } }
}

Write-Output "Station lifecycle test passed."
