const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  deviceName: { type: String, required: true },
  message: { type: String, required: true, maxlength: 1000 },
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
