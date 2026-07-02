const mongoose = require("mongoose");

const statsSchema = new mongoose.Schema(
  {
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    totalGamesPlayed: { type: Number, default: 0 },
    winStreak: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    lastPlayedAt: { type: Date, default: null },
  },
  { _id: false }
);

const achievementProgressSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    progress: { type: Number, default: 0 },
    unlocked: { type: Boolean, default: false },
    unlockedAt: { type: Date, default: null },
  },
  { _id: false }
);

const dailyRewardSchema = new mongoose.Schema(
  {
    streak: { type: Number, default: 0 },
    lastClaimedAt: { type: Date, default: null },
  },
  { _id: false }
);

const userGameProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    username: { type: String, required: true, trim: true },
    displayName: { type: String, trim: true, default: "" },
    avatarUrl: { type: String, trim: true, default: "" },
    coins: { type: Number, default: 250 },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    statsByGame: { type: Map, of: statsSchema, default: {} },
    achievements: { type: [achievementProgressSchema], default: [] },
    dailyReward: { type: dailyRewardSchema, default: () => ({}) },
    offlineSyncCursor: { type: Date, default: null },
  },
  { timestamps: true }
);

userGameProfileSchema.index({ xp: -1, coins: -1 });

module.exports = mongoose.model("UserGameProfile", userGameProfileSchema);
