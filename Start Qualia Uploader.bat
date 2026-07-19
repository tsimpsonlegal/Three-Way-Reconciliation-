@echo off
REM ============================================================
REM  Qualia Payoff Uploader - start the app
REM ============================================================
cd /d "%~dp0"

if not exist .venv\Scripts\python.exe (
    echo Setup has not been run yet. Running setup first...
    call setup.bat
    if not exist .venv\Scripts\python.exe exit /b 1
)

echo Starting Qualia Payoff Uploader...
echo The app will open in your browser at http://127.0.0.1:8977
echo Keep this window open while you use the app. Close it to quit.
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8977"
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8977
pause
