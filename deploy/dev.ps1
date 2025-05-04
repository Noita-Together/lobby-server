# Stop on first error
$ErrorActionPreference = "Stop"

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

# Change to parent directory
Push-Location (Join-Path $HERE "..")

# Execute nodemon using npx
try {
    & npx nodemon -V
}
finally {
    # Restore the previous location
    Pop-Location
}
