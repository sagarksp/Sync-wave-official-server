const jwt = require("jsonwebtoken");
const GameRoom = require("../../models/games/GameRoom");
const User = require("../../models/User");
const { JWT_SECRET } = require("../../middleware/auth");
const { findGame } = require("../../seed/games");

const matchmakingQueues = new Map();

function socketUser(socket) {
  return socket.user || socket.gameUser || null;
}

function roomPayload(room) {
  return {
    id: room._id.toString(),
    code: room.code,
    gameId: room.gameId,
    mode: room.mode,
    status: room.status,
    maxPlayers: room.maxPlayers,
    players: room.players,
    spectators: room.spectators,
    gameState: room.gameState || {},
    turnUserId: room.turnUserId ? room.turnUserId.toString() : "",
    version: room.version,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    updatedAt: room.updatedAt,
  };
}

function publicPlayer(user, role, socketId) {
  return {
    userId: user._id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || "",
    socketId,
    role,
    seat: 0,
    status: "connected",
    joinedAt: new Date(),
    lastSeenAt: new Date(),
  };
}

async function attachSocketUser(socket) {
  if (socket.user) return socket.user;
  const token = socket.handshake.auth?.token;
  if (!token) return null;
  const payload = jwt.verify(token, JWT_SECRET);
  const user = await User.findById(payload.userId).select("-passwordHash");
  if (!user || (payload.authVersion || 0) !== (user.authVersion || 0)) return null;
  socket.gameUser = user;
  return user;
}

async function updateConnection(room, userId, socketId, status) {
  let changed = false;
  room.players = room.players.map((player) => {
    if (player.userId.toString() !== userId.toString()) return player;
    changed = true;
    return { ...(player.toObject?.() || player), socketId, status, lastSeenAt: new Date() };
  });
  room.spectators = room.spectators.map((player) => {
    if (player.userId.toString() !== userId.toString()) return player;
    changed = true;
    return { ...(player.toObject?.() || player), socketId, status, lastSeenAt: new Date() };
  });
  if (changed) {
    room.version += 1;
    await room.save();
  }
  return changed;
}

async function findOrCreateMatch(gameId, user, socketId) {
  const game = findGame(gameId);
  if (!game || game.category !== "online") throw new Error("Online game not supported");
  const maxPlayers = gameId === "ludo-online" ? 4 : 2;
  const openRoom = await GameRoom.findOne({
    gameId,
    mode: "public",
    status: { $in: ["waiting", "matched"] },
    "players.userId": { $ne: user._id },
  }).sort({ updatedAt: 1 });
  if (openRoom && openRoom.players.length < openRoom.maxPlayers) {
    openRoom.players.push({ ...publicPlayer(user, "player", socketId), seat: openRoom.players.length });
    if (openRoom.players.length >= openRoom.maxPlayers) openRoom.status = "matched";
    openRoom.version += 1;
    await openRoom.save();
    return openRoom;
  }
  const code = `${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-4)}`.toUpperCase();
  return GameRoom.create({
    code,
    gameId,
    mode: "public",
    maxPlayers,
    hostUserId: user._id,
    players: [{ ...publicPlayer(user, "host", socketId), seat: 0 }],
    status: "waiting",
    gameState: {},
  });
}

function registerGamesSocket(io) {
  io.on("connection", async (socket) => {
    try {
      await attachSocketUser(socket);
    } catch (err) {
      return;
    }

    socket.on("games_matchmaking", async ({ gameId } = {}, ack) => {
      try {
        const user = socketUser(socket);
        if (!user) return ack?.({ ok: false, error: "Missing session" });
        const room = await findOrCreateMatch(String(gameId || ""), user, socket.id);
        socket.join(room.code);
        const payload = roomPayload(room);
        io.to(room.code).emit("games_room_update", payload);
        if (room.status === "matched") io.to(room.code).emit("games_match_ready", payload);
        ack?.({ ok: true, room: payload });
      } catch (err) {
        ack?.({ ok: false, error: err.message || "Matchmaking failed" });
      }
    });

    socket.on("games_join_room", async ({ code, spectator } = {}, ack) => {
      try {
        const user = socketUser(socket);
        if (!user) return ack?.({ ok: false, error: "Missing session" });
        const room = await GameRoom.findOne({ code: String(code || "").trim().toUpperCase() });
        if (!room) return ack?.({ ok: false, error: "Room not found" });
        const userId = user._id.toString();
        const isPlayer = room.players.some((player) => player.userId.toString() === userId);
        const isSpectator = room.spectators.some((player) => player.userId.toString() === userId);
        if (isPlayer || isSpectator) {
          await updateConnection(room, user._id, socket.id, "connected");
        } else if (spectator || room.players.length >= room.maxPlayers || room.status === "playing") {
          room.spectators.push(publicPlayer(user, "spectator", socket.id));
        } else {
          room.players.push({ ...publicPlayer(user, "player", socket.id), seat: room.players.length });
          if (room.players.length >= room.maxPlayers) room.status = "matched";
        }
        room.version += 1;
        await room.save();
        socket.join(room.code);
        const payload = roomPayload(room);
        io.to(room.code).emit("games_room_update", payload);
        ack?.({ ok: true, room: payload });
      } catch (err) {
        ack?.({ ok: false, error: "Unable to join room" });
      }
    });

    socket.on("games_reconnect_room", async ({ code } = {}, ack) => {
      try {
        const user = socketUser(socket);
        const room = await GameRoom.findOne({ code: String(code || "").trim().toUpperCase() });
        if (!user || !room) return ack?.({ ok: false, error: "Room not found" });
        await updateConnection(room, user._id, socket.id, "connected");
        socket.join(room.code);
        const fresh = await GameRoom.findById(room._id);
        const payload = roomPayload(fresh);
        socket.emit("games_state_sync", payload);
        io.to(room.code).emit("games_room_update", payload);
        ack?.({ ok: true, room: payload });
      } catch (err) {
        ack?.({ ok: false, error: "Reconnect failed" });
      }
    });

    socket.on("games_state_patch", async ({ code, patch, turnUserId } = {}, ack) => {
      try {
        const user = socketUser(socket);
        const room = await GameRoom.findOne({ code: String(code || "").trim().toUpperCase(), status: { $in: ["matched", "playing"] } });
        if (!user || !room) return ack?.({ ok: false, error: "Room not found" });
        const participant = room.players.some((player) => player.userId.toString() === user._id.toString());
        if (!participant) return ack?.({ ok: false, error: "Only players can update game state" });
        room.status = "playing";
        room.startedAt = room.startedAt || new Date();
        room.gameState = { ...(room.gameState || {}), ...(patch && typeof patch === "object" ? patch : {}) };
        room.turnUserId = turnUserId || room.turnUserId || null;
        room.version += 1;
        await room.save();
        const payload = roomPayload(room);
        socket.to(room.code).emit("games_state_sync", payload);
        ack?.({ ok: true, room: payload });
      } catch (err) {
        ack?.({ ok: false, error: "State sync failed" });
      }
    });

    socket.on("games_invite_friend", async ({ code, friendUserId } = {}, ack) => {
      try {
        const user = socketUser(socket);
        const room = await GameRoom.findOne({ code: String(code || "").trim().toUpperCase() });
        if (!user || !room) return ack?.({ ok: false, error: "Room not found" });
        if (!room.invitedUserIds.some((id) => id.toString() === String(friendUserId))) {
          room.invitedUserIds.push(friendUserId);
          await room.save();
        }
        io.to(String(friendUserId)).emit("games_room_invite", {
          from: { userId: user._id.toString(), displayName: user.displayName || user.username, avatarUrl: user.avatarUrl || "" },
          room: roomPayload(room),
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: "Invite failed" });
      }
    });

    socket.on("disconnect", async () => {
      const user = socketUser(socket);
      if (!user) return;
      const rooms = await GameRoom.find({
        status: { $in: ["waiting", "matched", "playing"] },
        $or: [{ "players.userId": user._id }, { "spectators.userId": user._id }],
      }).limit(8);
      await Promise.all(rooms.map(async (room) => {
        await updateConnection(room, user._id, "", "disconnected");
        const fresh = await GameRoom.findById(room._id);
        if (fresh) io.to(fresh.code).emit("games_room_update", roomPayload(fresh));
      }));
    });
  });
}

module.exports = { registerGamesSocket };
