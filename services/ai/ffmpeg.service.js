const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const outputDir = path.join(__dirname, "..", "..", "uploads", "generated", "final");
fs.mkdirSync(outputDir, { recursive: true });

function publicUrl(filename) {
  return `/generated/final/${filename}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || "ffmpeg", args, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stderr || stdout || ""}`.trim();
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function mixFinalSong({ instrumentalPath, vocalsPath, jobId }) {
  if (!instrumentalPath || !vocalsPath) throw new Error("instrumentalPath and vocalsPath are required");
  if (!fs.existsSync(instrumentalPath)) throw new Error("instrumental.wav not found");
  if (!fs.existsSync(vocalsPath)) throw new Error("vocals.wav not found");

  const filename = `${jobId || Date.now()}-final_song.mp3`;
  const target = path.join(outputDir, filename);
  await runFfmpeg([
    "-y",
    "-i", instrumentalPath,
    "-i", vocalsPath,
    "-filter_complex",
    "[0:a]volume=0.88,acompressor=threshold=-18dB:ratio=2.5:attack=20:release=250[i];[1:a]volume=1.0,acompressor=threshold=-20dB:ratio=3:attack=10:release=180[v];[i][v]amix=inputs=2:duration=longest:dropout_transition=2,alimiter=limit=0.95, loudnorm=I=-14:TP=-1.5:LRA=11[out]",
    "-map", "[out]",
    "-ar", "44100",
    "-codec:a", "libmp3lame",
    "-b:a", "320k",
    target,
  ]);
  return { path: target, url: publicUrl(filename) };
}

module.exports = { mixFinalSong };
