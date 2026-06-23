const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const outputDir = path.join(__dirname, "..", "..", "uploads", "generated", "instrumentals");
fs.mkdirSync(outputDir, { recursive: true });

function publicUrl(filename) {
  return `/generated/instrumentals/${filename}`;
}

async function requestHuggingFaceModel(model, prompt) {
  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt }),
  });
  if (!response.ok) throw new Error(`HuggingFace ${model} failed: ${response.status}`);
  return response.buffer();
}

async function generateInstrumental({ musicPrompt, jobId }) {
  const prompt = String(musicPrompt || "").trim();
  if (!prompt) throw new Error("musicPrompt is required");

  const workerUrl = process.env.MUSICGEN_WORKER_URL || "";
  const hfToken = process.env.HUGGINGFACE_API_TOKEN || "";
  const filename = `${jobId || Date.now()}-instrumental.wav`;
  const target = path.join(outputDir, filename);

  if (workerUrl) {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicPrompt: prompt, model: "facebook/musicgen-small", fallbackModel: "facebook/musicgen-medium" }),
    });
    if (!response.ok) throw new Error(`MusicGen worker failed: ${response.status}`);
    const buffer = await response.buffer();
    await fs.promises.writeFile(target, buffer);
    return { path: target, url: publicUrl(filename) };
  }

  if (hfToken) {
    let buffer;
    try {
      buffer = await requestHuggingFaceModel("facebook/musicgen-small", prompt);
    } catch (err) {
      console.warn("[AI MusicGen] small failed, trying medium", err.message);
      buffer = await requestHuggingFaceModel("facebook/musicgen-medium", prompt);
    }
    await fs.promises.writeFile(target, buffer);
    return { path: target, url: publicUrl(filename) };
  }

  const err = new Error("MusicGen worker unavailable. Configure MUSICGEN_WORKER_URL or HUGGINGFACE_API_TOKEN.");
  err.code = "MUSICGEN_UNAVAILABLE";
  throw err;
}

module.exports = { generateInstrumental };
