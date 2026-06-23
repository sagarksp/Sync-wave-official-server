@echo off
cd /d "%~dp0"
python install_tts_requirements.py
set PORT=5002
python coquiWorker.py
