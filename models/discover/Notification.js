const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["breaking-news", "trending-topic", "recommended-article", "recommended-reel", "category-alert", "topic-alert"], required: true, index: true },
  title: { type: String, required: true, maxlength: 180 },
  body: { type: String, default: "", maxlength: 500 },
  itemType: { type: String, enum: ["article", "reel", "topic", ""], default: "" },
  itemId: { type: mongoose.Schema.Types.ObjectId },
  readAt: { type: Date },
}, { timestamps: true });

notificationSchema.index({ accountId: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.model("DiscoverNotification", notificationSchema);
