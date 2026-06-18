const mongoose = require("mongoose");

const activeDeviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    deviceName: { type: String, required: true },
    socketId: { type: String, default: "" },
    online: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  displayName: { type: String, trim: true, default: "" },
  avatarUrl: { type: String, trim: true, default: "" },
  passwordHash: { type: String, required: true },
  authVersion: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  maxDevices: { type: Number, default: 4 },
  activeDevices: { type: [activeDeviceSchema], default: [] },
});

module.exports = mongoose.model("User", userSchema);
