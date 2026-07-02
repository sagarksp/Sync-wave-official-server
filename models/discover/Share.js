const mongoose = require("mongoose");

const shareSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["article", "reel"], required: true, index: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  target: { type: String, default: "native", maxlength: 80 },
}, { timestamps: true });

shareSchema.index({ itemType: 1, itemId: 1, createdAt: -1 });

module.exports = mongoose.model("DiscoverShare", shareSchema);
