const mongoose = require("mongoose");

const likeSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["article", "reel"], required: true, index: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
}, { timestamps: true });

likeSchema.index({ accountId: 1, itemType: 1, itemId: 1 }, { unique: true });

module.exports = mongoose.model("DiscoverLike", likeSchema);
