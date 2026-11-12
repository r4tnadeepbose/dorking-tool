@echo off
setlocal
cd /d "%~dp0"
set DORKING_HOST=127.0.0.1
set DORKING_PORT=8765
echo Starting Dorking Tool (Python server + HTML UI)...
echo Open: http://127.0.0.1:8765/
python server.py
pause
