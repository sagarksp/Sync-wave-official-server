const mongoose = require("mongoose");

const watchHistorySchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["article", "reel"], required: true, index: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  category: { type: String, default: "general", index: true },
  language: { type: String, default: "english", index: true },
  seconds: { type: Number, default: 0 },
  completionRate: { type: Number, default: 0 },
  event: { type: String, enum: ["view", "read", "watch", "complete", "skip", "replay", "ignore"], default: "view", index: true },
  sessionId: { type: String, default: "", index: true },
}, { timestamps: true });

watchHistorySchema.index({ accountId: 1, itemType: 1, itemId: 1, createdAt: -1 });

module.exports = mongoose.model("DiscoverWatchHistory", watchHistorySchema);
