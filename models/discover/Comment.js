const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  itemType: { type: String, enum: ["article", "reel"], required: true, index: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  body: { type: String, required: true, trim: true, maxlength: 1200 },
  status: { type: String, enum: ["active", "hidden"], default: "active", index: true },
}, { timestamps: true });

commentSchema.index({ itemType: 1, itemId: 1, createdAt: -1 });

module.exports = mongoose.model("DiscoverComment", commentSchema);
