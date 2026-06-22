const crypto = require("crypto");

const GENRE_RULES = {
  rap: "Rap mode: write bars, rhymes, punchlines, confident cadence, internal rhyme, and no filler.",
  "hip hop": "Hip Hop mode: use storytelling, lived details, conversational flow, rhyme pockets, and a memorable hook.",
  trap: "Trap mode: use short rhythmic phrases, bounce, darker texture, sharp drums, and modern hook repetition without duplicate lines.",
  pop: "Pop mode: use clean commercial songwriting, emotional clarity, a sticky hook, and radio-ready phrasing.",
  rock: "Rock mode: use powerful hooks, high emotional stakes, direct imagery, and anthemic chorus writing.",
  bollywood: "Bollywood mode: use love, emotions, melody, relationships, cinematic storytelling, and commercial Hindi film song structure. Never generate abstract indie poetry.",
  lofi: "LoFi mode: use calm emotional writing, intimate details, soft imagery, nostalgia, and warm late-night phrasing.",
  edm: "EDM mode: use festival scale, build/drop tension, euphoric chorus language, energetic rhythm, and crowd-ready phrases.",
  classical: "Classical mode: use poetic writing, graceful imagery, emotional restraint, and elegant lyrical development.",
  punjabi: "Punjabi mode: use energetic dance style, bold hooks, celebratory phrasing, dhol/bhangra movement, and catchy call-response energy.",
  haryanvi: "Haryanvi mode: use earthy confidence, regional pride, strong rhythm, and direct hook language.",
};

const MOOD_RULES = {
  happy: "Happy mood: bright, playful, hopeful, open-hearted, warm vocabulary.",
  sad: "Sad mood: lonely, aching, rainy, memory-heavy, restrained vocabulary.",
  romantic: "Romantic mood: intimate, tender, longing, sensory, relationship-focused vocabulary.",
  motivational: "Motivational mood: resilient, disciplined, rising, powerful, triumphant vocabulary.",
  party: "Party mood: energetic, glamorous, rhythmic, social, dance-floor vocabulary.",
  emotional: "Emotional mood: vulnerable, sincere, reflective, intense, human vocabulary.",
  dark: "Dark mood: tense, shadowy, heavy, mysterious, dramatic vocabulary.",
  chill: "Chill mood: soft, spacious, relaxed, smooth, late-night vocabulary.",
};

const LANGUAGE_RULES = {
  hindi: [
    "Hindi mode: generate pure Hindi lyrics.",
    "Use Devanagari script only.",
    "Do not use English words, Hinglish, or Roman Hindi in lyrics.",
    "Examples of allowed style: \u0926\u093f\u0932, \u092e\u094b\u0939\u092c\u094d\u092c\u0924, \u0938\u092b\u093c\u0930, \u092c\u093e\u0930\u093f\u0936, \u0916\u093c\u093e\u092e\u094b\u0936\u0940.",
  ].join(" "),
  hinglish: "Hinglish mode: write natural Roman Hinglish, mixing Hindi and English like: Teri smile ne dil chura liya.",
  english: "English mode: generate proper commercial English songwriting only. No random poetic fragments.",
  punjabi: "Punjabi mode: generate Punjabi lyrics with authentic Punjabi phrasing. Prefer Gurmukhi script. Do not produce English lyrics.",
  urdu: "Urdu mode: generate Urdu/Hindustani poetic lyrics. Use Devanagari script unless explicitly asked for Urdu script.",
};

const CREATIVE_ANGLES = [
  "Make the user's theme the emotional engine of every section.",
  "Create a clear relationship/story arc from verse 1 to outro.",
  "Use concrete scenes that prove the theme instead of abstract scenery.",
  "Let the chorus state the theme in a memorable commercial hook.",
  "Use fresh metaphors directly connected to the user's idea.",
  "Make verse 2 reveal a new detail about the same theme, not a new unrelated concept.",
  "Use emotional cause and effect: what happened, how it felt, what changed.",
  "Write like a finished song, not a poetry exercise.",
];

const RHYME_STYLES = [
  "Use clean end rhymes with some internal rhymes.",
  "Use slant rhymes with conversational phrasing.",
  "Use couplets in verses and a simpler chorus.",
  "Use compact hook lines and longer verse lines.",
  "Use rhythmic rhyme clusters but avoid repeating the same line.",
];

function normalize(value) {
  return String(value || "").trim();
}

function normalizedKey(value) {
  return normalize(value).toLowerCase();
}

function pick(list, seed, offset) {
  const hash = crypto.createHash("sha1").update(`${seed}:${offset}`).digest("hex");
  return list[parseInt(hash.slice(0, 8), 16) % list.length];
}

function buildSongPrompt(input, options = {}) {
  const prompt = normalize(input.prompt).slice(0, 2000);
  const genre = normalize(input.genre || "Pop");
  const mood = normalize(input.mood || "Emotional");
  const language = normalize(input.language || "Hinglish");
  const voice = normalize(input.voice || "Male");
  const bpm = Number(input.bpm) || 96;
  const tempo = normalize(input.tempo || "");
  const energy = normalize(input.energy || "");
  const instruments = normalize(input.instruments || "");
  const seedSource = `${Date.now()}-${Math.random()}-${prompt}-${genre}-${mood}-${language}-${voice}-${bpm}-${options.attempt || 1}`;
  const seed = crypto.createHash("sha1").update(seedSource).digest("hex").slice(0, 16);
  const genreRule = GENRE_RULES[normalizedKey(genre)] || GENRE_RULES.pop;
  const moodRule = MOOD_RULES[normalizedKey(mood)] || MOOD_RULES.emotional;
  const languageRule = LANGUAGE_RULES[normalizedKey(language)] || LANGUAGE_RULES.hinglish;

  return [
    "You are a professional songwriter.",
    "",
    "The user's theme is:",
    prompt,
    "",
    "This theme MUST be the core idea of the song.",
    "Do not create unrelated concepts.",
    "Do not use the theme as a throwaway word; build the whole song around it.",
    "",
    "Genre:",
    genre,
    "",
    "Mood:",
    mood,
    "",
    "Language:",
    language,
    "",
    "Voice:",
    voice,
    "",
    `BPM: ${bpm}`,
    `Tempo: ${tempo || "match genre and BPM"}`,
    `Energy: ${energy || "match mood and genre"}`,
    `Instruments: ${instruments || "choose professional instruments for the genre"}`,
    "",
    "Requirements:",
    "1. Song MUST revolve around user's theme.",
    "2. Do not create unrelated concepts.",
    "3. Do not repeat lines.",
    "4. Every verse must be unique.",
    "5. Use genre specific writing style.",
    "6. Use mood specific writing style.",
    "7. Respect language selection.",
    "8. Create commercial quality lyrics.",
    "9. Avoid filler text.",
    "10. Avoid duplicated phrases.",
    "",
    "Language rule:",
    languageRule,
    "",
    "Genre rule:",
    genreRule,
    "",
    "Mood rule:",
    moodRule,
    "",
    "Creative direction:",
    `Uniqueness seed: ${seed}`,
    pick(CREATIVE_ANGLES, seed, "angle"),
    pick(RHYME_STYLES, seed, "rhyme"),
    "Never reuse generic unrelated imagery unless it directly supports the user's theme.",
    "If the prompt is \"I think they call this love\", write a romantic love song about realizing love.",
    "If the prompt is one word, infer a full commercial song concept from that word.",
    "",
    options.repairInstructions ? `Previous attempt failed because: ${options.repairInstructions}` : "",
    options.repairInstructions ? "Regenerate from scratch and fix those issues." : "",
    "",
    "Lyrics structure:",
    "Use exactly these section labels inside lyrics:",
    "[Intro]",
    "[Verse 1]",
    "[Pre Chorus]",
    "[Chorus]",
    "[Verse 2]",
    "[Bridge]",
    "[Final Chorus]",
    "[Outro]",
    "",
    "Length: 300 to 700 words.",
    "Return JSON only. No markdown. No commentary. No code fences.",
    "",
    "JSON format:",
    "{\"title\":\"\",\"lyrics\":\"\",\"musicPrompt\":\"\",\"beatPrompt\":\"\",\"coverPrompt\":\"\"}",
    "",
    "musicPrompt must be detailed for MusicGen and include genre, mood, tempo/BPM, instruments, energy, vocal character, and mix texture.",
    "beatPrompt must include drums, groove, bass, percussion, transitions, and chorus lift/drop instructions.",
    "coverPrompt must be a detailed AI image prompt for premium album artwork with no text or logos.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  buildSongPrompt,
  GENRE_RULES,
  MOOD_RULES,
  LANGUAGE_RULES,
};
