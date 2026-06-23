import os
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = BASE_DIR / "uploads" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL = None


def normalize_language(value):
    lang = str(value or "en").lower()
    if lang in ("hindi", "hi"):
        return "hi"
    if lang in ("punjabi", "pa"):
        return "pa"
    return "en"


def get_model():
    global MODEL
    if MODEL is not None:
        return MODEL
    try:
        from TTS.api import TTS
    except Exception as exc:
        raise RuntimeError("Coqui TTS is not installed. Run: pip install TTS torch soundfile flask") from exc
    model_name = os.getenv("COQUI_MODEL", "tts_models/multilingual/multi-dataset/your_tts")
    MODEL = TTS(model_name=model_name, progress_bar=False, gpu=os.getenv("TTS_DEVICE", "cpu") == "cuda")
    return MODEL


@app.post("/tts/coqui")
def tts_coqui():
    try:
        data = request.get_json(force=True, silent=True) or {}
        text = str(data.get("text") or "").strip()
        if not text:
            return jsonify({"success": False, "error": "text is required"}), 400
        language = normalize_language(data.get("language"))
        voice = str(data.get("voice") or "male").lower()
        filename = f"coqui-{uuid.uuid4().hex}.wav"
        target = OUTPUT_DIR / filename
        model = get_model()
        kwargs = {"text": text, "file_path": str(target)}
        if getattr(model, "is_multi_lingual", False):
            kwargs["language"] = language
        if getattr(model, "is_multi_speaker", False):
            speakers = getattr(model, "speakers", None) or []
            if speakers:
                preferred = [speaker for speaker in speakers if voice in str(speaker).lower()]
                kwargs["speaker"] = preferred[0] if preferred else speakers[0]
        model.tts_to_file(**kwargs)
        return jsonify({"success": True, "audioUrl": f"/generated/{filename}"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.get("/generated/<path:filename>")
def generated(filename):
    return send_from_directory(OUTPUT_DIR, filename)


if __name__ == "__main__":
    app.run(host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "5002")))
