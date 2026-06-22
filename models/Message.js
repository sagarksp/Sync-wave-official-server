const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  deviceName: { type: String, required: true },
  message: { type: String, required: true, maxlength: 1000 },
  encrypted: { type: Boolean, default: false, index: true },
  encryptedMessage: {
    iv: { type: String, default: "" },
    data: { type: String, default: "" },
  },
  replyTo: {
    messageId: { type: String, default: "" },
    sender: {
      iv: { type: String, default: "" },
      data: { type: String, default: "" },
    },
    text: {
      iv: { type: String, default: "" },
      data: { type: String, default: "" },
    },
  },
  attachments: {
    type: [{
      name: { type: String, required: true },
      type: { type: String, default: "application/octet-stream" },
      size: { type: Number, default: 0 },
      dataUrl: { type: String, default: "" },
      fileUrl: { type: String, default: "" },
      encrypted: { type: Boolean, default: false },
      iv: { type: String, default: "" },
      encryptedName: {
        iv: { type: String, default: "" },
        data: { type: String, default: "" },
      },
      encryptedType: {
        iv: { type: String, default: "" },
        data: { type: String, default: "" },
      },
    }],
    default: [],
  },
  reactions: {
    type: [{
      emoji: { type: String, required: true },
      deviceId: { type: String, required: true },
      deviceName: { type: String, required: true },
      reactedAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  seenBy: {
    type: [{
      deviceId: { type: String, required: true },
      deviceName: { type: String, required: true },
      seenAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Message", messageSchema);
