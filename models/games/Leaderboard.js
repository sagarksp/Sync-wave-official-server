const mongoose = require("mongoose");

const leaderboardSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true, trim: true },
    displayName: { type: String, trim: true, default: "" },
    avatarUrl: { type: String, trim: true, default: "" },
    gameId: { type: String, required: true, index: true },
    scope: { type: String, enum: ["global", "weekly", "daily"], default: "global", index: true },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    xp: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    rating: { type: Number, default: 1000, index: true },
    totalGamesPlayed: { type: Number, default: 0 },
    lastMatchAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

leaderboardSchema.index({ gameId: 1, scope: 1, rating: -1, xp: -1 });
leaderboardSchema.index({ userId: 1, gameId: 1, scope: 1 }, { unique: true });

module.exports = mongoose.model("Leaderboard", leaderboardSchema);
