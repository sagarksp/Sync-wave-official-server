const crypto = require("crypto");
const fetch = require("node-fetch");
const FeedArticle = require("../../models/discover/FeedArticle");
const { normalizeCategory, normalizeLanguage, slug } = require("./taxonomy");
const { discoverLog } = require("./logger");

const DEFAULT_RSS = [
  "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=technology%20OR%20AI%20OR%20programming&hl=en-IN&gl=IN&ceid=IN:en",
  "https://news.google.com/rss/search?q=jobs%20OR%20career%20OR%20startups&hl=en-IN&gl=IN&ceid=IN:en",
];

function hashId(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readingTime(title, description) {
  const words = `${title || ""} ${description || ""}`.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(Math.max(words, 120) / 220));
}

function providerQuery(category) {
  const map = {
    ai: "artificial intelligence",
    international: "world",
    local: "india",
    general: "top",
  };
  return map[category] || category;
}

function articleShape(input) {
  const title = stripHtml(decodeXml(input.title)).slice(0, 280);
  const description = stripHtml(decodeXml(input.description)).slice(0, 900);
  const url = String(input.url || input.link || "").trim();
  if (!title || !url) return null;
  const category = normalizeCategory(input.category);
  const language = normalizeLanguage(input.language);
  return {
    provider: String(input.provider || "rss").slice(0, 80),
    externalId: String(input.externalId || hashId(url)).slice(0, 120),
    url,
    canonicalUrl: String(input.canonicalUrl || url).slice(0, 2000),
    title,
    description,
    imageUrl: String(input.imageUrl || "").slice(0, 2000),
    source: String(input.source || "News").slice(0, 120),
    author: String(input.author || "").slice(0, 160),
    category,
    language,
    country: String(input.country || "").slice(0, 12),
    readingTimeMinutes: readingTime(title, description),
    publishedAt: input.publishedAt ? new Date(input.publishedAt) : new Date(),
    fetchedAt: new Date(),
    tags: Array.from(new Set([category, ...(input.tags || []).map((tag) => slug(tag)).filter(Boolean)])).slice(0, 12),
    status: "active",
  };
}

function rssTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? match[1] : "";
}

function rssMedia(item) {
  const media = item.match(/<media:content[^>]+url=["']([^"']+)["']/i) || item.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  return media ? media[1] : "";
}

async function fetchRss(url, defaults = {}) {
  const startedAt = Date.now();
  discoverLog("Feed", "rss_request", { url, category: defaults.category, language: defaults.language });
  const response = await fetch(url, { headers: { "User-Agent": "SyncWave Discover/1.0" }, timeout: 9000 });
  if (!response.ok) throw new Error(`RSS ${response.status}`);
  const xml = await response.text();
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  discoverLog("Feed", "rss_response", { url, status: response.status, count: items.length, responseTimeMs: Date.now() - startedAt });
  return items.map((item) => articleShape({
    provider: "rss",
    externalId: rssTag(item, "guid") || rssTag(item, "link"),
    title: rssTag(item, "title"),
    description: rssTag(item, "description"),
    url: rssTag(item, "link"),
    imageUrl: rssMedia(item),
    source: rssTag(item, "source") || defaults.source || "Google News",
    category: defaults.category || "general",
    language: defaults.language || "english",
    publishedAt: rssTag(item, "pubDate"),
  })).filter(Boolean);
}

async function fetchGNews(category, language) {
  if (!process.env.GNEWS_KEY) return [];
  const langMap = { english: "en", hindi: "hi", tamil: "ta", telugu: "te", punjabi: "pa", gujarati: "gu", kannada: "kn", malayalam: "ml", marathi: "mr" };
  const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(providerQuery(category))}&lang=${langMap[language] || "en"}&max=30&apikey=${process.env.GNEWS_KEY}`;
  const startedAt = Date.now();
  discoverLog("Feed", "gnews_request", { url: url.replace(process.env.GNEWS_KEY, "***"), category, language });
  const response = await fetch(url, { headers: { "User-Agent": "SyncWave Discover/1.0" }, timeout: 9000 });
  if (!response.ok) return [];
  const data = await response.json();
  discoverLog("Feed", "gnews_response", { status: response.status, count: data.articles?.length || 0, responseTimeMs: Date.now() - startedAt });
  return (data.articles || []).map((item) => articleShape({
    provider: "gnews",
    externalId: item.url,
    title: item.title,
    description: item.description,
    url: item.url,
    imageUrl: item.image,
    source: item.source?.name,
    category,
    language,
    publishedAt: item.publishedAt,
  })).filter(Boolean);
}

async function fetchNewsData(category, language) {
  if (!process.env.NEWSDATA_KEY) return [];
  const langMap = { english: "en", hindi: "hi", tamil: "ta", telugu: "te", kannada: "kn", malayalam: "ml", punjabi: "pa", gujarati: "gu", marathi: "mr", urdu: "ur", bengali: "bn", french: "fr", german: "de", spanish: "es", japanese: "jp", korean: "ko", chinese: "zh", arabic: "ar", russian: "ru", portuguese: "pt" };
  const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_KEY}&q=${encodeURIComponent(providerQuery(category))}&language=${langMap[language] || "en"}`;
  const startedAt = Date.now();
  discoverLog("Feed", "newsdata_request", { url: url.replace(process.env.NEWSDATA_KEY, "***"), category, language });
  const response = await fetch(url, { headers: { "User-Agent": "SyncWave Discover/1.0" }, timeout: 9000 });
  if (!response.ok) return [];
  const data = await response.json();
  discoverLog("Feed", "newsdata_response", { status: response.status, count: data.results?.length || 0, responseTimeMs: Date.now() - startedAt });
  return (data.results || []).map((item) => articleShape({
    provider: "newsdata",
    externalId: item.article_id || item.link,
    title: item.title,
    description: item.description,
    url: item.link,
    imageUrl: item.image_url,
    source: item.source_id,
    category,
    language,
    publishedAt: item.pubDate,
  })).filter(Boolean);
}

async function fetchTheNewsApi(category, language) {
  if (!process.env.THENEWSAPI_KEY) return [];
  const localeMap = { english: "us", hindi: "in", tamil: "in", telugu: "in", punjabi: "in", gujarati: "in", kannada: "in", malayalam: "in", marathi: "in" };
  const url = `https://api.thenewsapi.com/v1/news/top?api_token=${process.env.THENEWSAPI_KEY}&locale=${localeMap[language] || "us"}&limit=30&search=${encodeURIComponent(providerQuery(category))}`;
  const startedAt = Date.now();
  discoverLog("Feed", "thenewsapi_request", { url: url.replace(process.env.THENEWSAPI_KEY, "***"), category, language });
  const response = await fetch(url, { headers: { "User-Agent": "SyncWave Discover/1.0" }, timeout: 9000 });
  if (!response.ok) return [];
  const data = await response.json();
  discoverLog("Feed", "thenewsapi_response", { status: response.status, count: data.data?.length || 0, responseTimeMs: Date.now() - startedAt });
  return (data.data || []).map((item) => articleShape({
    provider: "thenewsapi",
    externalId: item.uuid || item.url,
    title: item.title,
    description: item.description,
    url: item.url,
    imageUrl: item.image_url,
    source: item.source,
    category,
    language,
    publishedAt: item.published_at,
  })).filter(Boolean);
}

function customRssFeeds() {
  return String(process.env.DISCOVER_RSS_FEEDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function upsertArticles(articles) {
  const operations = articles.map((article) => ({
    updateOne: {
      filter: { provider: article.provider, externalId: article.externalId },
      update: { $set: article, $setOnInsert: { stats: {} } },
      upsert: true,
    },
  }));
  if (!operations.length) return { imported: 0 };
  await FeedArticle.bulkWrite(operations, { ordered: false });
  return { imported: operations.length };
}

async function aggregateNews({ categories = ["general"], languages = ["english"] } = {}) {
  const requestedCategories = categories.length ? categories.map(normalizeCategory) : ["general"];
  const requestedLanguages = languages.length ? languages.map(normalizeLanguage) : ["english"];
  const articles = [];
  requestedCategories.slice(0, 8).forEach((category) => {
    requestedLanguages.slice(0, 4).forEach((language) => {
      articles.push({ category, language });
    });
  });
  const results = [];
  for (const item of articles) {
    const providers = [
      () => fetchNewsData(item.category, item.language),
      () => fetchGNews(item.category, item.language),
      () => fetchTheNewsApi(item.category, item.language),
    ];
    let providerArticles = [];
    for (const provider of providers) {
      providerArticles = await provider().catch((err) => {
        discoverLog("Feed", "provider_error", { category: item.category, language: item.language, error: err.message, stack: err.stack });
        return [];
      });
      if (providerArticles.length) break;
    }
    if (!providerArticles.length) {
      const feeds = [...DEFAULT_RSS, ...customRssFeeds()];
      const settledRss = await Promise.allSettled(feeds.slice(0, 4).map((url) => fetchRss(url, item)));
      providerArticles = settledRss.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
    }
    results.push(...providerArticles);
  }
  return upsertArticles(results);
}

module.exports = { aggregateNews, articleShape };
