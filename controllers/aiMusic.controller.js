const crypto = require("crypto");
const GeneratedSong = require("../models/GeneratedSong");
const { generateSongMetadata } = require("../services/ai/gemini.service");
const { generateInstrumental } = require("../services/ai/musicgen.service");
const { generateVocals } = require("../services/ai/voice.service");
const { mixFinalSong } = require("../services/ai/ffmpeg.service");
const { runStep, registerProcessors, lyricsQueue, musicQueue, ttsQueue, mergeQueue, usingBull } = require("../queues/aiMusic.queues");
const { emitStarted, emitProgress, emitCompleted, emitFailed } = require("../sockets/songGeneration.socket");

const jobs = new Map();

registerProcessors({
  lyrics: generateSongMetadata,
  music: generateInstrumental,
  tts: generateVocals,
  merge: mixFinalSong,
});

function clean(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

function publicSong(song) {
  if (!song) return null;
  return {
    id: song._id?.toString?.() || song.id || "",
    title: clean(song.title, 160),
    lyrics: clean(song.lyrics, 18000),
    prompt: clean(song.prompt, 2000),
    genre: clean(song.genre, 80),
    mood: clean(song.mood, 80),
    language: clean(song.language, 80),
    voice: clean(song.voice, 80),
    coverImage: clean(song.coverImage, 4000),
    instrumentalUrl: clean(song.instrumentalUrl, 1000),
    vocalsUrl: clean(song.vocalsUrl, 1000),
    finalSongUrl: clean(song.finalSongUrl, 1000),
    audioUrl: clean(song.audioUrl || song.finalSongUrl, 1000),
    duration: song.duration || 0,
    status: clean(song.status, 80),
    createdBy: song.createdBy?.toString?.() || song.userId?.toString?.() || "",
    createdAt: song.createdAt,
  };
}

function publicJob(job) {
  return {
    jobId: clean(job?.jobId, 80),
    status: clean(job?.status, 80),
    step: clean(job?.step, 120),
    progress: Math.max(0, Math.min(100, Number(job?.progress) || 0)),
    error: clean(job?.error, 1000),
    song: publicSong(job?.song),
    songId: clean(job?.songId, 80),
    createdAt: job?.createdAt || null,
    updatedAt: job?.updatedAt || null,
  };
}

function setJob(jobId, patch) {
  const current = jobs.get(jobId) || {};
  const next = { ...current, ...patch, updatedAt: Date.now() };
  jobs.set(jobId, next);
  return next;
}

function updateProgress(io, userId, jobId, patch) {
  const job = setJob(jobId, patch);
  emitProgress(io, userId, {
    jobId,
    status: job.status,
    step: job.step,
    progress: job.progress,
    song: job.song || null,
    error: job.error || "",
  });
  return job;
}

function inputFromBody(body) {
  return {
    prompt: clean(body.prompt, 2000),
    genre: clean(body.genre, 80) || "Pop",
    mood: clean(body.mood, 80) || "Emotional",
    language: clean(body.language, 80) || "Hinglish",
    voice: clean(body.voice || body.voiceType, 80) || "Male",
    bpm: Number(body.bpm) || 96,
    tempo: clean(body.tempo, 80),
    energy: clean(body.energy, 80),
    instruments: clean(body.instruments, 240),
  };
}

async function runPipeline({ jobId, input, userId, io }) {
  let saved = null;
  try {
    emitStarted(io, userId, { jobId, status: "started", step: "Generating Lyrics", progress: 0 });
    updateProgress(io, userId, jobId, { status: "generating_lyrics", step: "Generating Lyrics", progress: 0 });
    const metadata = await runStep(lyricsQueue, "lyricsQueue", input, generateSongMetadata);
    saved = await GeneratedSong.create({
      userId,
      title: metadata.title,
      lyrics: metadata.lyrics,
      prompt: input.prompt,
      genre: input.genre,
      mood: input.mood,
      language: input.language,
      voice: input.voice,
      musicPrompt: metadata.musicPrompt,
      beatPrompt: metadata.beatPrompt,
      coverPrompt: metadata.coverPrompt,
      coverImage: metadata.coverImage,
      status: "generating_music",
      provider: metadata.provider || "gemini-2.5-flash",
      updatedAt: new Date(),
    });
    updateProgress(io, userId, jobId, { songId: saved._id.toString(), song: publicSong(saved), step: "Generating Music", status: "generating_music", progress: 25 });

    const instrumental = await runStep(musicQueue, "musicQueue", { musicPrompt: metadata.musicPrompt, jobId }, generateInstrumental);
    saved.instrumentalUrl = instrumental.url;
    saved.status = "generating_voice";
    await saved.save();
    updateProgress(io, userId, jobId, { song: publicSong(saved), step: "Generating Voice", status: "generating_voice", progress: 50 });

    const vocals = await runStep(ttsQueue, "ttsQueue", { lyrics: metadata.lyrics, voiceType: input.voice, voice: input.voice, language: input.language, jobId }, generateVocals);
    saved.vocalsUrl = vocals.url;
    saved.status = "mixing";
    await saved.save();
    updateProgress(io, userId, jobId, { song: publicSong(saved), step: "Mixing Audio", status: "mixing", progress: 75 });

    const final = await runStep(mergeQueue, "mergeQueue", { instrumentalPath: instrumental.path, vocalsPath: vocals.path, jobId }, mixFinalSong);
    saved.finalSongUrl = final.url;
    saved.audioUrl = final.url;
    saved.status = "completed";
    saved.updatedAt = new Date();
    await saved.save();
    const done = setJob(jobId, { status: "completed", step: "Completed", progress: 100, song: publicSong(saved) });
    emitCompleted(io, userId, { jobId, status: "completed", step: "Completed", progress: 100, song: publicSong(saved) });
    return done;
  } catch (err) {
    if (saved) {
      saved.status = "failed";
      saved.updatedAt = new Date();
      await saved.save().catch(() => {});
    }
    return setJob(jobId, {
      status: "failed",
      step: "Failed",
      progress: 100,
      error: err.message || "AI generation failed",
      song: saved ? publicSong(saved) : null,
    });
  } finally {
    const job = jobs.get(jobId);
    if (job?.status === "failed") emitFailed(io, userId, { jobId, status: "failed", step: "Failed", progress: 100, error: job.error, song: job.song || null });
  }
}

async function generateSong(req, res) {
  const input = inputFromBody(req.body);
  if (input.prompt.length < 2) return res.status(400).json({ error: "Prompt is required" });
  const jobId = crypto.randomBytes(10).toString("hex");
  const io = req.app.get("io");
  setJob(jobId, { jobId, status: "queued", step: "Generating Lyrics", progress: 5, error: "", song: null, createdAt: Date.now() });
  if (req.query.wait === "true" || req.body.wait === true) {
    const result = await runPipeline({ jobId, input, userId: req.user._id, io });
    if (result.status === "failed") return res.status(503).json({ error: result.error, jobId, song: result.song });
    return res.status(201).json(result.song);
  }
  runPipeline({ jobId, input, userId: req.user._id, io }).catch((err) => {
    setJob(jobId, { status: "failed", step: "Failed", progress: 100, error: err.message });
  });
  res.status(202).json({ jobId, status: "queued", step: "Generating Lyrics", progress: 5 });
}

async function listGeneratedSongs(req, res) {
  const songs = await GeneratedSong.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ songs: songs.map(publicSong), queue: usingBull ? "bull" : "in-memory" });
}

async function deleteGeneratedSong(req, res) {
  const deleted = await GeneratedSong.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!deleted) return res.status(404).json({ error: "Generated song not found" });
  res.json({ ok: true });
}

function getJob(req, res) {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Generation job not found" });
  res.json(publicJob(job));
}

async function generateInstrumentalEndpoint(req, res) {
  try {
    const result = await generateInstrumental({ musicPrompt: req.body.musicPrompt, jobId: crypto.randomBytes(8).toString("hex") });
    res.status(201).json({ instrumentalUrl: result.url });
  } catch (err) {
    res.status(err.code === "MUSICGEN_UNAVAILABLE" ? 503 : 500).json({ error: err.message });
  }
}

async function generateVocalsEndpoint(req, res) {
  try {
    const result = await generateVocals({
      lyrics: req.body.lyrics,
      voiceType: req.body.voiceType,
      voice: req.body.voice,
      language: req.body.language,
      jobId: crypto.randomBytes(8).toString("hex"),
    });
    res.status(201).json({ vocalsUrl: result.url });
  } catch (err) {
    res.status(err.code === "TTS_WORKER_UNAVAILABLE" ? 503 : 500).json({ error: err.message });
  }
}

module.exports = {
  generateSong,
  getJob,
  generateInstrumentalEndpoint,
  generateVocalsEndpoint,
  listGeneratedSongs,
  deleteGeneratedSong,
  publicSong,
};
