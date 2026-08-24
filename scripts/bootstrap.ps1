[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '24.19.0',

    [ValidateSet('x64', 'arm64')]
    [string]$Architecture = 'x64',

    [switch]$Repair
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsRoot = Join-Path $projectRoot '.tools'
$nodeModulesRoot = Join-Path $projectRoot 'node_modules'
$nodeInstallDir = Join-Path $toolsRoot 'node'
$nodeExecutable = Join-Path $nodeInstallDir 'node.exe'
$npmExecutable = Join-Path $nodeInstallDir 'npm.cmd'
$nodeFolderName = "node-v$Version-win-$Architecture"

function Assert-ProjectLocalPath {
    param(
        [Parameter(Mandatory)]
        [string]$Candidate
    )

    $resolvedCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $projectPrefix = $projectRoot.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar

    if (-not $resolvedCandidate.StartsWith(
            $projectPrefix,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to use a path outside the project: $resolvedCandidate"
    }
}

function Assert-ExactNodeInstallPath {
    param(
        [Parameter(Mandatory)]
        [string]$Candidate
    )

    $resolvedCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $expectedCandidate = [System.IO.Path]::GetFullPath((Join-Path $toolsRoot 'node'))
    Assert-ProjectLocalPath -Candidate $resolvedCandidate

    if (-not $resolvedCandidate.Equals(
            $expectedCandidate,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to replace any runtime path except $expectedCandidate. Received: $resolvedCandidate"
    }
}

function Assert-UniqueStagingPath {
    param(
        [Parameter(Mandatory)]
        [string]$Candidate,

        [Parameter(Mandatory)]
        [string]$StagingParent
    )

    $resolvedCandidate = [System.IO.Path]::GetFullPath($Candidate)
    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $resolvedCandidate))
    $expectedParent = [System.IO.Path]::GetFullPath($StagingParent)
    Assert-ProjectLocalPath -Candidate $resolvedCandidate

    if (-not $resolvedParent.Equals(
            $expectedParent,
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw "Refusing to clean an unexpected staging path: $resolvedCandidate"
    }
}

function Add-NodeToProcessPath {
    $pathSeparator = [System.IO.Path]::PathSeparator
    $currentEntries = @($env:Path -split [System.Text.RegularExpressions.Regex]::Escape($pathSeparator))
    if ($currentEntries -notcontains $nodeInstallDir) {
        $env:Path = "$nodeInstallDir$pathSeparator$env:Path"
    }
}

function Set-DropboxIgnoredIfSupported {
    param(
        [Parameter(Mandatory)]
        [string]$Candidate
    )

    if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
        return
    }

    try {
        # Dropbox documents this alternate data stream as the Windows mechanism for
        # keeping generated folders local while leaving their parent project synced.
        Set-Content -LiteralPath $Candidate -Stream 'com.dropbox.ignored' -Value 1 -ErrorAction Stop
    }
    catch {
        Write-Warning (
            "Could not mark $Candidate as Dropbox-ignored. " +
            'The project remains usable, but Dropbox may try to sync generated dependencies. ' +
            $_.Exception.Message
        )
    }
}

function Get-NodeInstallationInfo {
    param(
        [Parameter(Mandatory)]
        [string]$InstallDirectory
    )

    $candidateNode = Join-Path $InstallDirectory 'node.exe'
    $candidateNpm = Join-Path $InstallDirectory 'npm.cmd'
    $reportedNodeVersion = ''
    $reportedNpmVersion = ''
    $nodeExitCode = 1
    $npmExitCode = 1

    if (Test-Path -LiteralPath $candidateNode -PathType Leaf) {
        $reportedNodeVersion = ((& $candidateNode --version 2>$null) -join '').Trim()
        $nodeExitCode = $LASTEXITCODE
    }
    if (Test-Path -LiteralPath $candidateNpm -PathType Leaf) {
        $reportedNpmVersion = ((& $candidateNpm --version 2>$null) -join '').Trim()
        $npmExitCode = $LASTEXITCODE
    }

    [pscustomobject]@{
        IsValid = (
            $nodeExitCode -eq 0 -and
            $npmExitCode -eq 0 -and
            $reportedNodeVersion -eq "v$Version" -and
            [bool]$reportedNpmVersion
        )
        NodeVersion = $reportedNodeVersion
        NpmVersion = $reportedNpmVersion
    }
}

function Remove-VerifiedDirectoryWithRetry {
    param(
        [Parameter(Mandatory)]
        [string]$Candidate,

        [ValidateRange(1, 20)]
        [int]$Attempts = 10
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $Candidate -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            if ($attempt -eq $Attempts) {
                throw
            }
            Start-Sleep -Milliseconds 500
        }
    }
}

Assert-ProjectLocalPath -Candidate $toolsRoot
Assert-ProjectLocalPath -Candidate $nodeModulesRoot
Assert-ExactNodeInstallPath -Candidate $nodeInstallDir

New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $nodeModulesRoot -Force | Out-Null
Set-DropboxIgnoredIfSupported -Candidate $toolsRoot
Set-DropboxIgnoredIfSupported -Candidate $nodeModulesRoot

if (Test-Path -LiteralPath $nodeInstallDir) {
    $installed = Get-NodeInstallationInfo -InstallDirectory $nodeInstallDir
    if ($installed.IsValid) {
        Add-NodeToProcessPath
        Write-Output "Node $($installed.NodeVersion) is already available at $nodeInstallDir"
        Write-Output "npm $($installed.NpmVersion)"
        return
    }

    if (-not $Repair) {
        throw (
            "The project-local Node installation is incomplete or has the wrong version: " +
            "$nodeInstallDir. Re-run this script with -Repair to replace only that generated folder."
        )
    }

    Assert-ExactNodeInstallPath -Candidate $nodeInstallDir
    Write-Output "Removing the incomplete project-local Node installation at $nodeInstallDir..."
    Remove-VerifiedDirectoryWithRetry -Candidate $nodeInstallDir
}

$downloadRoot = Join-Path $toolsRoot 'downloads'
$stagingParent = Join-Path $toolsRoot 'staging'
Assert-ProjectLocalPath -Candidate $downloadRoot
Assert-ProjectLocalPath -Candidate $stagingParent
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stagingParent -Force | Out-Null

$archiveName = "$nodeFolderName.zip"
$archivePath = Join-Path $downloadRoot $archiveName
$checksumPath = Join-Path $downloadRoot "SHASUMS256-v$Version.txt"
$releaseBaseUrl = "https://nodejs.org/dist/v$Version"
$requestId = [guid]::NewGuid().ToString('N')
$archivePartial = "$archivePath.$requestId.partial"
$checksumPartial = "$checksumPath.$requestId.partial"
$stagingRoot = Join-Path $stagingParent $requestId
Assert-UniqueStagingPath -Candidate $stagingRoot -StagingParent $stagingParent

try {
    Write-Output "Downloading official Node.js v$Version for Windows $Architecture..."
    Invoke-WebRequest -Uri "$releaseBaseUrl/$archiveName" -OutFile $archivePartial -UseBasicParsing
    Invoke-WebRequest -Uri "$releaseBaseUrl/SHASUMS256.txt" -OutFile $checksumPartial -UseBasicParsing

    Move-Item -LiteralPath $archivePartial -Destination $archivePath -Force
    Move-Item -LiteralPath $checksumPartial -Destination $checksumPath -Force

    $checksumPattern = '^[a-fA-F0-9]{64}\s{2}' + [regex]::Escape($archiveName) + '$'
    $checksumEntries = @(Select-String -LiteralPath $checksumPath -Pattern $checksumPattern)
    if ($checksumEntries.Count -ne 1) {
        throw "Could not find a unique checksum for $archiveName in $checksumPath."
    }

    $expectedHash = ($checksumEntries[0].Line -split '\s+')[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "Checksum verification failed for $archiveName. Expected $expectedHash; received $actualHash."
    }

    Write-Output "SHA-256 verified: $actualHash"

    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingRoot
    $stagedInstallDir = Join-Path $stagingRoot $nodeFolderName
    Assert-ProjectLocalPath -Candidate $stagedInstallDir

    $staged = Get-NodeInstallationInfo -InstallDirectory $stagedInstallDir
    if (-not $staged.IsValid) {
        throw "The staged Node archive did not verify as Node v$Version with a working npm command."
    }
    if (Test-Path -LiteralPath $nodeInstallDir) {
        throw "Refusing to overwrite an unexpected runtime directory at $nodeInstallDir."
    }

    # Copy from the verified staging tree instead of renaming it. Dropbox and antivirus
    # scanners can hold transient read handles that permit copying but block a directory move.
    Copy-Item -LiteralPath $stagedInstallDir -Destination $nodeInstallDir -Recurse
    $installed = Get-NodeInstallationInfo -InstallDirectory $nodeInstallDir
    if (-not $installed.IsValid) {
        throw "Node installation did not verify after placement at $nodeInstallDir."
    }
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        try {
            Assert-UniqueStagingPath -Candidate $stagingRoot -StagingParent $stagingParent
            Remove-VerifiedDirectoryWithRetry -Candidate $stagingRoot
        }
        catch {
            Write-Warning "Could not remove verified staging directory $stagingRoot. $($_.Exception.Message)"
        }
    }
}

Add-NodeToProcessPath
Write-Output "Installed Node $($installed.NodeVersion) at $nodeInstallDir"
Write-Output "npm $($installed.NpmVersion)"
Write-Output 'The project-local Node directory was prepended to PATH for this PowerShell process.'
