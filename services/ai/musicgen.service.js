const fs = require("fs");
const path = require("path");
const dns = require("dns");
const fetch = require("node-fetch");

const outputDir = path.join(__dirname, "..", "..", "uploads", "generated", "instrumentals");
fs.mkdirSync(outputDir, { recursive: true });

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_RETRIES = 2;
const HF_BASE_URL = "https://api-inference.huggingface.co/models/";
const HF_MODELS = ["facebook/musicgen-small", "facebook/musicgen-medium"];

function publicUrl(filename) {
  return `/generated/instrumentals/${filename}`;
}

function musicGenError(message, details = {}) {
  const err = new Error(message);
  err.code = "MUSICGEN_UNAVAILABLE";
  err.details = details;
  return err;
}

function timeoutMs() {
  const value = Number(process.env.MUSICGEN_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function retryCount() {
  const value = Number(process.env.MUSICGEN_RETRIES);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_RETRIES;
}

function encodeModelPath(model) {
  return String(model || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function huggingFaceUrl(model) {
  return new URL(encodeModelPath(model), HF_BASE_URL).toString();
}

function configuredUrl(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).toString();
  } catch (err) {
    console.warn(`[AI MusicGen] ${label} is not a valid URL`, { value: raw, error: err.message });
    return "";
  }
}

function workerGenerateUrl(value) {
  const url = new URL(value);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/generate";
  }
  return url.toString();
}

async function diagnoseDns(requestUrl, label) {
  try {
    const { hostname } = new URL(requestUrl);
    const result = await new Promise((resolve, reject) => {
      dns.lookup(hostname, (err, address, family) => {
        if (err) return reject(err);
        return resolve({ address, family });
      });
    });
    console.log("[AI MusicGen] DNS lookup ok", { provider: label, hostname, address: result.address, family: result.family });
  } catch (err) {
    console.warn("[AI MusicGen] DNS lookup failed", { provider: label, url: requestUrl, error: err.message, code: err.code });
  }
}

async function fetchWithTimeoutAndRetry(url, options, label) {
  const attempts = retryCount() + 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());

    try {
      if (attempt === 1) await diagnoseDns(url, label);
      console.log("[AI MusicGen] Fetching", { provider: label, url, attempt, attempts, timeoutMs: timeoutMs() });
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok || attempt === attempts || (response.status !== 429 && response.status < 500)) {
        return response;
      }
      console.warn("[AI MusicGen] Fetch returned retryable status", {
        provider: label,
        url,
        attempt,
        attempts,
        status: response.status,
        statusText: response.statusText,
      });
      await response.text().catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      continue;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const timedOut = err.name === "AbortError";
      console.warn("[AI MusicGen] Fetch failed", {
        provider: label,
        url,
        attempt,
        attempts,
        code: err.code,
        error: timedOut ? "Request timed out" : err.message,
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  throw lastError;
}

async function readAudioBuffer(response, providerLabel) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = await response.text();
    throw new Error(`${providerLabel} returned JSON instead of audio: ${body.slice(0, 500)}`);
  }
  return response.buffer();
}

async function downloadWorkerAudio(providerUrl, audioUrl, label) {
  const source = /^https?:\/\//i.test(audioUrl) ? audioUrl : new URL(audioUrl, providerUrl).toString();
  const response = await fetchWithTimeoutAndRetry(source, { method: "GET" }, `${label}:audio`);
  if (!response.ok) throw new Error(`${label} audio download failed: ${response.status} ${response.statusText}`);
  return readAudioBuffer(response, `${label} audio`);
}

async function requestWorker(providerUrl, prompt, label) {
  const generateUrl = workerGenerateUrl(providerUrl);
  const response = await fetchWithTimeoutAndRetry(generateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, musicPrompt: prompt, model: HF_MODELS[0], fallbackModel: HF_MODELS[1] }),
  }, label);
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json().catch(() => ({}));
    if (!data.success || !data.audioUrl) {
      throw new Error(data.error || `${label} did not return audioUrl`);
    }
    return downloadWorkerAudio(generateUrl, data.audioUrl, label);
  }
  return readAudioBuffer(response, label);
}

async function requestHuggingFaceModel(model, prompt) {
  const url = huggingFaceUrl(model);
  const response = await fetchWithTimeoutAndRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HUGGINGFACE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: prompt }),
  }, `huggingface:${model}`);
  if (!response.ok) throw new Error(`HuggingFace ${model} failed: ${response.status} ${response.statusText}`);
  return readAudioBuffer(response, `HuggingFace ${model}`);
}

async function requestHuggingFace(prompt) {
  let lastError;
  for (const model of HF_MODELS) {
    try {
      return await requestHuggingFaceModel(model, prompt);
    } catch (err) {
      lastError = err;
      console.warn("[AI MusicGen] HuggingFace model failed", { model, error: err.message, code: err.code });
    }
  }
  throw lastError;
}

async function requestProviders(prompt) {
  const providers = [];
  const workerUrl = configuredUrl(process.env.MUSICGEN_WORKER_URL, "MUSICGEN_WORKER_URL");
  const fallbackUrl = configuredUrl(process.env.MUSICGEN_FALLBACK_PROVIDER_URL || process.env.MUSICGEN_PROVIDER_URL, "MUSICGEN_FALLBACK_PROVIDER_URL");
  const hfToken = String(process.env.HUGGINGFACE_API_TOKEN || "").trim();

  if (workerUrl) providers.push({ label: "musicgen-worker", run: () => requestWorker(workerUrl, prompt, "musicgen-worker") });
  if (fallbackUrl && fallbackUrl !== workerUrl) providers.push({ label: "musicgen-fallback-provider", run: () => requestWorker(fallbackUrl, prompt, "musicgen-fallback-provider") });
  if (hfToken) providers.push({ label: "huggingface", run: () => requestHuggingFace(prompt) });

  if (!providers.length) {
    throw musicGenError("Music generation is not configured. Add MUSICGEN_WORKER_URL, MUSICGEN_FALLBACK_PROVIDER_URL, or HUGGINGFACE_API_TOKEN.");
  }

  const failures = [];
  for (const provider of providers) {
    try {
      console.log("[AI MusicGen] Trying provider", { provider: provider.label });
      return { buffer: await provider.run(), provider: provider.label };
    } catch (err) {
      failures.push({ provider: provider.label, message: err.message, code: err.code });
      console.warn("[AI MusicGen] Provider unavailable", { provider: provider.label, error: err.message, code: err.code });
    }
  }

  throw musicGenError("Music generation is temporarily unavailable. Please try again after the audio provider is reachable.", { failures });
}

async function generateInstrumental({ musicPrompt, jobId }) {
  const prompt = String(musicPrompt || "").trim();
  if (!prompt) throw new Error("musicPrompt is required");

  const filename = `${jobId || Date.now()}-instrumental.wav`;
  const target = path.join(outputDir, filename);

  const result = await requestProviders(prompt);
  await fs.promises.writeFile(target, result.buffer);
  return { path: target, url: publicUrl(filename), provider: result.provider };
}

module.exports = {
  generateInstrumental,
  huggingFaceUrl,
};
