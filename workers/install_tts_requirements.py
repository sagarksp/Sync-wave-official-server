import subprocess
import sys
from pathlib import Path

requirements = Path(__file__).with_name("requirements-tts.txt")
subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", str(requirements)])
