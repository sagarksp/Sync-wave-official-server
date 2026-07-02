const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true, trim: true },
    displayName: { type: String, trim: true, default: "" },
    avatarUrl: { type: String, trim: true, default: "" },
    socketId: { type: String, default: "" },
    role: { type: String, enum: ["host", "player", "spectator"], default: "player" },
    seat: { type: Number, default: 0 },
    status: { type: String, enum: ["connected", "disconnected", "left"], default: "connected" },
    joinedAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const gameRoomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    gameId: { type: String, required: true, index: true },
    mode: { type: String, enum: ["public", "private", "invite"], default: "public", index: true },
    status: {
      type: String,
      enum: ["waiting", "matched", "playing", "finished", "abandoned"],
      default: "waiting",
      index: true,
    },
    maxPlayers: { type: Number, min: 2, max: 4, default: 2 },
    hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    players: { type: [playerSchema], default: [] },
    spectators: { type: [playerSchema], default: [] },
    invitedUserIds: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },
    gameState: { type: mongoose.Schema.Types.Mixed, default: {} },
    turnUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    version: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 1000 * 60 * 60 * 6), index: true },
  },
  { timestamps: true }
);

gameRoomSchema.index({ gameId: 1, status: 1, mode: 1, updatedAt: -1 });
gameRoomSchema.index({ "players.userId": 1, status: 1 });

module.exports = mongoose.model("GameRoom", gameRoomSchema);
