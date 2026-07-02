const mongoose = require("mongoose");

const searchUsageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  date: { type: String, required: true, index: true },
  searchCount: { type: Number, default: 0 },
  resetAt: { type: Date, required: true, index: true },
}, { timestamps: true });

searchUsageSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("DiscoverSearchUsage", searchUsageSchema);
