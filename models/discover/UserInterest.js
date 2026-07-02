const mongoose = require("mongoose");

const userInterestSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  categories: { type: Map, of: Number, default: {} },
  languages: { type: Map, of: Number, default: {} },
  topics: { type: Map, of: Number, default: {} },
  creators: { type: Map, of: Number, default: {} },
  mutedTopics: { type: [String], default: [] },
  lastSignalsAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("DiscoverUserInterest", userInterestSchema);
