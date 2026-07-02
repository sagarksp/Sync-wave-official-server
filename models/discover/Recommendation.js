const mongoose = require("mongoose");

const recommendationSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["article", "reel"], required: true, index: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  score: { type: Number, default: 0, index: true },
  reasons: { type: [String], default: [] },
  generatedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

recommendationSchema.index({ accountId: 1, itemType: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model("DiscoverRecommendation", recommendationSchema);
