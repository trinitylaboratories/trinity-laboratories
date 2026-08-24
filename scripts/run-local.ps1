[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidatePattern('^[A-Za-z0-9:_-]+$')]
    [string]$Script,

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArguments = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return [System.IO.Path]::GetFullPath($Path).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Get-SubstMappings {
    $mappings = @{}
    $lines = & "$env:SystemRoot\System32\subst.exe"
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect subst drive mappings.'
    }

    foreach ($line in $lines) {
        if ($line -match '^([A-Za-z]):\\: => (.+)$') {
            $mappings[$Matches[1].ToUpperInvariant()] = Get-NormalizedPath -Path $Matches[2]
        }
    }

    return $mappings
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    return [string]::Equals(
        (Get-NormalizedPath -Path $Left),
        (Get-NormalizedPath -Path $Right),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'scripts/run-local.ps1 is only needed on Windows. Run npm directly on this platform.'
}

foreach ($argument in $ScriptArguments) {
    if ($argument -match "[`0`r`n]") {
        throw 'Command arguments must not contain control characters.'
    }
}

$projectRoot = Get-NormalizedPath -Path (Join-Path $PSScriptRoot '..')
$npmPathAtSource = Join-Path $projectRoot '.tools\node\npm.cmd'
$packagePath = Join-Path $projectRoot 'package.json'
$junctionPath = Join-Path $projectRoot '.tools\workspace-root'

if (-not (Test-Path -LiteralPath $npmPathAtSource -PathType Leaf)) {
    throw 'Missing .tools/node/npm.cmd. Dot-source scripts/bootstrap.ps1 first.'
}
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw 'Missing package.json at the resolved project root.'
}

$manifest = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($manifest.scripts.PSObject.Properties.Name -notcontains $Script) {
    throw "Unknown npm script '$Script'."
}
if (Test-Path -LiteralPath $junctionPath) {
    throw "Refusing to replace unexpected existing path: $junctionPath"
}

if (
    $projectRoot -match '[\\/]Dropbox[\\/]' -and
    $Script -match '^(?:build(?::|$)|cf:build$|deploy(?::|$)|test(?::e2e)?$|validate$)'
) {
    $distPath = Join-Path $projectRoot 'dist'
    if (-not (Test-Path -LiteralPath $distPath)) {
        New-Item -ItemType Directory -Path $distPath | Out-Null
    }
    try {
        Set-Content -LiteralPath $distPath -Stream 'com.dropbox.ignored' -Value 1 -ErrorAction Stop
    }
    catch {
        Write-Warning (
            "Could not mark $distPath as Dropbox-ignored. " +
            'A concurrent sync may briefly lock generated build files. ' +
            $_.Exception.Message
        )
    }
}

$substMappings = Get-SubstMappings
$driveLetter = @('T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'S', 'R') | Where-Object {
    -not $substMappings.ContainsKey($_) -and
    -not (Get-PSDrive -Name $_ -PSProvider FileSystem -ErrorAction SilentlyContinue)
} | Select-Object -First 1

if (-not $driveLetter) {
    throw 'No unused drive letter is available for the safe local build alias.'
}

$driveName = "${driveLetter}:"
$createdJunction = $false
$createdSubst = $false
$childExitCode = 1
$previousNodeOptions = [System.Environment]::GetEnvironmentVariable('NODE_OPTIONS', 'Process')
$previousAstroConfig = [System.Environment]::GetEnvironmentVariable(
    'TRINITY_ASTRO_CONFIG_FILE',
    'Process'
)
$previousProjectRoot = [System.Environment]::GetEnvironmentVariable('TRINITY_PROJECT_ROOT', 'Process')
$previousBuildStage = [System.Environment]::GetEnvironmentVariable(
    'TRINITY_LOCAL_BUILD_STAGE',
    'Process'
)
$previousProcessPath = [System.Environment]::GetEnvironmentVariable('Path', 'Process')
$locationPushed = $false

try {
    $created = New-Item -ItemType Junction -Path $junctionPath -Target $projectRoot
    $createdJunction = $true
    $junction = Get-Item -LiteralPath $junctionPath -Force
    $junctionTarget = [string]($junction.Target | Select-Object -First 1)
    if ($junction.LinkType -ne 'Junction' -or -not (Test-SamePath $junctionTarget $projectRoot)) {
        throw 'Created workspace junction failed target verification.'
    }

    & "$env:SystemRoot\System32\subst.exe" $driveName $projectRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the $driveName build alias."
    }
    $createdSubst = $true

    $verifiedMappings = Get-SubstMappings
    if (
        -not $verifiedMappings.ContainsKey($driveLetter) -or
        -not (Test-SamePath $verifiedMappings[$driveLetter] $projectRoot)
    ) {
        throw "The $driveName build alias failed target verification."
    }

    $cleanRoot = "$driveName\.tools\workspace-root"
    $npmPath = Join-Path $cleanRoot '.tools\node\npm.cmd'
    if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) {
        throw 'The verified clean-path alias cannot reach project-local npm.'
    }
    $childNodeDirectory = [System.IO.Path]::GetDirectoryName($npmPath)

    $nodeFlags = '--preserve-symlinks --preserve-symlinks-main'
    $childNodeOptions = if ([string]::IsNullOrWhiteSpace($previousNodeOptions)) {
        $nodeFlags
    } else {
        "$previousNodeOptions $nodeFlags"
    }
    [System.Environment]::SetEnvironmentVariable('NODE_OPTIONS', $childNodeOptions, 'Process')
    [System.Environment]::SetEnvironmentVariable(
        'TRINITY_ASTRO_CONFIG_FILE',
        '..\..\astro.config.mjs',
        'Process'
    )
    [System.Environment]::SetEnvironmentVariable('TRINITY_PROJECT_ROOT', $projectRoot, 'Process')
    [System.Environment]::SetEnvironmentVariable(
        'TRINITY_LOCAL_BUILD_STAGE',
        '.tools/build-dist',
        'Process'
    )
    [System.Environment]::SetEnvironmentVariable(
        'Path',
        "$childNodeDirectory;$previousProcessPath",
        'Process'
    )

    $npmArguments = @('run', $Script)
    if ($ScriptArguments.Count -gt 0) {
        $npmArguments += '--'
        $npmArguments += $ScriptArguments
    }

    Push-Location -LiteralPath $cleanRoot
    $locationPushed = $true
    & $npmPath @npmArguments
    $childExitCode = $LASTEXITCODE
} finally {
    if ($locationPushed) {
        Pop-Location
    }
    [System.Environment]::SetEnvironmentVariable('NODE_OPTIONS', $previousNodeOptions, 'Process')
    [System.Environment]::SetEnvironmentVariable(
        'TRINITY_ASTRO_CONFIG_FILE',
        $previousAstroConfig,
        'Process'
    )
    [System.Environment]::SetEnvironmentVariable(
        'TRINITY_PROJECT_ROOT',
        $previousProjectRoot,
        'Process'
    )
    [System.Environment]::SetEnvironmentVariable(
        'TRINITY_LOCAL_BUILD_STAGE',
        $previousBuildStage,
        'Process'
    )
    [System.Environment]::SetEnvironmentVariable('Path', $previousProcessPath, 'Process')

    if ($createdSubst) {
        $currentMappings = Get-SubstMappings
        if (
            $currentMappings.ContainsKey($driveLetter) -and
            (Test-SamePath $currentMappings[$driveLetter] $projectRoot)
        ) {
            & "$env:SystemRoot\System32\subst.exe" $driveName /D
            if ($LASTEXITCODE -ne 0) {
                Write-Error "Failed to remove the verified $driveName build alias."
            }
        } else {
            Write-Error "Refusing to remove $driveName because its mapping changed."
        }
    }

    if ($createdJunction) {
        $junction = Get-Item -LiteralPath $junctionPath -Force -ErrorAction SilentlyContinue
        $junctionTarget = if ($junction) {
            [string]($junction.Target | Select-Object -First 1)
        } else {
            ''
        }
        if (
            $junction -and
            $junction.LinkType -eq 'Junction' -and
            (Test-SamePath $junctionTarget $projectRoot)
        ) {
            [System.IO.Directory]::Delete($junctionPath, $false)
        } elseif ($junction) {
            Write-Error "Refusing to remove $junctionPath because its type or target changed."
        }
    }
}

exit $childExitCode
