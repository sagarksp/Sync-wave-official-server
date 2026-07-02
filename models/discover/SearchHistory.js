const mongoose = require("mongoose");

const searchHistorySchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  query: { type: String, required: true, trim: true, maxlength: 180, index: true },
  scope: { type: String, enum: ["all", "articles", "reels", "creators", "topics"], default: "all" },
  resultCount: { type: Number, default: 0 },
}, { timestamps: true });

searchHistorySchema.index({ accountId: 1, createdAt: -1 });

module.exports = mongoose.model("DiscoverSearchHistory", searchHistorySchema);
