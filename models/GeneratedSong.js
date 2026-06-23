const mongoose = require("mongoose");

const generatedSongSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  lyrics: { type: String, default: "" },
  prompt: { type: String, required: true, trim: true, maxlength: 2000 },
  genre: { type: String, default: "" },
  mood: { type: String, default: "" },
  language: { type: String, default: "" },
  voice: { type: String, default: "" },
  musicPrompt: { type: String, default: "" },
  beatPrompt: { type: String, default: "" },
  coverPrompt: { type: String, default: "" },
  coverImage: { type: String, default: "" },
  audioUrl: { type: String, default: "" },
  instrumentalUrl: { type: String, default: "" },
  vocalsUrl: { type: String, default: "" },
  duration: { type: Number, default: 0 },
  status: { type: String, enum: ["queued", "generating_lyrics", "generating_music", "generating_voice", "mixing", "completed", "failed"], default: "queued", index: true },
  provider: { type: String, default: "gemini-2.5-flash/musicgen-small/melotts" },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
});

generatedSongSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("GeneratedSong", generatedSongSchema, "generated_songs");
