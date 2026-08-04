[CmdletBinding()]
param(
  [string]$ManifestPath = "src-tauri/Cargo.toml",
  [string]$TargetTriple = "x86_64-pc-windows-msvc",
  [switch]$NoFetch
)

$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath -ErrorAction Stop).Path
$manifestDirectory = Split-Path -Parent $resolvedManifest

function Invoke-CargoJson {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    $output = & cargo @Arguments | Out-String
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($exitCode -ne 0 -and [string]::IsNullOrWhiteSpace($output)) {
    throw "cargo $($Arguments -join ' ') failed with exit code $exitCode."
  }

  try {
    return $output | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "cargo $($Arguments -join ' ') returned invalid JSON: $($_.Exception.Message)"
  }
}

function Get-PackageKey {
  param(
    [Parameter(Mandatory = $true)]
    $Package
  )

  return "$($Package.name)|$($Package.version)|$($Package.source)"
}

function Get-AuditFindings {
  param(
    $Section
  )

  if ($null -eq $Section) {
    return @()
  }

  $findings = [System.Collections.Generic.List[object]]::new()
  foreach ($property in @($Section.PSObject.Properties)) {
    foreach ($finding in @($property.Value)) {
      if ($null -ne $finding) {
        $findings.Add($finding)
      }
    }
  }
  return $findings.ToArray()
}

$metadata = Invoke-CargoJson `
  -Arguments @("metadata", "--locked", "--format-version", "1", "--filter-platform", $TargetTriple) `
  -WorkingDirectory $manifestDirectory

$packagesById = @{}
foreach ($package in @($metadata.packages)) {
  $packagesById[$package.id] = $package
}

$targetPackageKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($node in @($metadata.resolve.nodes)) {
  $package = $packagesById[$node.id]
  if ($null -ne $package) {
    [void]$targetPackageKeys.Add((Get-PackageKey $package))
  }
}

$auditArguments = @("audit", "--format", "json")
if ($NoFetch) {
  $auditArguments += "--no-fetch"
}
$auditReport = Invoke-CargoJson -Arguments $auditArguments -WorkingDirectory $manifestDirectory

$findings = @(
  (Get-AuditFindings $auditReport.warnings)
  if ($null -ne $auditReport.vulnerabilities) {
    @($auditReport.vulnerabilities.list)
  }
)
$targetFindings = @($findings | Where-Object {
    $null -ne $_.package -and $targetPackageKeys.Contains((Get-PackageKey $_.package))
  })
$nonTargetFindings = @($findings | Where-Object {
    $null -eq $_.package -or -not $targetPackageKeys.Contains((Get-PackageKey $_.package))
  })

Write-Host "RustSec target audit: $TargetTriple"
Write-Host "Resolved packages for target: $($targetPackageKeys.Count)"
Write-Host "Findings in target dependency graph: $($targetFindings.Count)"
Write-Host "Findings outside target dependency graph: $($nonTargetFindings.Count)"

foreach ($finding in $nonTargetFindings) {
  $package = $finding.package
  $packageLabel = if ($null -eq $package) { "unknown package" } else { "$($package.name) $($package.version)" }
  Write-Warning "Non-target RustSec finding: $($finding.advisory.id) [$($finding.kind)] $packageLabel"
}

if ($targetFindings.Count -gt 0) {
  foreach ($finding in $targetFindings) {
    Write-Error "Target RustSec finding: $($finding.advisory.id) [$($finding.kind)] $($finding.package.name) $($finding.package.version)"
  }
  throw "$($targetFindings.Count) RustSec finding(s) affect the $TargetTriple dependency graph."
}

Write-Host "RustSec target audit passed."
