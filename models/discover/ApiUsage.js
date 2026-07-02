const mongoose = require("mongoose");

const apiUsageSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  provider: { type: String, enum: ["youtube"], default: "youtube", index: true },
  dateKey: { type: String, required: true, index: true },
  action: { type: String, enum: ["auto-fetch", "manual-search", "cache-hit", "api-error"], required: true, index: true },
  units: { type: Number, default: 1 },
  query: { type: String, default: "", maxlength: 180 },
  ok: { type: Boolean, default: true },
  message: { type: String, default: "", maxlength: 300 },
}, { timestamps: true });

apiUsageSchema.index({ accountId: 1, provider: 1, dateKey: 1, action: 1 });

module.exports = mongoose.model("DiscoverApiUsage", apiUsageSchema);
