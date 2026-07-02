const fs = require("fs");
const path = require("path");

const uploadRoot = path.join(__dirname, "..", "..", "uploads", "discover", "reels");

function ensureUploadRoot() {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

function cleanExt(mime) {
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return "mp4";
}

async function saveBase64Video({ accountId, dataUrl }) {
  ensureUploadRoot();
  const match = String(dataUrl || "").match(/^data:(video\/(?:mp4|webm|quicktime));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("A video data URL is required");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 80 * 1024 * 1024) throw new Error("Video exceeds 80 MB");
  const filename = `${accountId}-${Date.now()}-${Math.random().toString(16).slice(2)}.${cleanExt(match[1])}`;
  await fs.promises.writeFile(path.join(uploadRoot, filename), buffer);
  return `/discover-reels/${filename}`;
}

module.exports = { ensureUploadRoot, saveBase64Video, uploadRoot };
