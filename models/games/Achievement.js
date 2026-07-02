const mongoose = require("mongoose");

const achievementSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    icon: { type: String, required: true, trim: true },
    gameId: { type: String, trim: true, default: "all", index: true },
    trigger: {
      metric: { type: String, required: true, trim: true },
      target: { type: Number, required: true },
    },
    reward: {
      coins: { type: Number, default: 0 },
      xp: { type: Number, default: 0 },
    },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Achievement", achievementSchema);
