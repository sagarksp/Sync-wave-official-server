const crypto = require("crypto");
const Achievement = require("../../models/games/Achievement");
const GameRoom = require("../../models/games/GameRoom");
const Leaderboard = require("../../models/games/Leaderboard");
const MatchHistory = require("../../models/games/MatchHistory");
const UserGameProfile = require("../../models/games/UserGameProfile");
const { achievements: achievementSeeds, findGame, gamesCatalog } = require("../../seed/games");

function publicPlayer(user, role = "player", socketId = "") {
  return {
    userId: user._id,
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || "",
    socketId,
    role,
    status: "connected",
    joinedAt: new Date(),
    lastSeenAt: new Date(),
  };
}

function levelForXp(xp) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 125)) + 1);
}

function roomCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function cleanGameState(value) {
  if (!value || typeof value !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return {};
  }
}

function publicRoom(room) {
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

async function ensureAchievements() {
  await Promise.all(achievementSeeds.map((seed) => Achievement.updateOne(
    { key: seed.key },
    { $setOnInsert: seed },
    { upsert: true }
  )));
}

async function getOrCreateProfile(user) {
  const userId = user._id || user.userId;
  const update = {
    $set: {
      username: user.username,
      displayName: user.displayName || user.username,
      avatarUrl: user.avatarUrl || "",
    },
    $setOnInsert: {
      coins: 250,
      xp: 0,
      level: 1,
      statsByGame: {},
      achievements: [],
      dailyReward: {},
    },
  };
  return UserGameProfile.findOneAndUpdate({ userId }, update, { upsert: true, new: true });
}

function profilePayload(profile) {
  const statsByGame = {};
  if (profile.statsByGame?.forEach) {
    profile.statsByGame.forEach((value, key) => {
      const total = value.totalGamesPlayed || 0;
      statsByGame[key] = {
        wins: value.wins || 0,
        losses: value.losses || 0,
        draws: value.draws || 0,
        winRate: total ? Math.round(((value.wins || 0) / total) * 100) : 0,
        totalGamesPlayed: total,
        winStreak: value.winStreak || 0,
        bestScore: value.bestScore || 0,
        lastPlayedAt: value.lastPlayedAt || null,
      };
    });
  }
  return {
    userId: profile.userId.toString(),
    username: profile.username,
    displayName: profile.displayName || profile.username,
    avatarUrl: profile.avatarUrl || "",
    coins: profile.coins,
    xp: profile.xp,
    level: profile.level,
    statsByGame,
    achievements: profile.achievements || [],
    dailyReward: profile.dailyReward || {},
  };
}

async function updateProfileForResult(userLike, gameId, result, score, reward) {
  const profile = await getOrCreateProfile(userLike);
  const current = profile.statsByGame.get(gameId) || {};
  const wins = (current.wins || 0) + (result === "win" ? 1 : 0);
  const losses = (current.losses || 0) + (result === "loss" ? 1 : 0);
  const draws = (current.draws || 0) + (result === "draw" ? 1 : 0);
  const totalGamesPlayed = (current.totalGamesPlayed || 0) + 1;
  const winStreak = result === "win" ? (current.winStreak || 0) + 1 : 0;
  const bestScore = Math.max(current.bestScore || 0, Number(score) || 0);
  profile.statsByGame.set(gameId, { wins, losses, draws, totalGamesPlayed, winStreak, bestScore, lastPlayedAt: new Date() });
  profile.coins = Math.max(0, (profile.coins || 0) + reward.coins);
  profile.xp = Math.max(0, (profile.xp || 0) + reward.xp);
  profile.level = levelForXp(profile.xp);

  const unlocked = [];
  const allStats = Array.from(profile.statsByGame.values()).reduce((acc, item) => ({
    wins: acc.wins + (item.wins || 0),
    losses: acc.losses + (item.losses || 0),
    draws: acc.draws + (item.draws || 0),
    totalGamesPlayed: acc.totalGamesPlayed + (item.totalGamesPlayed || 0),
    winStreak: Math.max(acc.winStreak, item.winStreak || 0),
    bestScore: Math.max(acc.bestScore, item.bestScore || 0),
  }), { wins: 0, losses: 0, draws: 0, totalGamesPlayed: 0, winStreak: 0, bestScore: 0 });
  const achievements = await Achievement.find({ active: true, gameId: { $in: ["all", gameId] } }).lean();
  achievements.forEach((achievement) => {
    const existing = profile.achievements.find((item) => item.key === achievement.key);
    const gameStats = profile.statsByGame.get(achievement.gameId === "all" ? gameId : achievement.gameId) || {};
    const stats = achievement.gameId === "all" ? allStats : gameStats;
    const progress = Math.max(0, Number(stats[achievement.trigger.metric]) || 0);
    if (existing) {
      existing.progress = Math.max(existing.progress || 0, progress);
      if (!existing.unlocked && progress >= achievement.trigger.target) {
        existing.unlocked = true;
        existing.unlockedAt = new Date();
        profile.coins += achievement.reward.coins || 0;
        profile.xp += achievement.reward.xp || 0;
        unlocked.push(achievement);
      }
      return;
    }
    const entry = { key: achievement.key, progress, unlocked: progress >= achievement.trigger.target, unlockedAt: null };
    if (entry.unlocked) {
      entry.unlockedAt = new Date();
      profile.coins += achievement.reward.coins || 0;
      profile.xp += achievement.reward.xp || 0;
      unlocked.push(achievement);
    }
    profile.achievements.push(entry);
  });
  profile.level = levelForXp(profile.xp);
  await profile.save();

  const ratingDelta = result === "win" ? 18 : result === "loss" ? -12 : 4;
  await Leaderboard.findOneAndUpdate(
    { userId: profile.userId, gameId, scope: "global" },
    {
      $set: {
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        lastMatchAt: new Date(),
      },
      $inc: {
        wins: result === "win" ? 1 : 0,
        losses: result === "loss" ? 1 : 0,
        draws: result === "draw" ? 1 : 0,
        totalGamesPlayed: 1,
        xp: reward.xp,
        coins: reward.coins,
        rating: ratingDelta,
      },
    },
    { upsert: true, new: true }
  );
  return { profile, unlocked };
}

async function getHome(req, res) {
  await ensureAchievements();
  const profile = await getOrCreateProfile(req.user);
  const history = await MatchHistory.find({ "participants.userId": req.user._id }).sort({ endedAt: -1 }).limit(12).lean();
  const achievements = await Achievement.find({ active: true }).sort({ gameId: 1, key: 1 }).lean();
  res.json({
    catalog: gamesCatalog,
    featured: gamesCatalog.filter((game) => game.featured),
    online: gamesCatalog.filter((game) => game.category === "online"),
    offline: gamesCatalog.filter((game) => game.category === "offline"),
    trending: [...gamesCatalog].sort((a, b) => b.trendingScore - a.trendingScore).slice(0, 8),
    recentlyPlayed: history.map((match) => ({ gameId: match.gameId, endedAt: match.endedAt, status: match.status })).slice(0, 8),
    profile: profilePayload(profile),
    achievements,
  });
}

async function createRoom(req, res) {
  const gameId = String(req.body.gameId || "").trim();
  const game = findGame(gameId);
  if (!game || game.category !== "online") return res.status(400).json({ error: "Online game not supported" });
  const maxPlayers = Math.max(2, Math.min(Number(req.body.maxPlayers) || (gameId === "ludo-online" ? 4 : 2), 4));
  let code = roomCode();
  while (await GameRoom.exists({ code })) code = roomCode();
  const room = await GameRoom.create({
    code,
    gameId,
    mode: req.body.private ? "private" : "public",
    maxPlayers,
    hostUserId: req.user._id,
    players: [{ ...publicPlayer(req.user, "host"), seat: 0 }],
    gameState: cleanGameState(req.body.initialState),
  });
  req.app.get("io")?.to(req.user._id.toString()).emit("games_room_update", publicRoom(room));
  res.status(201).json({ room: publicRoom(room) });
}

async function joinRoom(req, res) {
  const code = String(req.body.code || req.params.code || "").trim().toUpperCase();
  const asSpectator = Boolean(req.body.spectator);
  const room = await GameRoom.findOne({ code, status: { $in: ["waiting", "matched", "playing"] } });
  if (!room) return res.status(404).json({ error: "Room not found" });
  const alreadyPlayer = room.players.some((player) => player.userId.toString() === req.user._id.toString());
  const alreadySpectator = room.spectators.some((player) => player.userId.toString() === req.user._id.toString());
  if (!alreadyPlayer && !alreadySpectator) {
    if (asSpectator || room.players.length >= room.maxPlayers || room.status === "playing") {
      room.spectators.push(publicPlayer(req.user, "spectator"));
    } else {
      room.players.push({ ...publicPlayer(req.user, "player"), seat: room.players.length });
      if (room.players.length >= room.maxPlayers) room.status = "matched";
    }
  }
  room.version += 1;
  await room.save();
  const payload = publicRoom(room);
  req.app.get("io")?.to(room.code).emit("games_room_update", payload);
  res.json({ room: payload });
}

async function leaveRoom(req, res) {
  const room = await GameRoom.findOne({ code: String(req.params.code || req.body.code || "").trim().toUpperCase() });
  if (!room) return res.status(404).json({ error: "Room not found" });
  room.players = room.players.map((player) => (
    player.userId.toString() === req.user._id.toString() ? { ...(player.toObject?.() || player), status: "left", lastSeenAt: new Date() } : player
  ));
  room.spectators = room.spectators.filter((player) => player.userId.toString() !== req.user._id.toString());
  if (!room.players.some((player) => player.status !== "left")) room.status = "abandoned";
  room.version += 1;
  await room.save();
  const payload = publicRoom(room);
  req.app.get("io")?.to(room.code).emit("games_room_update", payload);
  res.json({ room: payload });
}

async function startMatch(req, res) {
  const room = await GameRoom.findOne({ code: String(req.params.code || req.body.code || "").trim().toUpperCase() });
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.hostUserId.toString() !== req.user._id.toString()) return res.status(403).json({ error: "Only the host can start this match" });
  if (room.players.filter((player) => player.status !== "left").length < 2) return res.status(400).json({ error: "At least two players are required" });
  room.status = "playing";
  room.startedAt = room.startedAt || new Date();
  room.turnUserId = room.players[0]?.userId || null;
  room.gameState = cleanGameState(req.body.gameState);
  room.version += 1;
  await room.save();
  const payload = publicRoom(room);
  req.app.get("io")?.to(room.code).emit("games_match_started", payload);
  res.json({ room: payload });
}

async function endMatch(req, res) {
  const room = await GameRoom.findOne({ code: String(req.params.code || req.body.code || "").trim().toUpperCase() });
  if (!room) return res.status(404).json({ error: "Room not found" });
  const winnerUserId = req.body.winnerUserId || null;
  const scores = req.body.scores && typeof req.body.scores === "object" ? req.body.scores : {};
  const game = findGame(room.gameId) || { coins: 16, xp: 24 };
  const participants = [];
  const rewardResults = [];
  for (const player of room.players.filter((item) => item.status !== "left")) {
    const isWinner = winnerUserId && player.userId.toString() === String(winnerUserId);
    const isDraw = !winnerUserId || req.body.result === "draw";
    const result = isDraw ? "draw" : isWinner ? "win" : "loss";
    const reward = {
      coins: result === "win" ? game.coins : result === "draw" ? Math.ceil(game.coins * 0.6) : Math.ceil(game.coins * 0.35),
      xp: result === "win" ? game.xp : result === "draw" ? Math.ceil(game.xp * 0.7) : Math.ceil(game.xp * 0.45),
    };
    const score = Number(scores[player.userId.toString()]) || 0;
    participants.push({ ...(player.toObject?.() || player), result, score, xpEarned: reward.xp, coinsEarned: reward.coins });
    rewardResults.push(updateProfileForResult(player, room.gameId, result, score, reward));
  }
  const profileUpdates = await Promise.all(rewardResults);
  room.status = "finished";
  room.finishedAt = new Date();
  room.gameState = cleanGameState(req.body.finalState);
  room.version += 1;
  await room.save();
  const match = await MatchHistory.create({
    roomId: room._id,
    roomCode: room.code,
    gameId: room.gameId,
    mode: "online",
    status: winnerUserId ? "finished" : "draw",
    participants,
    winnerUserId,
    durationSeconds: room.startedAt ? Math.max(0, Math.round((Date.now() - room.startedAt.getTime()) / 1000)) : 0,
    finalState: cleanGameState(req.body.finalState),
  });
  const payload = { room: publicRoom(room), match, unlocked: profileUpdates.flatMap((item) => item.unlocked) };
  req.app.get("io")?.to(room.code).emit("games_match_ended", payload);
  res.json(payload);
}

async function getLeaderboard(req, res) {
  const gameId = String(req.query.gameId || "all");
  const query = gameId === "all" ? {} : { gameId };
  const rows = await Leaderboard.find({ ...query, scope: "global" }).sort({ rating: -1, xp: -1 }).limit(50).lean();
  res.json({ leaderboard: rows.map((row, index) => ({ ...row, rank: index + 1, winRate: row.totalGamesPlayed ? Math.round((row.wins / row.totalGamesPlayed) * 100) : 0 })) });
}

async function getMatchHistory(req, res) {
  const gameId = String(req.query.gameId || "");
  const query = { "participants.userId": req.user._id };
  if (gameId) query.gameId = gameId;
  const history = await MatchHistory.find(query).sort({ endedAt: -1 }).limit(60).lean();
  res.json({ history });
}

async function claimRewards(req, res) {
  const profile = await getOrCreateProfile(req.user);
  const now = new Date();
  const last = profile.dailyReward?.lastClaimedAt ? new Date(profile.dailyReward.lastClaimedAt) : null;
  const sameDay = last && last.toDateString() === now.toDateString();
  if (sameDay) return res.status(409).json({ error: "Daily reward already claimed", profile: profilePayload(profile) });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const streak = last && last.toDateString() === yesterday.toDateString() ? (profile.dailyReward?.streak || 0) + 1 : 1;
  const coins = 50 + Math.min(streak, 7) * 10;
  const xp = 70 + Math.min(streak, 7) * 15;
  profile.coins += coins;
  profile.xp += xp;
  profile.level = levelForXp(profile.xp);
  profile.dailyReward = { streak, lastClaimedAt: now };
  await profile.save();
  res.json({ reward: { coins, xp, streak }, profile: profilePayload(profile) });
}

async function syncOffline(req, res) {
  const matches = Array.isArray(req.body.matches) ? req.body.matches.slice(0, 50) : [];
  const created = [];
  const unlocked = [];
  for (const item of matches) {
    const game = findGame(item.gameId);
    if (!game || game.category !== "offline") continue;
    const existing = item.localId ? await MatchHistory.exists({ roomCode: `OFF-${item.localId}`, "participants.userId": req.user._id }) : null;
    if (existing) continue;
    const result = ["win", "loss", "draw"].includes(item.result) ? item.result : "win";
    const reward = {
      coins: result === "win" ? game.coins : Math.ceil(game.coins * 0.5),
      xp: result === "win" ? game.xp : Math.ceil(game.xp * 0.6),
    };
    const update = await updateProfileForResult(req.user, game.id, result, Number(item.score) || 0, reward);
    unlocked.push(...update.unlocked);
    const match = await MatchHistory.create({
      roomCode: `OFF-${String(item.localId || Date.now()).slice(0, 32)}`,
      gameId: game.id,
      mode: "offline",
      status: result === "draw" ? "draw" : "finished",
      participants: [{
        userId: req.user._id,
        username: req.user.username,
        displayName: req.user.displayName || req.user.username,
        avatarUrl: req.user.avatarUrl || "",
        result,
        score: Number(item.score) || 0,
        xpEarned: reward.xp,
        coinsEarned: reward.coins,
      }],
      winnerUserId: result === "win" ? req.user._id : null,
      durationSeconds: Number(item.durationSeconds) || 0,
      finalState: cleanGameState(item.finalState),
      endedAt: item.endedAt ? new Date(item.endedAt) : new Date(),
    });
    created.push(match);
  }
  const profile = await getOrCreateProfile(req.user);
  res.json({ synced: created.length, matches: created, unlocked, profile: profilePayload(profile) });
}

module.exports = {
  claimRewards,
  createRoom,
  endMatch,
  getHome,
  getLeaderboard,
  getMatchHistory,
  joinRoom,
  leaveRoom,
  startMatch,
  syncOffline,
};
