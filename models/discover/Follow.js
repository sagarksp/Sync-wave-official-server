const mongoose = require("mongoose");

const followSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: "DiscoverCreator", required: true, index: true },
}, { timestamps: true });

followSchema.index({ accountId: 1, creatorId: 1 }, { unique: true });

module.exports = mongoose.model("DiscoverFollow", followSchema);
