const crypto = require("crypto");
const fetch = require("node-fetch");
const { buildSongPrompt } = require("./promptBuilder");

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_GEMINI_ATTEMPTS = 2;
const REQUIRED_SECTIONS = ["[Intro]", "[Verse 1]", "[Pre Chorus]", "[Chorus]", "[Verse 2]", "[Bridge]", "[Final Chorus]", "[Outro]"];

function cleanText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function safeJsonParse(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

function normalizeLine(line) {
  return String(line || "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function lyricLines(lyrics) {
  return String(lyrics || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function removeDuplicateLines(lyrics) {
  const seen = new Set();
  return lyricLines(lyrics).filter((line) => {
    const normalized = normalizeLine(line);
    if (!normalized || /^\[[^\]]+\]$/.test(line)) return true;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).join("\n");
}

function validationIssues(generated) {
  const issues = [];
  if (!cleanText(generated?.title, 160)) issues.push("title missing");
  const lyrics = cleanText(generated?.lyrics, 18000);
  if (!lyrics) issues.push("lyrics missing");
  if (lyrics.length <= 250) issues.push("lyrics length must be greater than 250 characters");
  REQUIRED_SECTIONS.forEach((section) => {
    if (!lyrics.includes(section)) issues.push(`${section} missing`);
  });
  if (!cleanText(generated?.musicPrompt, 4000)) issues.push("musicPrompt missing");
  if (!cleanText(generated?.beatPrompt, 2500)) issues.push("beatPrompt missing");
  if (!cleanText(generated?.coverPrompt, 2500)) issues.push("coverPrompt missing");
  return issues;
}

function pick(list, seed, offset) {
  const hash = crypto.createHash("sha1").update(`${seed}:${offset}`).digest("hex");
  return list[parseInt(hash.slice(0, 8), 16) % list.length];
}

function fallbackLineBank(input) {
  const lang = String(input.language || "").toLowerCase();
  const theme = cleanText(input.prompt, 120) || "the feeling";
  if (lang === "hindi") {
    return {
      title: "\u0926\u093f\u0932 \u0915\u0940 \u092f\u0947 \u092e\u094b\u0939\u092c\u094d\u092c\u0924",
      concept: `\u0907\u0938 \u0917\u0940\u0924 \u0915\u093e \u092d\u093e\u0935 ${theme} \u0938\u0947 \u091c\u0928\u094d\u092e\u0940 \u090f\u0915 \u0938\u091a\u094d\u091a\u0940 \u0915\u0939\u093e\u0928\u0940 \u0939\u0948`,
      lines: [
        "\u0924\u0947\u0930\u0940 \u092f\u093e\u0926 \u0928\u0947 \u091a\u0941\u092a\u0915\u0947 \u0938\u0947 \u0926\u093f\u0932 \u092a\u0930 \u0926\u0938\u094d\u0924\u0915 \u0926\u0940",
        "\u0939\u0930 \u0938\u093e\u0901\u0938 \u092e\u0947\u0902 \u090f\u0915 \u0928\u092f\u093e \u0938\u093e \u0909\u091c\u093e\u0932\u093e \u092d\u0930\u0928\u0947 \u0932\u0917\u093e",
        "\u091c\u093f\u0938 \u0930\u093e\u0939 \u092a\u0930 \u092e\u0948\u0902 \u0905\u0915\u0947\u0932\u093e \u0925\u093e \u0935\u0939\u093e\u0901 \u0924\u0947\u0930\u093e \u0928\u093e\u092e \u092e\u093f\u0932\u093e",
        "\u0928\u091c\u093c\u0930\u094b\u0902 \u0928\u0947 \u091c\u094b \u0915\u0939 \u0928 \u092a\u093e\u092f\u093e \u0935\u094b \u0927\u0921\u093c\u0915\u0928 \u0917\u093e\u0928\u0947 \u0932\u0917\u0940",
        "\u092e\u094c\u0938\u092e \u092d\u0940 \u0924\u0947\u0930\u0947 \u0932\u0939\u091c\u0947 \u0915\u0940 \u0928\u0930\u092e\u0940 \u0913\u0922\u093c\u0947 \u0916\u0921\u093c\u093e \u0930\u0939\u093e",
        "\u092e\u0948\u0902 \u0916\u0941\u0926 \u0938\u0947 \u0928\u093f\u0915\u0932\u093e \u0924\u094b \u0924\u0947\u0930\u0940 \u0924\u0930\u092b\u093c \u0938\u092b\u093c\u0930 \u0916\u0941\u0932\u093e",
      ],
    };
  }
  if (lang === "punjabi") {
    return {
      title: "\u0a26\u0a3f\u0a32 \u0a26\u0a40 \u0a17\u0a71\u0a32",
      concept: `\u0a07\u0a39 \u0a17\u0a40\u0a24 ${theme} \u0a24\u0a4b\u0a02 \u0a2c\u0a23\u0a40 \u0a07\u0a71\u0a15 \u0a38\u0a71\u0a1a\u0a40 \u0a2d\u0a3e\u0a35\u0a28\u0a3e \u0a39\u0a48`,
      lines: [
        "\u0a24\u0a47\u0a30\u0a40 \u0a39\u0a3e\u0a38\u0a40 \u0a28\u0a47 \u0a26\u0a3f\u0a32 \u0a26\u0a3e \u0a2c\u0a42\u0a39\u0a3e \u0a16\u0a4b\u0a32 \u0a26\u0a3f\u0a71\u0a24\u0a3e",
        "\u0a39\u0a30 \u0a15\u0a26\u0a2e \u0a24\u0a47 \u0a28\u0a35\u0a3e\u0a02 \u0a1a\u0a3e\u0a05 \u0a2e\u0a47\u0a30\u0a47 \u0a28\u0a3e\u0a32 \u0a1a\u0a32\u0a3f\u0a06",
        "\u0a30\u0a3e\u0a24 \u0a35\u0a40 \u0a17\u0a3e\u0a09\u0a23 \u0a32\u0a71\u0a17\u0a40 \u0a1c\u0a26 \u0a24\u0a47\u0a30\u0a3e \u0a28\u0a3e\u0a02 \u0a06\u0a07\u0a06",
        "\u0a38\u0a3e\u0a21\u0a40 \u0a15\u0a39\u0a3e\u0a23\u0a40 \u0a22\u0a4b\u0a32 \u0a26\u0a40 \u0a27\u0a41\u0a28 \u0a35\u0a3e\u0a02\u0a17 \u0a35\u0a71\u0a1c\u0a40",
      ],
    };
  }
  if (lang === "english") {
    return {
      title: "What They Call Love",
      concept: `This song is centered on ${theme}, treated as a real emotional story rather than a random image.`,
      lines: [
        "I was naming every feeling except the one that found me",
        "Then your voice turned ordinary rooms into somewhere I could stay",
        "I did not need a skyline to explain what happened in me",
        "It was simple, it was frightening, it was changing me each day",
        "Every small confession started sounding like a chorus",
        "Every quiet moment had your fingerprints inside",
      ],
    };
  }
  return {
    title: "Dil Ne Ye Naam Diya",
    concept: `Ye song ${theme} ke real emotion ke around likha gaya hai`,
    lines: [
      "Maine is feeling ko pehle kabhi naam nahi diya",
      "Teri baaton ne mere dil ka raasta khol diya",
      "Har chhoti si baat mein tera asar rehne laga",
      "Jo kal tak bas khamoshi thi woh chorus banne laga",
      "Main random sapne nahi, bas teri sachchai likh raha hoon",
      "Is kahani mein har line tera ehsaas rakh raha hoon",
    ],
  };
}

function fallbackProject(input, reason = "") {
  const prompt = cleanText(input.prompt, 2000) || "SyncWave Song";
  const genre = cleanText(input.genre, 80) || "Pop";
  const mood = cleanText(input.mood, 80) || "Emotional";
  const language = cleanText(input.language, 80) || "Hinglish";
  const voice = cleanText(input.voice, 80) || "Male";
  const bpm = Number(input.bpm) || 96;
  const seed = `${Date.now()}-${Math.random()}-${prompt}-${genre}-${mood}-${language}-${voice}-${reason}`;
  const bank = fallbackLineBank(input);
  const sections = ["[Intro]", "[Verse 1]", "[Pre Chorus]", "[Chorus]", "[Verse 2]", "[Bridge]", "[Final Chorus]", "[Outro]"];
  const lyrics = sections.map((section, sectionIndex) => {
    const count = section.includes("Verse") ? 8 : section.includes("Chorus") ? 6 : 4;
    const lines = Array.from({ length: count }, (_, idx) => {
      const base = pick(bank.lines, seed, `${section}-${idx}-${sectionIndex}`);
      return idx === 0 && sectionIndex === 0 ? bank.concept : base;
    });
    return [section, ...lines].join("\n");
  }).join("\n\n");
  const instruments = cleanText(input.instruments, 240) || (genre.toLowerCase() === "bollywood" ? "piano, strings, tabla, acoustic guitar, cinematic percussion" : "drums, bass, keys, atmospheric textures");
  return {
    title: bank.title,
    lyrics: removeDuplicateLines(lyrics),
    musicPrompt: `${genre} ${mood} song built around "${prompt}", ${language} lyrics, ${voice} vocal, ${bpm} BPM, ${instruments}, commercial arrangement, theme-focused hook, polished streaming mix`,
    beatPrompt: `${bpm} BPM ${genre} beat, ${mood.toLowerCase()} groove, ${instruments}, clear verse-to-chorus lift, no filler sections, strong transitions`,
    instrumentPrompt: instruments,
    coverPrompt: `Premium album cover for a ${genre} ${mood} song about "${prompt}", cinematic emotional focus, modern streaming artwork, no text, no logos`,
    provider: "prompt-fallback",
  };
}

function sanitizeParsed(parsed) {
  return {
    title: cleanText(parsed?.title, 160),
    lyrics: cleanText(parsed?.lyrics, 18000),
    musicPrompt: cleanText(parsed?.musicPrompt, 4000),
    beatPrompt: cleanText(parsed?.beatPrompt, 2500),
    instrumentPrompt: cleanText(parsed?.instrumentPrompt, 2000),
    coverPrompt: cleanText(parsed?.coverPrompt, 2500),
  };
}

async function requestGemini(input, attempt, repairInstructions) {
  const finalPrompt = buildSongPrompt(input, { attempt, repairInstructions });
  console.log("[AI Debug] Final Gemini Prompt", finalPrompt);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
      generationConfig: {
        temperature: 1.0,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  console.log("[AI Debug] Raw Gemini Response", JSON.stringify(data).slice(0, 14000));
  if (!response.ok) throw new Error(data.error?.message || `Gemini failed with ${response.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  let parsed = null;
  try {
    parsed = safeJsonParse(text);
  } catch (err) {
    console.error("[AI Debug] Gemini JSON parse failed", { error: err.message, rawText: text.slice(0, 4000) });
    throw new Error("Gemini returned invalid JSON");
  }
  console.log("[AI Debug] Parsed Response", JSON.stringify(parsed).slice(0, 10000));
  if (!parsed || typeof parsed !== "object") throw new Error("Gemini returned empty JSON");
  return sanitizeParsed(parsed);
}

async function generateWithGemini(input) {
  if (!GEMINI_API_KEY) {
    console.warn("FALLBACK_TRIGGERED", { reason: "missing Gemini key" });
    return fallbackProject(input, "missing Gemini key");
  }
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt += 1) {
    try {
      const generated = await requestGemini(input, attempt, lastError);
      const issues = validationIssues(generated);
      if (issues.length) {
        console.warn("VALIDATION_FAILED", { attempt, issues });
        lastError = issues.join("; ");
        continue;
      }
      console.log("VALIDATION_PASSED", { attempt, title: generated.title });
      console.log("SAVED_GEMINI_RESPONSE", {
        attempt,
        title: generated.title,
        lyricsChars: generated.lyrics.length,
      });
      return { ...generated, provider: "gemini" };
    } catch (err) {
      lastError = err.message;
      console.error("[AI Gemini] attempt failed", { attempt, error: err.message });
    }
  }
  console.warn("FALLBACK_TRIGGERED", { reason: lastError || "Gemini returned empty or invalid response" });
  return fallbackProject(input, lastError || "Gemini returned empty or invalid response");
}

function pollinationsCoverUrl(coverPrompt) {
  const prompt = `${cleanText(coverPrompt, 1100) || "premium music album cover"}, no text, no logos`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
}

async function uploadCoverToCloudinary(imageUrl) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || "";
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET || "";
  if (!cloudName || !uploadPreset || !imageUrl) return null;

  const body = new URLSearchParams();
  body.set("file", imageUrl);
  body.set("upload_preset", uploadPreset);
  body.set("folder", process.env.CLOUDINARY_AI_FOLDER || "syncwave/ai-songs");

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: "POST",
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[AI Cloudinary] upload skipped", data.error?.message || response.statusText);
    return null;
  }
  return { url: data.secure_url, publicId: data.public_id };
}

function workerStatus() {
  return {
    musicGen: {
      enabled: Boolean(process.env.HUGGINGFACE_API_TOKEN || process.env.REPLICATE_API_TOKEN) && process.env.AI_MUSIC_WORKER_ENABLED === "true",
      preferred: "huggingface-musicgen",
      fallback: "replicate-musicgen",
    },
    voice: { enabled: process.env.AI_VOICE_WORKER_ENABLED === "true" },
    ffmpeg: { enabled: process.env.AI_FFMPEG_WORKER_ENABLED === "true" },
  };
}

function projectSeed(input) {
  return crypto.createHash("sha1").update(JSON.stringify(input)).digest("hex").slice(0, 12);
}

async function createAiProject(input) {
  console.log("[AI Debug] Service Input", {
    prompt: input.prompt,
    genre: input.genre,
    mood: input.mood,
    language: input.language,
    voice: input.voice,
    bpm: input.bpm,
  });
  const generated = await generateWithGemini(input);
  const coverImage = pollinationsCoverUrl(generated.coverPrompt);
  const cloudinary = await uploadCoverToCloudinary(coverImage);
  return {
    ...generated,
    coverImage: cloudinary?.url || coverImage,
    cloudinaryPublicId: cloudinary?.publicId || "",
    audioUrl: "",
    status: "metadata_ready",
    provider: generated.provider || (GEMINI_API_KEY ? "gemini" : "prompt-fallback"),
    seed: projectSeed({ input, generated }),
    workers: workerStatus(),
  };
}

module.exports = {
  createAiProject,
  workerStatus,
  validationIssues,
};
