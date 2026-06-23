const { synthesizeVocals } = require("../ttsService");

async function generateVocals({ lyrics, voiceType, voice, language, jobId }) {
  const cleanLyrics = String(lyrics || "").trim();
  if (!cleanLyrics) throw new Error("lyrics are required");
  return synthesizeVocals({
    lyrics: cleanLyrics,
    language,
    voice: voice || voiceType,
    jobId,
  });
}

module.exports = { generateVocals };
