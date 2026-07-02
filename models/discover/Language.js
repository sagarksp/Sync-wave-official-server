const mongoose = require("mongoose");

const languageSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  label: { type: String, required: true, trim: true, maxlength: 80 },
  isoCode: { type: String, default: "", maxlength: 12 },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

module.exports = mongoose.model("DiscoverLanguage", languageSchema);
