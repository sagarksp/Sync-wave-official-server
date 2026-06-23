const express = require("express");
const AISong = require("../models/AISong");
const { authRequired } = require("../middleware/auth");
const { createAiProject, workerStatus } = require("../services/aiMusicService");
const pipelineRoutes = require("./aiMusic.routes");

const router = express.Router();

function clean(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function publicAiSong(song) {
  return {
    id: song._id.toString(),
    userId: song.userId?.toString?.() || "",
    title: song.title,
    lyrics: song.lyrics,
    prompt: song.prompt,
    genre: song.genre,
    mood: song.mood,
    voice: song.voice,
    language: song.language,
    bpm: song.bpm,
    tempo: song.tempo,
    energy: song.energy,
    instruments: song.instruments,
    musicPrompt: song.musicPrompt,
    beatPrompt: song.beatPrompt,
    instrumentPrompt: song.instrumentPrompt,
    coverPrompt: song.coverPrompt,
    coverImage: song.coverImage,
    audioUrl: song.audioUrl,
    status: song.status,
    provider: song.provider,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
  };
}

function looksLikeObjectId(id) {
  return /^[a-f\d]{24}$/i.test(String(id || ""));
}

router.get("/workers", authRequired, (req, res) => {
  res.json({ workers: workerStatus() });
});

router.get("/songs", authRequired, async (req, res) => {
  try {
    const songs = await AISong.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ songs: songs.map(publicAiSong) });
  } catch (err) {
    console.error("[AI Songs] list failed", err.message);
    res.status(500).json({ error: "Unable to load AI songs" });
  }
});

router.get("/songs/:id", authRequired, async (req, res) => {
  try {
    if (!looksLikeObjectId(req.params.id)) return res.status(404).json({ error: "AI song not found" });
    const song = await AISong.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!song) return res.status(404).json({ error: "AI song not found" });
    res.json({ song: publicAiSong(song) });
  } catch (err) {
    console.error("[AI Songs] detail failed", err.message);
    res.status(500).json({ error: "Unable to load AI song" });
  }
});

router.post("/generate", authRequired, async (req, res) => {
  try {
    const prompt = clean(req.body.prompt, 2000);
    if (prompt.length < 2) return res.status(400).json({ error: "Describe your song idea first" });

    const input = {
      prompt,
      genre: clean(req.body.genre, 80) || "Pop",
      mood: clean(req.body.mood, 80) || "Emotional",
      voice: clean(req.body.voice, 80) || "Male",
      language: clean(req.body.language, 80) || "Hinglish",
      bpm: Number(req.body.bpm) || 96,
      tempo: clean(req.body.tempo, 80),
      energy: clean(req.body.energy, 80),
      instruments: clean(req.body.instruments, 240),
    };

    console.log("[AI Debug] Controller User Input", {
      userId: req.user._id.toString(),
      prompt: input.prompt,
      genre: input.genre,
      mood: input.mood,
      language: input.language,
      voice: input.voice,
      bpm: input.bpm,
    });

    const project = await createAiProject(input);
    const saved = await AISong.create({
      userId: req.user._id,
      title: project.title,
      lyrics: project.lyrics,
      prompt: input.prompt,
      genre: input.genre,
      mood: input.mood,
      voice: input.voice,
      language: input.language,
      bpm: input.bpm,
      tempo: input.tempo,
      energy: input.energy,
      instruments: input.instruments,
      musicPrompt: project.musicPrompt,
      beatPrompt: project.beatPrompt,
      instrumentPrompt: project.instrumentPrompt,
      coverPrompt: project.coverPrompt,
      coverImage: project.coverImage,
      cloudinaryPublicId: project.cloudinaryPublicId,
      audioUrl: project.audioUrl,
      status: project.status,
      provider: project.provider,
      updatedAt: new Date(),
    });
    console.log("[AI Debug] Saved Mongo Document", JSON.stringify(publicAiSong(saved)).slice(0, 12000));

    res.status(201).json({
      song: publicAiSong(saved),
      workers: project.workers,
      note: "MusicGen, voice, and FFmpeg workers are prepared but disabled unless configured.",
    });
  } catch (err) {
    console.error("[AI Generate] failed", err.stack || err.message);
    res.status(500).json({ error: "Unable to generate song project" });
  }
});

router.use("/", pipelineRoutes);

module.exports = router;
