const mongoose = require("mongoose");

const feedArticleSchema = new mongoose.Schema({
  provider: { type: String, required: true, index: true },
  externalId: { type: String, required: true },
  url: { type: String, required: true, maxlength: 2000 },
  canonicalUrl: { type: String, default: "", maxlength: 2000 },
  title: { type: String, required: true, trim: true, maxlength: 280, text: true },
  description: { type: String, default: "", maxlength: 900, text: true },
  imageUrl: { type: String, default: "", maxlength: 2000 },
  source: { type: String, default: "Unknown", trim: true, maxlength: 120, index: true },
  author: { type: String, default: "", maxlength: 160 },
  category: { type: String, default: "general", index: true },
  language: { type: String, default: "english", index: true },
  country: { type: String, default: "", maxlength: 12 },
  readingTimeMinutes: { type: Number, default: 1, min: 1, max: 120 },
  publishedAt: { type: Date, default: Date.now, index: true },
  fetchedAt: { type: Date, default: Date.now, index: true },
  tags: { type: [String], default: [], index: true },
  trendingScore: { type: Number, default: 0, index: true },
  stats: {
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    saves: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    ignores: { type: Number, default: 0 },
  },
  status: { type: String, enum: ["active", "hidden", "featured"], default: "active", index: true },
}, { timestamps: true });

feedArticleSchema.index({ provider: 1, externalId: 1 }, { unique: true });
feedArticleSchema.index({ status: 1, publishedAt: -1 });
feedArticleSchema.index({ category: 1, language: 1, publishedAt: -1 });

module.exports = mongoose.model("DiscoverFeedArticle", feedArticleSchema);
