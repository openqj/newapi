[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$certificatePath = $env:WINDOWS_CERTIFICATE_PATH
$certificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD
if ([string]::IsNullOrWhiteSpace($certificatePath) -or [string]::IsNullOrWhiteSpace($certificatePassword)) {
  throw "WINDOWS_CERTIFICATE_PATH and WINDOWS_CERTIFICATE_PASSWORD are required for release signing."
}
if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) {
  throw "The Windows code-signing certificate was not found."
}
if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
  throw "The signing target was not found."
}

$signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signTool) {
  $signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue
}
if (-not $signTool) {
  throw "signtool.exe is required for Windows release signing."
}

$signToolPath = if ($signTool -is [System.Management.Automation.CommandInfo]) { $signTool.Source } else { $signTool.FullName }
& $signToolPath sign /fd SHA256 /f $certificatePath /p $certificatePassword /tr "http://timestamp.digicert.com" /td SHA256 $Path
if ($LASTEXITCODE -ne 0) {
  throw "signtool.exe failed to sign the release artifact."
}
