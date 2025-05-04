# Stop on first error
$ErrorActionPreference = "Stop"

function Read-BGSecret {
    param(
        [Parameter(Mandatory=$true)]
        [string]$secretName
    )

    # Get the directory where the script is located
    $HERE = Join-Path $PWD.Path "deploy"
    $USER_CLOUDFLARE_SECRET = Join-Path $env:USERPROFILE ".cloudflare.secret"
    $REPO_CLOUDFLARE_SECRET = Join-Path $HERE "cloudflare.secret"
    
    $secretContent = $null
    $foundFile = $null

    if (Test-Path $USER_CLOUDFLARE_SECRET -PathType Leaf) {
        $secretContent = Get-Content $USER_CLOUDFLARE_SECRET
        $foundFile = "USER_CLOUDFLARE_SECRET"
    }
    elseif (Test-Path $REPO_CLOUDFLARE_SECRET -PathType Leaf) {
        $secretContent = Get-Content $REPO_CLOUDFLARE_SECRET
        $foundFile = "REPO_CLOUDFLARE_SECRET"
    }
    else {
        Write-Error "No secrets file found. Tried: $USER_CLOUDFLARE_SECRET $REPO_CLOUDFLARE_SECRET"
        return $null
    }

    # Parse the secrets file content
    $secrets = @{}
    foreach ($line in $secretContent) {
        if ($line -match '^\s*([^=]+)=(.*)$') {
            $secrets[$matches[1]] = $matches[2]
        }
    }

    if (-not $secrets.ContainsKey($secretName)) {
        Write-Error "Secret $secretName not present in secrets file ${foundFile}"
        return $null
    }

    return $secrets[$secretName]
}

function Get-BGBase {
    $HERE = Join-Path $PWD.Path "deploy"
    
    $SYSTEM_NTBG_BASE = "/etc/ntbg"  # Note: This might need adjustment for Windows
    $REPO_NTBG_BASE = Join-Path $HERE "ntbg"
    
    if (Test-Path $SYSTEM_NTBG_BASE -PathType Container) {
        return $SYSTEM_NTBG_BASE
    }
    elseif (Test-Path $REPO_NTBG_BASE -PathType Container) {
        return $REPO_NTBG_BASE
    }
    else {
        Write-Error "Unable to find ntbg base dir. Tried: $SYSTEM_NTBG_BASE $REPO_NTBG_BASE"
        return $null
    }
}

function Get-BGDirs {
    param(
        [Parameter(Mandatory=$true)]
        [string]$basePath
    )
    
    $dirs = Get-ChildItem -Path $basePath -Directory | Select-Object -ExpandProperty Name
    return ($dirs -join "|")
}

function Get-BGCheckDir {
    param(
        [Parameter(Mandatory=$true)]
        [string]$basePath,
        
        [Parameter(Mandatory=$true)]
        [string]$dirName
    )
    
    if ([string]::IsNullOrEmpty($basePath) -or [string]::IsNullOrEmpty($dirName)) {
        return $null
    }

    $fullPath = Join-Path $basePath $dirName
    if (-not (Test-Path $fullPath -PathType Container)) {
        return $null
    }

    return $dirName
}

function Get-BGCheckFile {
    param(
        [Parameter(Mandatory=$true)]
        [string]$basePath,
        
        [Parameter(Mandatory=$true)]
        [string]$fileName
    )
    
    if ([string]::IsNullOrEmpty($basePath) -or [string]::IsNullOrEmpty($fileName)) {
        return $null
    }

    $fullPath = Join-Path $basePath $fileName
    if (-not (Test-Path $fullPath -PathType Leaf)) {
        return $null
    }

    return $fileName
}

function Get-BGCheckColor {
    param(
        [Parameter(Mandatory=$true)]
        [string]$basePath,
        
        [Parameter(Mandatory=$true)]
        [string]$color
    )
    
    $validColor = switch ($color) {
        "blue"  { "blue" }
        "green" { "green" }
        default { $null }
    }

    if (-not $validColor) {
        Write-Error "Invalid color: $color"
        return $null
    }

    return $validColor
}

function Get-BGEnvs {
    $base = Get-BGBase
    if (-not $base) { 
        exit 1 
    }
    
    $envs = Get-BGDirs $base
    if (-not $envs) { 
        exit 1 
    }
    
    return $envs
}

function Get-BGColors {
    return "blue|green"
}

function Get-BGConfigDir {
    param(
        [Parameter(Mandatory=$true)]
        [string]$env,
        
        [Parameter(Mandatory=$true)]
        [string]$color
    )
    
    $base = Get-BGBase
    if (-not $base) { 
        exit 1 
    }

    $envDir = Get-BGCheckDir $base $env
    if (-not $envDir) { 
        exit 1 
    }

    $colorDir = Get-BGCheckDir $envDir $color
    if (-not $colorDir) { 
        exit 1 
    }

    return $colorDir
}
