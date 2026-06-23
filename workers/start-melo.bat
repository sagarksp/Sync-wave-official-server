@echo off
cd /d "%~dp0"
python install_tts_requirements.py
set PORT=5001
python meloWorker.py
