# Stop on first error
$ErrorActionPreference = "Stop"

function Show-Usage {
    param([string]$message)
    Write-Host $message
    Write-Host "Use: $($MyInvocation.MyCommand.Name) <$(Get-BGEnvs)> <$(Get-BGColors)>"
    exit 1
}

$HERE = Join-Path $PWD.Path "deploy"

# Import environment variables from .env file
$envFile = Join-Path $HERE ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $name = $matches[1]
            $value = $matches[2]
            Set-Item -Path "env:$name" -Value $value
        }
    }
}

# Import common functions
$commonScript = Join-Path $HERE "script-common.ps1"
. $commonScript

try {
    $BASE = Get-BGBase
    if (-not $BASE) { exit 1 }

    $ENV_NAME = Get-BGCheckDir $BASE $args[0]
    if (-not $ENV_NAME) { Show-Usage "Unknown env dir: $($args[0])" }

    $CONFIG_DIR = Join-Path $BASE $ENV_NAME
    
    $COLOR_NAME = Get-BGCheckColor $CONFIG_DIR $args[1]
    if (-not $COLOR_NAME) { Show-Usage "Invalid color: $($args[1])" }

    $COLOR_FILE_PATH = Join-Path $CONFIG_DIR (Get-BGCheckFile $CONFIG_DIR $COLOR_NAME)
    if (-not $COLOR_FILE_PATH) { Show-Usage "No '$COLOR_NAME' file present in $CONFIG_DIR" }

    $CONFIG_FILE_PATH = Join-Path $CONFIG_DIR (Get-BGCheckFile $CONFIG_DIR "config")
    if (-not $CONFIG_FILE_PATH) { Show-Usage "No 'config' file present in $CONFIG_DIR" }

    # Source color and config files
    . $COLOR_FILE_PATH
    . $CONFIG_FILE_PATH

    $TAG = "$ENV_NAME-$COLOR_NAME"
    $CONTAINER_NAME = "$env:CONTAINER_NAME-$TAG"

    # Check if image exists
    $IMAGE_HASH = docker image ls -q "$env:IMAGE_NAME`:$TAG"
    if ([string]::IsNullOrEmpty($IMAGE_HASH)) {
        Write-Host "Image not found: $env:IMAGE_NAME`:$TAG"
        Write-Host "Maybe run build.ps1 first?"
        exit 1
    }

    $MOUNTS = @()
    $RUN_ARGS = @()

    $LE_ROOT = "C:\Certificates\letsencrypt"  # Adjust path for Windows

    $CONTAINER_LIVE_DIR = "/certs/live/$env:TLS_SERVER_NAME"
    $CONTAINER_ARCHIVE_DIR = "/certs/archive/$env:TLS_SERVER_NAME"
    $TLS_KEY_FILE = "$CONTAINER_LIVE_DIR/privkey.pem"
    $TLS_CERT_FILE = "$CONTAINER_LIVE_DIR/fullchain.pem"

    $tlsPath = Join-Path $HERE "tls"
    if ((Test-Path (Join-Path $tlsPath "privkey.pem")) -and (Test-Path (Join-Path $tlsPath "fullchain.pem"))) {
        $MOUNTS += "-v", "${tlsPath}:$CONTAINER_LIVE_DIR`:ro"
    }
    elseif ((Test-Path (Join-Path $LE_ROOT "live")) -and (Test-Path (Join-Path $LE_ROOT "archive"))) {
        $MOUNTS += "-v", "$LE_ROOT/live/$env:TLS_SERVER_NAME`:$CONTAINER_LIVE_DIR`:ro"
        $MOUNTS += "-v", "$LE_ROOT/archive/$env:TLS_SERVER_NAME`:$CONTAINER_ARCHIVE_DIR`:ro"
    }
    elseif ($env:TLS_SERVER_NAME) {
        Write-Host "TLS_SERVER_NAME is specified, but cannot find an appropriate certificate path to mount (tried: '$tlsPath', '$LE_ROOT'). No certificates can be mounted into the container."
        exit 1
    }

    if ($args.Count -eq 2) {
        # When no additional args are passed, re-launch the container with the current env arguments
        $RUN_ARGS += "-d", "--name", $CONTAINER_NAME
        $RUN_ARGS += "--restart", "unless-stopped"
        $RUN_ARGS += "-p", "${env:DOCKER_BIND_IP:-0.0.0.0}:$env:BACKEND_PORT`:${env:APP_LISTEN_PORT:-4444}"

        docker stop $CONTAINER_NAME 2>$null
        docker rm $CONTAINER_NAME 2>$null
    }
    else {
        # When args are passed, run interactively
        $RUN_ARGS += "--rm", "-it"
    }

    # Build the docker run command
    $dockerArgs = @(
        $RUN_ARGS
        "--network", "nt"
        "--network-alias", $env:TLS_SERVER_NAME
        $MOUNTS
        "-e", "ENV_NAME=$ENV_NAME"
        "-e", "COLOR_NAME=$COLOR_NAME"
        "-e", "JWT_SECRET=$env:JWT_SECRET"
        "-e", "JWT_REFRESH=$env:JWT_REFRESH"
        "-e", "TLS_KEY_FILE=$TLS_KEY_FILE"
        "-e", "TLS_CERT_FILE=$TLS_CERT_FILE"
        "-e", "DEBUG=nt,nt:*"
        "-e", "TLS_SERVER_NAME=$env:TLS_SERVER_NAME"
        "-e", "APP_UNIX_SOCKET=$env:APP_UNIX_SOCKET"
        "-e", "APP_LISTEN_ADDRESS=$env:APP_LISTEN_ADDRESS"
        "-e", "APP_LISTEN_PORT=$env:APP_LISTEN_PORT"
        "-e", "WS_PATH=$env:WS_PATH"
        "-e", "API_PATH=$env:API_PATH"
        "-e", "DEV_MODE=$env:DEV_MODE"
        "-e", "WEBFACE_ORIGIN=$env:WEBFACE_ORIGIN"
        "-e", "DRAIN_DROP_DEAD_TIMEOUT_S=$env:DRAIN_DROP_DEAD_TIMEOUT_S"
        "-e", "DRAIN_GRACE_TIMEOUT_S=$env:DRAIN_GRACE_TIMEOUT_S"
        "-e", "DRAIN_NOTIFY_INTERVAL_S=$env:DRAIN_NOTIFY_INTERVAL_S"
        "-e", "UWS_IDLE_TIMEOUT_S=$env:UWS_IDLE_TIMEOUT_S"
        "-e", "UWS_MAX_PAYLOAD_LENGTH_BYTES=$env:UWS_MAX_PAYLOAD_LENGTH_BYTES"
        "-e", "WARN_PAYLOAD_LENGTH_BYTES=$env:WARN_PAYLOAD_LENGTH_BYTES"
        "$env:IMAGE_NAME`:$TAG"
    )

    if ($args.Count -gt 2) {
        $dockerArgs += $args[2..($args.Count-1)]
    }

    # Execute docker run command
    & docker run $dockerArgs
}
catch {
    Write-Host "Error: $_"
    exit 1
}
