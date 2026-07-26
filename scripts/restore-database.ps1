param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [Parameter(Mandatory = $true)][string]$DatabasePath
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $BackupPath).Path
$target = [IO.Path]::GetFullPath($DatabasePath)
if ($source -eq $target) { throw "BackupPath and DatabasePath must be different." }
if (Test-Path -LiteralPath $target) {
  $safetyCopy = "$target.before-restore.$(Get-Date -Format 'yyyyMMddHHmmss').bak"
  Copy-Item -LiteralPath $target -Destination $safetyCopy -ErrorAction Stop
  Write-Output "Current database copied to $safetyCopy"
}

# The desktop app must be closed before this command: SQLite cannot safely replace an open database file.
Copy-Item -LiteralPath $source -Destination $target -Force -ErrorAction Stop
Write-Output "Database restored. Start RelayHub and verify stations before deleting the safety copy."
