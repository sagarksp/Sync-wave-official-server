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
const { authRequired, signToken, JWT_SECRET } = require("./middleware/auth");

const app = express();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/syncwave";

app.use(cors({ origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN.split(","), credentials: true }));
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN.split(","), methods: ["GET", "POST"] },
});

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));

const SAAVN_BASE = "https://saavn.sumit.co";

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
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
    const user = await User.create({ username, passwordHash });
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
        positionAtStart: 0,
        startedAt: null,
        volume: 80,
        queue: [],
        syncEnabled: true,
        hostDeviceId: null,
        hostDeviceName: "",
        version: 0,
        lastActionId: null,
        lastAction: "",
      },
      devices: {},
      typing: {},
    };
  }
  return sessions[accountId];
}

function getLivePosition(session) {
  const s = session.state;
  if (!s.isPlaying || !s.currentSong || !s.startedAt) return s.positionAtStart || 0;
  const elapsed = (Date.now() - s.startedAt) / 1000;
  return Math.min((s.positionAtStart || 0) + elapsed, s.currentSong.duration || 9999);
}

function statePayload(session) {
  return {
    ...session.state,
    position: getLivePosition(session),
    serverTime: Date.now(),
    devices: Object.values(session.devices),
  };
}

function nextActionId(deviceId, action) {
  return `${deviceId || "device"}:${action}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function debugSync(deviceName, event, details = {}) {
  console.log(`[${deviceName || "Unknown Device"}] ${event}`, details);
}

function markAction(session, deviceId, deviceName, action) {
  session.state.version += 1;
  session.state.lastAction = action;
  session.state.lastActionId = nextActionId(deviceId, action);
  session.state.hostDeviceId = deviceId;
  session.state.hostDeviceName = deviceName;
}

function canControl(session, deviceId) {
  return !session.state.hostDeviceId || session.state.hostDeviceId === deviceId;
}

function rejectNonHost(socket, session, action, deviceName) {
  debugSync(deviceName, `${action}_REJECTED_NON_HOST`, {
    hostDeviceName: session.state.hostDeviceName,
  });
  socket.emit("control_rejected", {
    action,
    hostDeviceId: session.state.hostDeviceId,
    hostDeviceName: session.state.hostDeviceName,
  });
}

function emitState(accountId, targetSocket = null) {
  const session = sessions[accountId];
  if (!session) return;
  const target = targetSocket ? io.to(targetSocket) : io.to(accountId);
  target.emit("state_update", statePayload(session));
}

function emitDeviceEvent(accountId, type, deviceName) {
  io.to(accountId).emit("device_event", {
    type,
    deviceName,
    message: type === "join" ? "New device connected" : "Device disconnected",
    timestamp: Date.now(),
  });
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
      debugSync(currentDeviceName, "PLAYER_JOINED", { deviceId: currentDeviceId });

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
    debugSync(currentDeviceName, "PLAY_RECEIVED", { song: song.title });
    session.state.currentSong = song;
    session.state.isPlaying = true;
    session.state.positionAtStart = 0;
    session.state.startedAt = Date.now();
    markAction(session, currentDeviceId, currentDeviceName, "SONG_CHANGE");
    if (!session.state.queue.find((s) => s.id === song.id)) {
      session.state.queue = [song, ...session.state.queue].slice(0, 100);
    }
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("play_pause", ({ isPlaying }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    if (!canControl(session, currentDeviceId)) return rejectNonHost(socket, session, "PLAY_PAUSE", currentDeviceName);
    const livePos = getLivePosition(session);
    debugSync(currentDeviceName, isPlaying ? "PLAY_RECEIVED" : "PAUSE_RECEIVED", { position: livePos });
    session.state.isPlaying = Boolean(isPlaying);
    session.state.positionAtStart = livePos;
    session.state.startedAt = session.state.isPlaying ? Date.now() : null;
    markAction(session, currentDeviceId, currentDeviceName, session.state.isPlaying ? "PLAY" : "PAUSE");
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("seek", ({ position }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    if (!canControl(session, currentDeviceId)) return rejectNonHost(socket, session, "SEEK", currentDeviceName);
    const nextPosition = Math.max(0, Number(position) || 0);
    debugSync(currentDeviceName, "SEEK_RECEIVED", { position: nextPosition });
    session.state.positionAtStart = nextPosition;
    session.state.startedAt = session.state.isPlaying ? Date.now() : null;
    markAction(session, currentDeviceId, currentDeviceName, "SEEK");
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("next_song", () => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    if (!canControl(session, currentDeviceId)) return rejectNonHost(socket, session, "NEXT", currentDeviceName);
    if (!session.state.queue.length) return;
    const idx = session.state.queue.findIndex((s) => s.id === session.state.currentSong?.id);
    const next = session.state.queue[(idx + 1) % session.state.queue.length];
    if (!next) return;
    debugSync(currentDeviceName, "NEXT_RECEIVED", { song: next.title });
    session.state.currentSong = next;
    session.state.isPlaying = true;
    session.state.positionAtStart = 0;
    session.state.startedAt = Date.now();
    markAction(session, currentDeviceId, currentDeviceName, "NEXT");
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("prev_song", () => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    if (!canControl(session, currentDeviceId)) return rejectNonHost(socket, session, "PREV", currentDeviceName);
    if (!session.state.queue.length) return;
    const idx = session.state.queue.findIndex((s) => s.id === session.state.currentSong?.id);
    const prev = session.state.queue[(idx - 1 + session.state.queue.length) % session.state.queue.length];
    if (!prev) return;
    debugSync(currentDeviceName, "PREV_RECEIVED", { song: prev.title });
    session.state.currentSong = prev;
    session.state.isPlaying = true;
    session.state.positionAtStart = 0;
    session.state.startedAt = Date.now();
    markAction(session, currentDeviceId, currentDeviceName, "PREV");
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("set_queue", ({ queue }) => {
    if (!currentAccountId || !Array.isArray(queue)) return;
    const session = sessions[currentAccountId];
    debugSync(currentDeviceName, "QUEUE_RECEIVED", { count: queue.length });
    session.state.queue = queue.filter(Boolean).slice(0, 100);
    session.state.version += 1;
    session.state.lastAction = "QUEUE";
    session.state.lastActionId = nextActionId(currentDeviceId, "QUEUE");
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("volume_change", ({ volume }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    debugSync(currentDeviceName, "VOLUME_RECEIVED", { volume });
    session.state.volume = Math.max(0, Math.min(100, Number(volume) || 0));
    session.state.version += 1;
    session.state.lastAction = "VOLUME";
    session.state.lastActionId = nextActionId(currentDeviceId, "VOLUME");
    if (session.state.syncEnabled) emitState(currentAccountId);
    else emitState(currentAccountId, socket.id);
  });

  socket.on("toggle_sync", ({ syncEnabled }) => {
    if (!currentAccountId) return;
    const session = sessions[currentAccountId];
    debugSync(currentDeviceName, "SYNC_TOGGLE_RECEIVED", { syncEnabled });
    session.state.syncEnabled = Boolean(syncEnabled);
    session.state.version += 1;
    session.state.lastAction = "SYNC_TOGGLE";
    session.state.lastActionId = nextActionId(currentDeviceId, "SYNC_TOGGLE");
    emitState(currentAccountId);
  });

  socket.on("chat_message", async ({ message }) => {
    if (!currentAccountId) return;
    const text = String(message || "").trim().slice(0, 1000);
    if (!text) return;
    const saved = await Message.create({
      accountId: currentAccountId,
      deviceName: currentDeviceName || "Unknown Device",
      message: text,
      timestamp: new Date(),
    });
    io.to(currentAccountId).emit("chat_message", saved);
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

  socket.on("disconnect", async () => {
    if (!currentAccountId || !currentDeviceId || !sessions[currentAccountId]) return;
    const session = sessions[currentAccountId];
    delete sessions[currentAccountId].devices[currentDeviceId];
    delete sessions[currentAccountId].typing[currentDeviceId];
    if (session.state.hostDeviceId === currentDeviceId) {
      debugSync(currentDeviceName, "HOST_DISCONNECTED");
      session.state.hostDeviceId = null;
      session.state.hostDeviceName = "";
      session.state.positionAtStart = getLivePosition(session);
      session.state.startedAt = session.state.isPlaying ? Date.now() : null;
      session.state.version += 1;
      session.state.lastAction = "HOST_DISCONNECT";
      session.state.lastActionId = nextActionId(currentDeviceId, "HOST_DISCONNECT");
    }
    await markDeviceOffline(currentAccountId, currentDeviceId);
    emitState(currentAccountId);
    emitDeviceEvent(currentAccountId, "leave", currentDeviceName || "Unknown Device");
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`SyncWave server running on :${PORT}`));
