# Stop on first error
$ErrorActionPreference = "Stop"

function Show-Usage {
    param([string]$message)
    Write-Host $message
    Write-Host "Use: $($MyInvocation.MyCommand.Name) <$(Get-BGEnvs)> <$(Get-BGColors)>"
    exit 1
}

# Get the directory where the script is located
$HERE = Join-Path $PWD.Path "deploy"

# Import environment variables from .env file
Get-Content "$HERE\.env" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        $name = $matches[1]
        $value = $matches[2]
        Set-Item -Path "env:$name" -Value $value
    }
}

# Import common functions
. "$HERE\script-common.ps1"

try {
    $BASE = Get-BGBase
    if (-not $BASE) { exit 1 }

    $ENV_NAME = Get-BGCheckDir $BASE $args[0]
    if (-not $ENV_NAME) { Show-Usage "Unknown config dir: $($args[0])" }

    $CONFIG_DIR = Join-Path $BASE $ENV_NAME
    
    $COLOR_NAME = Get-BGCheckColor $CONFIG_DIR $args[1]
    if (-not $COLOR_NAME) { Show-Usage "Invalid color: $($args[1])" }

    $TAG = "$ENV_NAME-$COLOR_NAME"

    # Docker build command
    docker build -t "$env:IMAGE_NAME`:$TAG" .
}
catch {
    Write-Host "Error: $_"
    exit 1
}
