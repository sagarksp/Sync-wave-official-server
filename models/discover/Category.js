const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  label: { type: String, required: true, trim: true, maxlength: 80 },
  type: { type: String, enum: ["feed", "reel", "both"], default: "both" },
  active: { type: Boolean, default: true, index: true },
  weight: { type: Number, default: 1 },
}, { timestamps: true });

module.exports = mongoose.model("DiscoverCategory", categorySchema);
