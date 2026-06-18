require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fetch = require("node-fetch");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("./models/User");
const Message = require("./models/Message");
const Playlist = require("./models/Playlist");
const { authRequired, signToken, JWT_SECRET } = require("./middleware/auth");

const app = express();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const MONGO_URI = process.env.MONGO_URI;

app.use(cors({ origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN.split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN.split(","), methods: ["GET", "POST"] },
  maxHttpBufferSize: 4 * 1024 * 1024,
});

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

const SAAVN_BASE = "https://saavn.sumit.co";
const TURN_URLS = (process.env.TURN_URLS || "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);
const TURN_USERNAME = process.env.TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || "";

function callIceServers() {
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }];
  if (TURN_URLS.length && TURN_USERNAME && TURN_CREDENTIAL) {
    servers.push({ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
  }
  return servers;
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    displayName: user.displayName || user.username,
    avatarUrl: user.avatarUrl || "",
    maxDevices: user.maxDevices,
    activeDevices: user.activeDevices,
    createdAt: user.createdAt,
  };
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");
    if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const exists = await User.exists({ username });
    if (exists) return res.status(409).json({ error: "Username already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, displayName: username, passwordHash });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || "");
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "Invalid username or password" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password" });

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/session", authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch("/api/profile", authRequired, async (req, res) => {
  const displayName = String(req.body.displayName || "").trim().slice(0, 60);
  const avatarUrl = String(req.body.avatarUrl || "").trim().slice(0, 1000);
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: { displayName: displayName || req.user.username, avatarUrl } },
    { new: true }
  );
  res.json({ user: publicUser(user) });
});

app.post("/api/profile/password", authRequired, async (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const nextPassword = String(req.body.nextPassword || "");
  if (nextPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  const user = await User.findById(req.user._id);
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
  user.passwordHash = await bcrypt.hash(nextPassword, 12);
  user.authVersion = (user.authVersion || 0) + 1;
  user.activeDevices = [];
  await user.save();
  io.to(req.user._id.toString()).emit("force_logout", { reason: "password_changed" });
  res.json({ ok: true });
});

app.get("/api/call/config", authRequired, (req, res) => {
  res.json({ iceServers: callIceServers() });
});

app.post("/api/auth/logout", authRequired, async (req, res) => {
  const deviceId = String(req.body.deviceId || "");
  if (deviceId) {
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { activeDevices: { deviceId } } }
    );
  }
  res.json({ ok: true });
});

app.get("/api/messages", authRequired, async (req, res) => {
  const messages = await Message.find({ accountId: req.user._id }).sort({ timestamp: -1 }).limit(80).lean();
  res.json({ messages: messages.reverse() });
});

function publicPlaylist(playlist) {
  return {
    id: playlist._id.toString(),
    ownerAccountId: playlist.ownerAccountId.toString(),
    name: playlist.name,
    songs: playlist.songs || [],
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
  };
}

function cleanPlaylistName(name) {
  return String(name || "New Playlist").trim().slice(0, 80) || "New Playlist";
}

function cleanSong(song) {
  if (!song?.id) return null;
  return {
    id: String(song.id),
    title: String(song.title || "Unknown").slice(0, 160),
    artist: String(song.artist || "").slice(0, 160),
    album: String(song.album || "").slice(0, 160),
    duration: Number(song.duration) || 0,
    cover: String(song.cover || "").slice(0, 1000),
    streamUrl: String(song.streamUrl || "").slice(0, 1200),
    language: String(song.language || "").slice(0, 80),
    year: String(song.year || "").slice(0, 20),
  };
}

app.get("/api/playlists", authRequired, async (req, res) => {
  const playlists = await Playlist.find({ ownerAccountId: req.user._id }).sort({ updatedAt: -1 }).lean();
  res.json({ playlists: playlists.map(publicPlaylist) });
});

app.post("/api/playlists", authRequired, async (req, res) => {
  const songs = Array.isArray(req.body.songs) ? req.body.songs.map(cleanSong).filter(Boolean).slice(0, 500) : [];
  const playlist = await Playlist.create({
    ownerAccountId: req.user._id,
    name: cleanPlaylistName(req.body.name),
    songs,
    updatedAt: new Date(),
  });
  res.status(201).json({ playlist: publicPlaylist(playlist) });
});

app.patch("/api/playlists/:id", authRequired, async (req, res) => {
  const patch = { updatedAt: new Date() };
  if (Object.prototype.hasOwnProperty.call(req.body, "name")) patch.name = cleanPlaylistName(req.body.name);
  if (Object.prototype.hasOwnProperty.call(req.body, "songs")) {
    patch.songs = Array.isArray(req.body.songs) ? req.body.songs.map(cleanSong).filter(Boolean).slice(0, 500) : [];
  }

  const playlist = await Playlist.findOneAndUpdate(
    { _id: req.params.id, ownerAccountId: req.user._id },
    { $set: patch },
    { new: true }
  ).lean();
  if (!playlist) return res.status(404).json({ error: "Playlist not found" });
  res.json({ playlist: publicPlaylist(playlist) });
});

app.delete("/api/playlists/:id", authRequired, async (req, res) => {
  const deleted = await Playlist.findOneAndDelete({ _id: req.params.id, ownerAccountId: req.user._id }).lean();
  if (!deleted) return res.status(404).json({ error: "Playlist not found" });
  res.json({ ok: true });
});

app.post("/api/auth/logout-all", authRequired, async (req, res) => {
  await User.updateOne(
    { _id: req.user._id },
    { $inc: { authVersion: 1 }, $set: { activeDevices: [] } }
  );
  io.to(req.user._id.toString()).emit("force_logout", { reason: "logout_all" });
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  try {
    const { q, limit = 20, page = 0 } = req.query;
    if (!q) return res.status(400).json({ error: "query required" });

    const url = `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(q)}&limit=${limit}&page=${page}`;
    const response = await fetch(url, { headers: { "User-Agent": "SyncWave/1.0" } });
    const data = await response.json();
    const songs = (data.data?.results || []).map(formatSong).filter(Boolean);
    res.json({ results: songs, total: data.data?.total || songs.length });
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed", details: err.message });
  }
});

app.get("/api/song/:id", async (req, res) => {
  try {
    const url = `${SAAVN_BASE}/api/songs/${req.params.id}`;
    const response = await fetch(url, { headers: { "User-Agent": "SyncWave/1.0" } });
    const data = await response.json();
    if (!data.data || !data.data[0]) return res.status(404).json({ error: "not found" });
    res.json(formatSong(data.data[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/download/:id", authRequired, async (req, res, next) => {
  if (req.params.id === "proxy") return next();
  try {
    const url = `${SAAVN_BASE}/api/songs/${req.params.id}`;
    const response = await fetch(url, { headers: { "User-Agent": "SyncWave/1.0" } });
    const data = await response.json();
    if (!data.data || !data.data[0]) return res.status(404).json({ error: "Song not found" });
    const song = formatSong(data.data[0]);
    if (!song?.streamUrl) return res.status(404).json({ error: "Download URL unavailable" });
    res.json({
      song,
      downloadUrl: `/api/download/proxy?url=${encodeURIComponent(song.streamUrl)}&songId=${encodeURIComponent(song.id)}`,
    });
  } catch (err) {
    res.status(500).json({ error: "Download lookup failed" });
  }
});

app.get("/api/download/proxy", authRequired, async (req, res) => {
  try {
    const rawUrl = String(req.query.url || "");
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "Invalid download URL" });
    const host = parsed.hostname.toLowerCase();
    const allowedAudioHost = host === "saavncdn.com" || host.endsWith(".saavncdn.com") || host === "jiosaavn.com" || host.endsWith(".jiosaavn.com");
    if (!allowedAudioHost) return res.status(403).json({ error: "Download host not allowed" });

    const response = await fetch(rawUrl, { headers: { "User-Agent": "SyncWave/1.0" } });
    if (!response.ok) return res.status(response.status).json({ error: "Download source failed" });

    const filename = `syncwave-${String(req.query.songId || "song").replace(/[^a-z0-9_-]/gi, "") || "song"}.mp3`;
    res.setHeader("Content-Type", response.headers.get("content-type") || "audio/mpeg");
    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.body.pipe(res);
  } catch (err) {
    res.status(400).json({ error: "Unable to download song" });
  }
});

app.get("/api/trending", async (req, res) => {
  try {
    const queries = ["arijit singh 2024", "trending hindi", "top english hits"];
    const pick = queries[Math.floor(Math.random() * queries.length)];
    const url = `${SAAVN_BASE}/api/search/songs?query=${encodeURIComponent(pick)}&limit=20&page=0`;
    const response = await fetch(url, { headers: { "User-Agent": "SyncWave/1.0" } });
    const data = await response.json();
    const songs = (data.data?.results || []).map(formatSong).filter(Boolean);
    res.json({ results: songs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/search/albums", async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;
    const url = `${SAAVN_BASE}/api/search/albums?query=${encodeURIComponent(q)}&limit=${limit}`;
    const response = await fetch(url, { headers: { "User-Agent": "SyncWave/1.0" } });
    const data = await response.json();
    res.json({ results: data.data?.results || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/album/:id", async (req, res) => {
  try {
    const url = `${SAAVN_BASE}/api/albums?id=${req.params.id}`;
    const response = await fetch(url, { headers: { "User-Agent": "SyncWave/1.0" } });
    const data = await response.json();
    const songs = (data.data?.songs || []).map(formatSong).filter(Boolean);
    res.json({ songs, name: data.data?.name, image: data.data?.image?.[2]?.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function formatSong(s) {
  if (!s) return null;
  const urls = s.downloadUrl || [];
  const streamUrl =
    urls.find((u) => u.quality === "320kbps")?.url ||
    urls.find((u) => u.quality === "160kbps")?.url ||
    urls.find((u) => u.quality === "96kbps")?.url ||
    urls[urls.length - 1]?.url ||
    null;

  const artists = (s.artists?.primary || []).map((a) => a.name).join(", ") || s.artistMap?.primary_artists || "Unknown";
  const image = s.image?.[2]?.url || s.image?.[1]?.url || s.image?.[0]?.url || "";

  return {
    id: s.id,
    title: s.name || s.title || "Unknown",
    artist: artists,
    album: s.album?.name || s.album || "",
    duration: parseInt(s.duration, 10) || 0,
    cover: image,
    streamUrl,
    audioUrl: streamUrl,
    mediaUrl: streamUrl,
    downloadUrl: streamUrl,
    language: s.language || "",
    year: s.year || "",
  };
}

const sessions = {};

function getOrCreateSession(accountId) {
  if (!sessions[accountId]) {
    sessions[accountId] = {
      state: {
        currentSong: null,
        isPlaying: false,
        positionAtPlay: 0,
        startedAt: null,
        volume: 80,
        queue: [],
        syncEnabled: true,
        version: 0,
        lastAction: "INIT",
        lastActionId: 0,
      },
      devices: {},
      typing: {},
      calls: {},
    };
  }
  return sessions[accountId];
}

function getLivePosition(session) {
  const s = session.state;
  const base = Number(s.positionAtPlay) || 0;
  if (!s.isPlaying || !s.currentSong || !s.startedAt) return base;
  const elapsed = (Date.now() - s.startedAt) / 1000;
  return Math.min(base + elapsed, s.currentSong.duration || 9999);
}

function clampPosition(session, position) {
  const duration = session.state.currentSong?.duration || 9999;
  return Math.max(0, Math.min(Number(position) || 0, duration));
}

function setPlaybackCheckpoint(session, position, isPlaying = session.state.isPlaying) {
  session.state.positionAtPlay = clampPosition(session, position);
  session.state.startedAt = isPlaying ? Date.now() : null;
  session.state.isPlaying = Boolean(isPlaying);
}

function markStateAction(session, action, deviceId, deviceName) {
  session.state.version = (session.state.version || 0) + 1;
  session.state.lastAction = action;
  session.state.lastActionId = session.state.version;
  session.state.lastActionDeviceId = deviceId || "";
  session.state.lastActionDeviceName = deviceName || "";
}

function statePayload(session) {
  const serverTime = Date.now();
  const currentActivity = session.state.currentSong && session.state.isPlaying
    ? `Listening: ${session.state.currentSong.title}`
    : "Idle";
  return {
    ...session.state,
    position: getLivePosition(session),
    serverTime,
    devices: Object.values(session.devices).map((device) => ({
      ...device,
      currentActivity,
      lastSeen: device.lastSeen || device.joinedAt || serverTime,
    })),
  };
}

function emitState(accountId) {
  const session = sessions[accountId];
  if (!session) return;
  io.to(accountId).emit("state_update", statePayload(session));
}

function emitDeviceEvent(accountId, type, deviceName) {
  io.to(accountId).emit("device_event", {
    type,
    deviceName,
    message: type === "join" ? "New device connected" : "Device disconnected",
    timestamp: Date.now(),
  });
}

function callDevicePayload(deviceId, deviceName, socketId = "") {
  return {
    deviceId,
    socketId,
    deviceName: deviceName || "Unknown Device",
  };
}

function getTargetSocket(accountId, targetDeviceId) {
  const session = sessions[accountId];
  if (!session || !targetDeviceId) return null;
  const target = session.devices[targetDeviceId];
  if (!target?.socketId) return null;
  return target;
}

function emitToCallTarget(socket, accountId, targetDeviceId, event, payload, ack) {
  const target = getTargetSocket(accountId, targetDeviceId);
  if (!target) {
    ack?.({ ok: false, error: "Target device is offline" });
    socket.emit("call_unavailable", { targetDeviceId, callId: payload?.callId, reason: "Target device is offline" });
    console.log("[SyncWave Call]", event, "FAILED_TARGET_OFFLINE", { accountId, targetDeviceId, callId: payload?.callId });
    return false;
  }
  if (target.socketId === socket.id) {
    ack?.({ ok: false, error: "Cannot send call event to the same socket" });
    console.log("[SyncWave Call]", event, "FAILED_SELF_SOCKET", { accountId, targetDeviceId, socketId: socket.id });
    return false;
  }
  console.log("[SyncWave Call]", event, {
    accountId,
    from: payload.from?.deviceName,
    fromDeviceId: payload.from?.deviceId,
    fromSocketId: socket.id,
    targetDeviceId,
    targetSocketId: target.socketId,
    callId: payload.callId,
  });
  io.to(target.socketId).emit(event, payload);
  ack?.({ ok: true });
  return true;
}

function callLog(role, event, details) {
  console.log(`[${role}] ${event}`, details);
}

function isCurrentSocketForDevice(accountId, deviceId, socketId) {
  const current = getTargetSocket(accountId, deviceId);
  return Boolean(current?.socketId && current.socketId === socketId);
}

function getCallSession(accountId, callId) {
  const session = sessions[accountId];
  if (!session || !callId) return null;
  return session.calls?.[callId] || null;
}

function createCallSession(accountId, callId, caller, receiver) {
  const session = getOrCreateSession(accountId);
  session.calls[callId] = {
    callId,
    callerDeviceId: caller.deviceId,
    callerSocketId: caller.socketId,
    callerDeviceName: caller.deviceName,
    receiverDeviceId: receiver.deviceId,
    receiverSocketId: receiver.socketId,
    receiverDeviceName: receiver.deviceName,
    status: "ringing",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return session.calls[callId];
}

function touchCallSession(call, status) {
  if (!call) return null;
  call.status = status || call.status;
  call.updatedAt = Date.now();
  return call;
}

function endCallSession(accountId, callId) {
  if (sessions[accountId]?.calls?.[callId]) delete sessions[accountId].calls[callId];
}

function callPeerDeviceId(call, sourceDeviceId) {
  if (!call) return "";
  if (sourceDeviceId === call.callerDeviceId) return call.receiverDeviceId;
  if (sourceDeviceId === call.receiverDeviceId) return call.callerDeviceId;
  return "";
}

function validateCallParticipant(accountId, callId, sourceDeviceId, expectedTargetDeviceId, ack) {
  const call = getCallSession(accountId, callId);
  if (!call) {
    ack?.({ ok: false, error: "Call not found" });
    return null;
  }
  const peerDeviceId = callPeerDeviceId(call, sourceDeviceId);
  if (!peerDeviceId) {
    ack?.({ ok: false, error: "Device is not part of this call" });
    return null;
  }
  if (expectedTargetDeviceId && expectedTargetDeviceId !== peerDeviceId) {
    ack?.({ ok: false, error: "Call target does not match peer device" });
    return null;
  }
  return call;
}

async function markDeviceOffline(accountId, deviceId) {
  await User.updateOne(
    { _id: accountId, "activeDevices.deviceId": deviceId },
    {
      $set: {
        "activeDevices.$.online": false,
        "activeDevices.$.socketId": "",
        "activeDevices.$.lastSeen": new Date(),
      },
    }
  );
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Missing token"));
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.userId);
    if (!user) return next(new Error("Invalid session"));
    if ((payload.authVersion || 0) !== (user.authVersion || 0)) return next(new Error("Session expired"));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error("Invalid session"));
  }
});

io.on("connection", (socket) => {
  let currentAccountId = null;
  let currentDeviceId = null;
  let currentDeviceName = null;

  socket.on("join", async ({ deviceId, deviceName }, ack) => {
    try {
      currentAccountId = socket.user._id.toString();
      currentDeviceId = String(deviceId || socket.id);
      currentDeviceName = String(deviceName || "Unknown Device").trim().slice(0, 40) || "Unknown Device";

      const user = await User.findById(currentAccountId);
      const existing = user.activeDevices.find((d) => d.deviceId === currentDeviceId);
      const onlineOtherDevices = user.activeDevices.filter((d) => d.online && d.deviceId !== currentDeviceId);
      if (!existing && onlineOtherDevices.length >= user.maxDevices) {
        ack?.({ ok: false, error: `Maximum ${user.maxDevices} devices are already connected` });
        socket.disconnect(true);
        return;
      }

      const session = getOrCreateSession(currentAccountId);
      session.devices[currentDeviceId] = {
        socketId: socket.id,
        deviceId: currentDeviceId,
        deviceName: currentDeviceName,
        online: true,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      };

      if (existing) {
        await User.updateOne(
          { _id: currentAccountId, "activeDevices.deviceId": currentDeviceId },
          {
            $set: {
              "activeDevices.$.deviceName": currentDeviceName,
              "activeDevices.$.socketId": socket.id,
              "activeDevices.$.online": true,
              "activeDevices.$.joinedAt": new Date(),
              "activeDevices.$.lastSeen": new Date(),
            },
          }
        );
      } else {
        await User.updateOne(
          { _id: currentAccountId },
          {
            $push: {
              activeDevices: {
                deviceId: currentDeviceId,
                deviceName: currentDeviceName,
                socketId: socket.id,
                online: true,
                joinedAt: new Date(),
                lastSeen: new Date(),
              },
            },
          }
        );
      }

      socket.join(currentAccountId);
      ack?.({ ok: true });
      socket.emit("state_update", statePayload(session));

      const messages = await Message.find({ accountId: currentAccountId }).sort({ timestamp: -1 }).limit(80).lean();
      socket.emit("messages_history", messages.reverse());
      emitState(currentAccountId);
      emitDeviceEvent(currentAccountId, "join", currentDeviceName);
    } catch (err) {
      ack?.({ ok: false, error: "Unable to connect device" });
      socket.disconnect(true);
    }
  });

  socket.on("play_song", ({ song }) => {
    if (!currentAccountId || !song) return;
    const session = sessions[currentAccountId];
    session.state.currentSong = song;
    setPlaybackCheckpoint(session, 0, true);
    if (!session.state.queue.find((s) => s.id === song.id)) {
      session.state.queue = [song, ...session.state.queue].slice(0, 100);
    }
    markStateAction(session, "SONG_CHANGE", currentDeviceId, currentDeviceName);
    console.log("[SyncWave Sync] STATE_UPDATE", { action: "SONG_CHANGE", deviceName: currentDeviceName, serverPosition: getLivePosition(session) });
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("play_pause", ({ isPlaying }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    const livePos = getLivePosition(session);
    setPlaybackCheckpoint(session, livePos, Boolean(isPlaying));
    markStateAction(session, session.state.isPlaying ? "PLAY" : "PAUSE", currentDeviceId, currentDeviceName);
    console.log("[SyncWave Sync] STATE_UPDATE", { action: session.state.lastAction, deviceName: currentDeviceName, serverPosition: getLivePosition(session) });
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("seek", ({ position }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    setPlaybackCheckpoint(session, position, session.state.isPlaying);
    markStateAction(session, "SEEK", currentDeviceId, currentDeviceName);
    console.log("[SyncWave Sync] SEEK_RECEIVED", { deviceName: currentDeviceName, position: session.state.positionAtPlay });
    console.log("[SyncWave Sync] STATE_UPDATE", { action: "SEEK", deviceName: currentDeviceName, serverPosition: getLivePosition(session) });
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("next_song", () => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    if (!session.state.queue.length) return;
    const idx = session.state.queue.findIndex((s) => s.id === session.state.currentSong?.id);
    const next = session.state.queue[(idx + 1) % session.state.queue.length];
    if (!next) return;
    session.state.currentSong = next;
    setPlaybackCheckpoint(session, 0, true);
    markStateAction(session, "NEXT", currentDeviceId, currentDeviceName);
    console.log("[SyncWave Sync] STATE_UPDATE", { action: "NEXT", deviceName: currentDeviceName, serverPosition: getLivePosition(session) });
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("prev_song", () => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    if (!session.state.queue.length) return;
    const idx = session.state.queue.findIndex((s) => s.id === session.state.currentSong?.id);
    const prev = session.state.queue[(idx - 1 + session.state.queue.length) % session.state.queue.length];
    if (!prev) return;
    session.state.currentSong = prev;
    setPlaybackCheckpoint(session, 0, true);
    markStateAction(session, "PREV", currentDeviceId, currentDeviceName);
    console.log("[SyncWave Sync] STATE_UPDATE", { action: "PREV", deviceName: currentDeviceName, serverPosition: getLivePosition(session) });
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("set_queue", ({ queue }) => {
    if (!currentAccountId || !Array.isArray(queue)) return;
    const session = sessions[currentAccountId];
    session.state.queue = queue.filter(Boolean).slice(0, 100);
    markStateAction(session, "QUEUE", currentDeviceId, currentDeviceName);
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("volume_change", ({ volume }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    session.state.volume = Math.max(0, Math.min(100, Number(volume) || 0));
    if (session.state.syncEnabled) emitState(currentAccountId);
  });

  socket.on("toggle_sync", ({ syncEnabled }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    session.state.syncEnabled = Boolean(syncEnabled);
    emitState(currentAccountId);
  });

  socket.on("chat_message", async ({ message, attachments }) => {
    if (!currentAccountId) return;
    const text = String(message || "").trim().slice(0, 1000);
    const cleanAttachments = Array.isArray(attachments)
      ? attachments.slice(0, 4).map((item) => ({
        name: String(item.name || "Attachment").slice(0, 120),
        type: String(item.type || "application/octet-stream").slice(0, 120),
        size: Math.max(0, Number(item.size) || 0),
        dataUrl: String(item.dataUrl || "").slice(0, 900000),
      })).filter((item) => item.dataUrl.startsWith("data:"))
      : [];
    if (!text && !cleanAttachments.length) return;
    const saved = await Message.create({
      accountId: currentAccountId,
      deviceName: currentDeviceName || "Unknown Device",
      message: text || (cleanAttachments.length ? "Attachment" : ""),
      attachments: cleanAttachments,
      timestamp: new Date(),
    });
    io.to(currentAccountId).emit("chat_message", saved);
  });

  socket.on("chat_seen", async ({ messageIds } = {}) => {
    if (!currentAccountId || !currentDeviceId) return;
    const ids = Array.isArray(messageIds) ? messageIds.filter(Boolean).slice(-120) : [];
    if (!ids.length) return;
    const seen = {
      deviceId: currentDeviceId,
      deviceName: currentDeviceName || "Unknown Device",
      seenAt: new Date(),
    };
    const result = await Message.updateMany(
      { _id: { $in: ids }, accountId: currentAccountId, "seenBy.deviceId": { $ne: currentDeviceId } },
      { $push: { seenBy: seen } }
    );
    if (!result.modifiedCount) return;
    io.to(currentAccountId).emit("messages_seen", { messageIds: ids, seen });
  });

  socket.on("typing", ({ isTyping }) => {
    if (!currentAccountId || !currentDeviceId) return;
    const session = sessions[currentAccountId];
    if (isTyping) session.typing[currentDeviceId] = currentDeviceName;
    else delete session.typing[currentDeviceId];
    socket.to(currentAccountId).emit("typing", {
      devices: Object.entries(session.typing)
        .filter(([id]) => id !== currentDeviceId)
        .map(([, name]) => name),
    });
  });

  socket.on("call_user", ({ targetDeviceId, callId, media }, ack) => {
    if (!currentAccountId || !currentDeviceId) return ack?.({ ok: false, error: "Device is not joined" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const receiverDeviceId = String(targetDeviceId || "");
    if (!receiverDeviceId || receiverDeviceId === currentDeviceId) return ack?.({ ok: false, error: "Choose another device" });
    const receiver = getTargetSocket(currentAccountId, receiverDeviceId);
    if (!receiver) return emitToCallTarget(socket, currentAccountId, receiverDeviceId, "incoming_call", { callId, from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id) }, ack);

    const id = String(callId || `${currentDeviceId}-${Date.now()}`);
    createCallSession(
      currentAccountId,
      id,
      { deviceId: currentDeviceId, socketId: socket.id, deviceName: currentDeviceName },
      { deviceId: receiverDeviceId, socketId: receiver.socketId, deviceName: receiver.deviceName }
    );
    callLog("CALLER", "CALL_SENT", {
      callId: id,
      socketId: socket.id,
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
      receiverSocketId: receiver.socketId,
      receiverDeviceId,
      receiverDeviceName: receiver.deviceName,
    });
    callLog("RECEIVER", "CALL_RECEIVED", {
      callId: id,
      socketId: receiver.socketId,
      deviceId: receiverDeviceId,
      deviceName: receiver.deviceName,
      callerSocketId: socket.id,
      callerDeviceId: currentDeviceId,
      callerDeviceName: currentDeviceName,
    });
    emitToCallTarget(socket, currentAccountId, receiverDeviceId, "incoming_call", {
      callId: id,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      media: media || { video: true, audio: true },
      createdAt: Date.now(),
    }, ack);
  });

  socket.on("accept_call", ({ targetDeviceId, callId }, ack) => {
    if (!currentAccountId || !currentDeviceId) return ack?.({ ok: false, error: "Device is not joined" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const call = validateCallParticipant(currentAccountId, callId, currentDeviceId, String(targetDeviceId || ""), ack);
    if (!call || currentDeviceId !== call.receiverDeviceId) return ack?.({ ok: false, error: "Only receiver can accept this call" });
    call.receiverSocketId = socket.id;
    call.callerSocketId = getTargetSocket(currentAccountId, call.callerDeviceId)?.socketId || call.callerSocketId;
    touchCallSession(call, "accepted");
    callLog("RECEIVER", "CALL_ACCEPTED", {
      callId,
      socketId: socket.id,
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
      callerSocketId: call.callerSocketId,
      callerDeviceId: call.callerDeviceId,
    });
    emitToCallTarget(socket, currentAccountId, call.callerDeviceId, "accept_call", {
      callId,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      acceptedAt: Date.now(),
    }, ack);
  });

  socket.on("reject_call", ({ targetDeviceId, callId, reason }, ack) => {
    if (!currentAccountId || !currentDeviceId) return ack?.({ ok: false, error: "Device is not joined" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const call = validateCallParticipant(currentAccountId, callId, currentDeviceId, String(targetDeviceId || ""), ack);
    if (!call) return;
    const peerDeviceId = callPeerDeviceId(call, currentDeviceId);
    emitToCallTarget(socket, currentAccountId, peerDeviceId, "reject_call", {
      callId,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      reason: reason || "rejected",
      endedAt: Date.now(),
    }, ack);
    endCallSession(currentAccountId, callId);
  });

  socket.on("end_call", ({ targetDeviceId, callId, reason }, ack) => {
    if (!currentAccountId || !currentDeviceId) return ack?.({ ok: false, error: "Device is not joined" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const call = validateCallParticipant(currentAccountId, callId, currentDeviceId, String(targetDeviceId || ""), ack);
    if (!call) return;
    const peerDeviceId = callPeerDeviceId(call, currentDeviceId);
    emitToCallTarget(socket, currentAccountId, peerDeviceId, "end_call", {
      callId,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      reason: reason || "ended",
      endedAt: Date.now(),
    }, ack);
    endCallSession(currentAccountId, callId);
  });

  socket.on("offer", ({ targetDeviceId, callId, offer }, ack) => {
    if (!currentAccountId || !currentDeviceId || !offer) return ack?.({ ok: false, error: "Invalid offer" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const call = validateCallParticipant(currentAccountId, callId, currentDeviceId, String(targetDeviceId || ""), ack);
    if (!call || currentDeviceId !== call.callerDeviceId) return ack?.({ ok: false, error: "Only caller can send offer" });
    call.callerSocketId = socket.id;
    touchCallSession(call, "offer_sent");
    emitToCallTarget(socket, currentAccountId, call.receiverDeviceId, "offer", {
      callId,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      offer,
    }, ack);
  });

  socket.on("answer", ({ targetDeviceId, callId, answer }, ack) => {
    if (!currentAccountId || !currentDeviceId || !answer) return ack?.({ ok: false, error: "Invalid answer" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const call = validateCallParticipant(currentAccountId, callId, currentDeviceId, String(targetDeviceId || ""), ack);
    if (!call || currentDeviceId !== call.receiverDeviceId) return ack?.({ ok: false, error: "Only receiver can send answer" });
    call.receiverSocketId = socket.id;
    touchCallSession(call, "answer_sent");
    callLog("CALLER", "ANSWER_RECEIVED", {
      callId,
      socketId: call.callerSocketId,
      deviceId: call.callerDeviceId,
      deviceName: call.callerDeviceName,
      receiverSocketId: socket.id,
      receiverDeviceId: currentDeviceId,
    });
    emitToCallTarget(socket, currentAccountId, call.callerDeviceId, "answer", {
      callId,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      answer,
    }, ack);
  });

  socket.on("ice_candidate", ({ targetDeviceId, callId, candidate }, ack) => {
    if (!currentAccountId || !currentDeviceId || !candidate) return ack?.({ ok: false, error: "Invalid ICE candidate" });
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) return ack?.({ ok: false, error: "Stale device socket" });
    const call = validateCallParticipant(currentAccountId, callId, currentDeviceId, String(targetDeviceId || ""), ack);
    if (!call) return;
    const peerDeviceId = callPeerDeviceId(call, currentDeviceId);
    emitToCallTarget(socket, currentAccountId, peerDeviceId, "ice_candidate", {
      callId,
      from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
      candidate,
    }, ack);
  });

  socket.on("disconnect", async () => {
    if (!currentAccountId || !currentDeviceId || !sessions[currentAccountId]) return;
    if (!isCurrentSocketForDevice(currentAccountId, currentDeviceId, socket.id)) {
      console.log("[SyncWave Call] DISCONNECT_IGNORED_STALE_SOCKET", {
        accountId: currentAccountId,
        socketId: socket.id,
        deviceId: currentDeviceId,
        deviceName: currentDeviceName,
      });
      return;
    }
    Object.values(sessions[currentAccountId].calls || {}).forEach((call) => {
      if (call.callerDeviceId !== currentDeviceId && call.receiverDeviceId !== currentDeviceId) return;
      const peerDeviceId = callPeerDeviceId(call, currentDeviceId);
      if (peerDeviceId) {
        emitToCallTarget(socket, currentAccountId, peerDeviceId, "end_call", {
          callId: call.callId,
          from: callDevicePayload(currentDeviceId, currentDeviceName, socket.id),
          reason: "device_disconnected",
          endedAt: Date.now(),
        });
      }
      endCallSession(currentAccountId, call.callId);
    });
    delete sessions[currentAccountId].devices[currentDeviceId];
    delete sessions[currentAccountId].typing[currentDeviceId];
    await markDeviceOffline(currentAccountId, currentDeviceId);
    emitState(currentAccountId);
    emitDeviceEvent(currentAccountId, "leave", currentDeviceName || "Unknown Device");
  });
});

function registeredRoutes() {
  return app._router.stack
    .filter((layer) => layer.route?.path)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SyncWave server running on :${PORT}`);
  console.log("[SyncWave Routes]", registeredRoutes());
});
