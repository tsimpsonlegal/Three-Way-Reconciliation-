#!/usr/bin/env python3
"""
Quick-start script. Installs dependencies if needed, then launches the app.
Run: python run.py
"""
import subprocess, sys, os, webbrowser, time, threading

def install():
    req = os.path.join(os.path.dirname(__file__), "requirements.txt")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req, "-q"])

def open_browser():
    time.sleep(1.5)
    webbrowser.open("http://localhost:5000")

if __name__ == "__main__":
    install()
    threading.Thread(target=open_browser, daemon=True).start()
    from app import app
    app.run(debug=False, port=5000)
