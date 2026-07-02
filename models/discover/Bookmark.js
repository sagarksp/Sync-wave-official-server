const mongoose = require("mongoose");

const bookmarkSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["article", "reel"], required: true, index: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  offlineAvailable: { type: Boolean, default: false },
  cachedAt: { type: Date },
}, { timestamps: true });

bookmarkSchema.index({ accountId: 1, itemType: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model("DiscoverBookmark", bookmarkSchema);
