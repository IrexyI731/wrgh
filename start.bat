@echo off
:: This line ensures the script runs in the folder where it is located
cd /d "%~dp0"

echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] npm install failed. Make sure Node.js is installed!
    pause
    exit /b
)

echo.
echo Starting Card Royale...
call npm run dev
pause
