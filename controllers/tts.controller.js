function ttsStatus(req, res) {
  res.json({
    melo: {
      configured: Boolean(process.env.MELOTTS_WORKER_URL),
      url: process.env.MELOTTS_WORKER_URL || "",
      endpoint: "/tts/melo",
    },
    coqui: {
      configured: Boolean(process.env.COQUI_TTS_WORKER_URL),
      url: process.env.COQUI_TTS_WORKER_URL || "",
      endpoint: "/tts/coqui",
    },
  });
}

module.exports = { ttsStatus };
