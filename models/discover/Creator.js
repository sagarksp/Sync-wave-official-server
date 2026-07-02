const mongoose = require("mongoose");

const creatorSchema = new mongoose.Schema({
  ownerAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  handle: { type: String, required: true, trim: true, lowercase: true, unique: true },
  displayName: { type: String, required: true, trim: true, maxlength: 120 },
  avatarUrl: { type: String, default: "", maxlength: 2000 },
  bio: { type: String, default: "", maxlength: 500 },
  verified: { type: Boolean, default: false },
  stats: {
    followers: { type: Number, default: 0 },
    reels: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model("DiscoverCreator", creatorSchema);
