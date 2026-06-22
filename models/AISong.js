const mongoose = require("mongoose");

const aiSongSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  lyrics: { type: String, default: "" },
  prompt: { type: String, required: true, trim: true, maxlength: 2000 },
  genre: { type: String, default: "" },
  mood: { type: String, default: "" },
  voice: { type: String, default: "" },
  language: { type: String, default: "" },
  bpm: { type: Number, default: 0 },
  tempo: { type: String, default: "" },
  energy: { type: String, default: "" },
  instruments: { type: String, default: "" },
  musicPrompt: { type: String, default: "" },
  beatPrompt: { type: String, default: "" },
  instrumentPrompt: { type: String, default: "" },
  coverPrompt: { type: String, default: "" },
  coverImage: { type: String, default: "" },
  cloudinaryPublicId: { type: String, default: "" },
  audioUrl: { type: String, default: "" },
  status: { type: String, enum: ["metadata_ready", "music_pending", "completed", "failed"], default: "metadata_ready", index: true },
  provider: { type: String, default: "gemini-metadata" },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

aiSongSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("AISong", aiSongSchema, "ai_songs");
