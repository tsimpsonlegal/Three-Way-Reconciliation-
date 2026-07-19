@echo off
REM ============================================================
REM  Qualia Payoff Uploader - one-time setup (Windows)
REM  Run this ONCE after installing Python from python.org
REM ============================================================
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
    echo.
    echo Python was not found. Install it from https://www.python.org/downloads/
    echo IMPORTANT: check "Add python.exe to PATH" during installation.
    echo Then run this setup.bat again.
    pause
    exit /b 1
)

echo Creating private Python environment...
py -3 -m venv .venv
if errorlevel 1 ( echo Failed to create the environment. & pause & exit /b 1 )

echo Installing components (this takes a few minutes)...
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\pip install -r requirements.txt
if errorlevel 1 ( echo Install failed - check your internet connection. & pause & exit /b 1 )

echo Downloading the automation browser (Chromium)...
.venv\Scripts\playwright install chromium
if errorlevel 1 ( echo Browser download failed. & pause & exit /b 1 )

echo.
echo ============================================================
echo  Setup complete!
echo  Double-click "Start Qualia Uploader.bat" to run the app.
echo ============================================================
pause
