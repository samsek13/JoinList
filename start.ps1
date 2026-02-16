$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "JoinList One-Click Start" -ForegroundColor Cyan
Write-Host "Project Path: $projectRoot" -ForegroundColor DarkGray

try {
    # Check for npm
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Error: npm.cmd not found. Please install Node.js." -ForegroundColor Red
        Write-Host "Visit https://nodejs.org/ to download and install the LTS version." -ForegroundColor Red
        Read-Host "Press Enter to exit..."
        exit 1
    }

    # Create .env if missing (Default to Simple Mode)
    if (-not (Test-Path "$projectRoot\.env")) {
        Write-Host "Creating default .env configuration (Simple Mode)..." -ForegroundColor Yellow
        $envContent = @"
DATABASE_URL="file:./dev.db"
QUEUE_MODE="memory"
PORT=3000
"@
        Set-Content -Path "$projectRoot\.env" -Value $envContent
    }

    # Install dependencies if node_modules missing
    if (-not (Test-Path "$projectRoot\node_modules")) {
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        & npm.cmd install
    }

    # Generate Prisma Client
    Write-Host "Generating Prisma Client..." -ForegroundColor Yellow
    & npm.cmd run prisma:generate

    # Initialize Database
    Write-Host "Initializing database..." -ForegroundColor Yellow
    & npm.cmd run prisma:migrate

    # Start Server
    Write-Host "Starting server..." -ForegroundColor Green
    Write-Host "Open in browser: http://localhost:3000" -ForegroundColor Green
    & npm.cmd run dev
}
catch {
    Write-Host "An error occurred: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}
