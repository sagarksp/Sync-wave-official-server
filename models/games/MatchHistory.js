const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, trim: true, default: "" },
    displayName: { type: String, trim: true, default: "" },
    avatarUrl: { type: String, trim: true, default: "" },
    result: { type: String, enum: ["win", "loss", "draw", "abandoned"], required: true },
    score: { type: Number, default: 0 },
    xpEarned: { type: Number, default: 0 },
    coinsEarned: { type: Number, default: 0 },
  },
  { _id: false }
);

const matchHistorySchema = new mongoose.Schema(
  {
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: "GameRoom", default: null },
    roomCode: { type: String, trim: true, uppercase: true, default: "" },
    gameId: { type: String, required: true, index: true },
    mode: { type: String, enum: ["online", "offline"], default: "online", index: true },
    status: { type: String, enum: ["finished", "abandoned", "draw"], default: "finished" },
    participants: { type: [participantSchema], required: true },
    winnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    durationSeconds: { type: Number, default: 0 },
    finalState: { type: mongoose.Schema.Types.Mixed, default: {} },
    endedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

matchHistorySchema.index({ "participants.userId": 1, endedAt: -1 });
matchHistorySchema.index({ gameId: 1, endedAt: -1 });

module.exports = mongoose.model("MatchHistory", matchHistorySchema);
