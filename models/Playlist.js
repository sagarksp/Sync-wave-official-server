const mongoose = require("mongoose");

const songSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, default: "Unknown" },
    artist: { type: String, default: "" },
    album: { type: String, default: "" },
    duration: { type: Number, default: 0 },
    cover: { type: String, default: "" },
    streamUrl: { type: String, default: "" },
    language: { type: String, default: "" },
    year: { type: String, default: "" },
  },
  { _id: false }
);

const playlistSchema = new mongoose.Schema({
  ownerAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  songs: { type: [songSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

playlistSchema.index({ ownerAccountId: 1, updatedAt: -1 });

module.exports = mongoose.model("Playlist", playlistSchema);
