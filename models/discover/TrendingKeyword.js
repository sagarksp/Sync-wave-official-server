const mongoose = require("mongoose");

const trendingKeywordSchema = new mongoose.Schema({
  keyword: { type: String, required: true, lowercase: true, trim: true, index: true },
  category: { type: String, default: "general", index: true },
  score: { type: Number, default: 1, index: true },
  lastSearchedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

trendingKeywordSchema.index({ keyword: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("DiscoverTrendingKeyword", trendingKeywordSchema);
