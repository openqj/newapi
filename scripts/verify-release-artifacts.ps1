[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BundlePath,
  [string]$ReleaseTag,
  [string]$Version
)

$ErrorActionPreference = "Stop"

if (-not [string]::IsNullOrWhiteSpace($ReleaseTag) -and [string]::IsNullOrWhiteSpace($Version)) {
  if ($ReleaseTag -notmatch '^v\d+\.\d+\.\d+$') {
    throw "ReleaseTag must have the form vX.Y.Z when filtering bundle artifacts."
  }
  $Version = $ReleaseTag.Substring(1)
}

$resolvedBundlePath = (Resolve-Path -LiteralPath $BundlePath -ErrorAction Stop).Path
$nsisPath = Join-Path $resolvedBundlePath "nsis"
$msiPath = Join-Path $resolvedBundlePath "msi"
$allNsisArtifacts = @(Get-ChildItem -LiteralPath $nsisPath -Filter "*.exe" -File -ErrorAction SilentlyContinue)
$allMsiArtifacts = @(Get-ChildItem -LiteralPath $msiPath -Filter "*.msi" -File -ErrorAction SilentlyContinue)
$nsisArtifacts = @(
  if ([string]::IsNullOrWhiteSpace($Version)) {
    $allNsisArtifacts
  } else {
    $allNsisArtifacts | Where-Object { $_.Name -like ('*_{0}_*' -f $Version) }
  }
)
$msiArtifacts = @(
  if ([string]::IsNullOrWhiteSpace($Version)) {
    $allMsiArtifacts
  } else {
    $allMsiArtifacts | Where-Object { $_.Name -like ('*_{0}_*' -f $Version) }
  }
)

if ($nsisArtifacts.Count -eq 0) {
  throw "No NSIS installer was found under $nsisPath."
}
if ($msiArtifacts.Count -eq 0) {
  throw "No MSI installer was found under $msiPath."
}

$installers = @($nsisArtifacts) + @($msiArtifacts)
foreach ($installer in $installers) {
  $signature = Get-AuthenticodeSignature -FilePath $installer.FullName
  if ($signature.Status -ne "Valid") {
    throw "Invalid Authenticode signature for $($installer.Name): $($signature.Status)."
  }
  Write-Host "Authenticode valid: $($installer.Name)"
}

if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
  Write-Host "Local installer checks passed; release asset checks were skipped."
  exit 0
}

if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required to verify release assets."
}

$release = gh release view $ReleaseTag --json assets,isDraft | ConvertFrom-Json
if (-not $release.isDraft) {
  throw "Release $ReleaseTag must remain a draft pending manual approval."
}

$assetNames = @($release.assets | ForEach-Object { $_.name })
if ($assetNames -notcontains "latest.json") {
  throw "Release $ReleaseTag is missing latest.json."
}
if (-not ($assetNames | Where-Object { $_ -match "\.sig$" })) {
  throw "Release $ReleaseTag is missing updater signature assets."
}
if (-not ($assetNames | Where-Object { $_ -match "\.exe$" })) {
  throw "Release $ReleaseTag is missing the NSIS installer asset."
}
if (-not ($assetNames | Where-Object { $_ -match "\.msi$" })) {
  throw "Release $ReleaseTag is missing the MSI installer asset."
}

Write-Host "Release asset checks passed: $ReleaseTag"
