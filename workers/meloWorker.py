import os
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parents[1]
OUTPUT_DIR = BASE_DIR / "uploads" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MODEL_CACHE = {}


def normalize_language(value):
    lang = str(value or "en").lower()
    if lang in ("hindi", "hi"):
        return "HI"
    if lang in ("punjabi", "pa"):
        return "PA"
    return "EN"


def pick_speaker(speaker_ids, voice):
    voice = str(voice or "male").lower()
    keys = list(speaker_ids.keys())
    preferred = []
    if voice == "female":
        preferred = [key for key in keys if "female" in key.lower() or "f" == key.lower()]
    else:
        preferred = [key for key in keys if "male" in key.lower() or "m" == key.lower()]
    chosen = preferred[0] if preferred else keys[0]
    return speaker_ids[chosen]


def get_model(language):
    try:
        from melo.api import TTS
    except Exception as exc:
        raise RuntimeError("MeloTTS is not installed. Run: pip install melotts torch soundfile flask") from exc

    lang = normalize_language(language)
    if lang not in MODEL_CACHE:
        try:
            MODEL_CACHE[lang] = TTS(language=lang, device=os.getenv("TTS_DEVICE", "cpu"))
        except Exception:
            if lang != "EN":
                MODEL_CACHE[lang] = TTS(language="EN", device=os.getenv("TTS_DEVICE", "cpu"))
            else:
                raise
    return MODEL_CACHE[lang]


@app.post("/tts/melo")
def tts_melo():
    try:
        data = request.get_json(force=True, silent=True) or {}
        text = str(data.get("text") or "").strip()
        if not text:
            return jsonify({"success": False, "error": "text is required"}), 400
        language = data.get("language") or "en"
        voice = data.get("voice") or "male"
        model = get_model(language)
        speaker_id = pick_speaker(getattr(model, "hps").data.spk2id, voice)
        filename = f"melo-{uuid.uuid4().hex}.wav"
        target = OUTPUT_DIR / filename
        model.tts_to_file(text, speaker_id, str(target), speed=float(os.getenv("MELOTTS_SPEED", "1.0")))
        return jsonify({"success": True, "audioUrl": f"/generated/{filename}"})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@app.get("/generated/<path:filename>")
def generated(filename):
    return send_from_directory(OUTPUT_DIR, filename)


if __name__ == "__main__":
    app.run(host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "5001")))
