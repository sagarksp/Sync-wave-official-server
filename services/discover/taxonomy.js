const { CATEGORIES, LANGUAGES } = require("../../models/discover/constants");

const LANGUAGE_LABELS = {
  english: "English",
  hindi: "Hindi",
  marathi: "Marathi",
  tamil: "Tamil",
  telugu: "Telugu",
  kannada: "Kannada",
  malayalam: "Malayalam",
  punjabi: "Punjabi",
  gujarati: "Gujarati",
  bengali: "Bengali",
  urdu: "Urdu",
  spanish: "Spanish",
  french: "French",
  german: "German",
  japanese: "Japanese",
  korean: "Korean",
  chinese: "Chinese",
  arabic: "Arabic",
  russian: "Russian",
  portuguese: "Portuguese",
  italian: "Italian",
};

function slug(value, fallback = "general") {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function normalizeCategory(value) {
  const key = slug(value);
  if (key === "stock") return "stock-market";
  if (key === "artificial-intelligence") return "ai";
  if (CATEGORIES.includes(key)) return key;
  return "general";
}

function normalizeLanguage(value) {
  const key = slug(value, "english");
  const aliases = {
    en: "english",
    hi: "hindi",
    mr: "marathi",
    ta: "tamil",
    te: "telugu",
    kn: "kannada",
    ml: "malayalam",
    pa: "punjabi",
    gu: "gujarati",
    bn: "bengali",
    ur: "urdu",
    es: "spanish",
    fr: "french",
    de: "german",
    ja: "japanese",
    ko: "korean",
    zh: "chinese",
    ar: "arabic",
    ru: "russian",
    pt: "portuguese",
    it: "italian",
  };
  const mapped = aliases[key] || key;
  return LANGUAGES.includes(mapped) ? mapped : "english";
}

function publicTaxonomy() {
  return {
    languages: LANGUAGES.map((key) => ({ key, label: LANGUAGE_LABELS[key] || key })),
    categories: CATEGORIES.map((key) => ({
      key,
      label: key.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "),
    })),
  };
}

module.exports = { normalizeCategory, normalizeLanguage, publicTaxonomy, slug };
