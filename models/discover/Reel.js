const mongoose = require("mongoose");

const reelSchema = new mongoose.Schema({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "DiscoverCreator", index: true },
  uploaderAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  title: { type: String, required: true, trim: true, maxlength: 180, text: true },
  description: { type: String, default: "", maxlength: 900, text: true },
  videoUrl: { type: String, required: true, maxlength: 2000 },
  provider: { type: String, enum: ["upload", "youtube"], default: "upload", index: true },
  providerVideoId: { type: String, default: "", index: true },
  watchUrl: { type: String, default: "", maxlength: 2000 },
  embedUrl: { type: String, default: "", maxlength: 2000 },
  thumbnailUrl: { type: String, default: "", maxlength: 2000 },
  durationSeconds: { type: Number, default: 0 },
  category: { type: String, default: "news", index: true },
  language: { type: String, default: "english", index: true },
  hashtags: { type: [String], default: [], index: true },
  source: { type: String, enum: ["user", "admin", "licensed-api"], default: "user", index: true },
  status: { type: String, enum: ["pending", "approved", "featured", "rejected"], default: "pending", index: true },
  publishedAt: { type: Date, default: Date.now, index: true },
  trendingScore: { type: Number, default: 0, index: true },
  stats: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    completions: { type: Number, default: 0 },
    skips: { type: Number, default: 0 },
    replays: { type: Number, default: 0 },
  },
}, { timestamps: true });

reelSchema.index({ status: 1, category: 1, publishedAt: -1 });
reelSchema.index({ provider: 1, providerVideoId: 1 }, { sparse: true });

module.exports = mongoose.model("DiscoverReel", reelSchema);
