const mongoose = require("mongoose");

const cachedVideoSchema = new mongoose.Schema({
  provider: { type: String, enum: ["youtube"], default: "youtube", index: true },
  providerVideoId: { type: String, required: true, index: true },
  queryKey: { type: String, required: true, index: true },
  category: { type: String, default: "trending", index: true },
  language: { type: String, default: "english", index: true },
  region: { type: String, default: "US", index: true },
  title: { type: String, required: true, maxlength: 240, text: true },
  description: { type: String, default: "", maxlength: 1200, text: true },
  channelId: { type: String, default: "", index: true },
  channelTitle: { type: String, default: "", maxlength: 160 },
  thumbnailUrl: { type: String, default: "", maxlength: 2000 },
  embedUrl: { type: String, required: true, maxlength: 2000 },
  watchUrl: { type: String, required: true, maxlength: 2000 },
  publishedAt: { type: Date, default: Date.now, index: true },
  fetchedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, index: true },
  etag: { type: String, default: "" },
  raw: { type: Object, default: {} },
  stats: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
  },
}, { timestamps: true });

cachedVideoSchema.index({ provider: 1, providerVideoId: 1 }, { unique: true });
cachedVideoSchema.index({ queryKey: 1, fetchedAt: -1 });

module.exports = mongoose.model("DiscoverCachedVideo", cachedVideoSchema);
