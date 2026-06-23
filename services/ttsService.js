const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const outputDir = path.join(__dirname, "..", "uploads", "generated", "vocals");
fs.mkdirSync(outputDir, { recursive: true });

function cleanBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function publicUrl(filename) {
  return `/generated/vocals/${filename}`;
}

function languageCode(language) {
  const value = String(language || "").toLowerCase();
  if (["hindi", "hi"].includes(value)) return "hi";
  if (["punjabi", "pa"].includes(value)) return "pa";
  if (["english", "en"].includes(value)) return "en";
  return value || "en";
}

async function callWorker(baseUrl, endpoint, payload) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `${endpoint} failed with ${response.status}`);
  }
  if (!data.audioUrl) throw new Error(`${endpoint} did not return audioUrl`);
  return data.audioUrl;
}

async function downloadWorkerAudio(baseUrl, audioUrl, jobId, provider) {
  const source = /^https?:\/\//i.test(audioUrl) ? audioUrl : `${baseUrl}${audioUrl}`;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${provider} audio download failed with ${response.status}`);
  const buffer = await response.buffer();
  const filename = `${jobId || Date.now()}-${provider}-vocals.wav`;
  const target = path.join(outputDir, filename);
  await fs.promises.writeFile(target, buffer);
  return { path: target, url: publicUrl(filename), provider };
}

async function synthesizeVocals({ lyrics, language, voice, voiceType, jobId }) {
  const text = String(lyrics || "").trim();
  if (!text) throw new Error("lyrics are required");

  const payload = {
    text,
    language: languageCode(language),
    voice: String(voice || voiceType || "male").toLowerCase(),
  };

  const meloUrl = cleanBaseUrl(process.env.MELOTTS_WORKER_URL);
  const coquiUrl = cleanBaseUrl(process.env.COQUI_TTS_WORKER_URL);

  if (meloUrl) {
    try {
      const audioUrl = await callWorker(meloUrl, "/tts/melo", payload);
      return downloadWorkerAudio(meloUrl, audioUrl, jobId, "melo");
    } catch (err) {
      if (!coquiUrl) throw err;
      console.warn("[SyncWave TTS] MeloTTS failed, falling back to Coqui", err.message);
    }
  }

  if (coquiUrl) {
    const audioUrl = await callWorker(coquiUrl, "/tts/coqui", payload);
    return downloadWorkerAudio(coquiUrl, audioUrl, jobId, "coqui");
  }

  const err = new Error("No TTS worker configured. Set MELOTTS_WORKER_URL or COQUI_TTS_WORKER_URL.");
  err.code = "TTS_WORKER_UNAVAILABLE";
  throw err;
}

module.exports = { synthesizeVocals };
