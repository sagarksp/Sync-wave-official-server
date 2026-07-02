const fetch = require("node-fetch");
const { CachedVideo, Creator, Reel, TrendingKeyword } = require("../../../models/discover");
const { consumeSearch, logUsage, searchUsage } = require("../../../services/discover/quota.service");
const { normalizeCategory, normalizeLanguage, slug } = require("../../../services/discover/taxonomy");
const { discoverLog } = require("../../../services/discover/logger");

const MEMORY_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const memoryCache = new Map();

const CATEGORY_QUERIES = {
  all: "trending viral youtube shorts india",
  music: "music shorts trending songs india",
  gaming: "gaming shorts esports gameplay",
  technology: "technology shorts gadgets apps",
  programming: "coding shorts javascript react node",
  coding: "coding shorts javascript react node",
  ai: "artificial intelligence chatgpt machine learning shorts",
  education: "education facts learning shorts",
  business: "business startup entrepreneur shorts",
  finance: "finance investing money tips shorts",
  food: "shorts food recipe indian",
  cooking: "cooking recipe kitchen shorts",
  travel: "travel vlog shorts",
  fitness: "fitness workout shorts",
  gym: "gym workout fitness motivation shorts",
  cricket: "cricket shorts highlights india",
  football: "football shorts skills highlights",
  movies: "movies cinema shorts trailers",
  anime: "anime shorts edits",
  cars: "cars automobile shorts",
  bikes: "bikes motorcycle shorts",
  pets: "pets cute animals shorts",
  nature: "nature wildlife beautiful shorts",
  fashion: "fashion style outfit shorts",
  comedy: "comedy funny shorts india",
  motivation: "motivation success shorts",
  podcasts: "podcast clips shorts",
  jobs: "career tips interview jobs india shorts",
  news: "news shorts india latest",
};

function apiKey() {
  return process.env.YOUTUBE_API_KEY || "";
}

function region() {
  return process.env.YOUTUBE_REGION || "IN";
}

function defaultLanguage() {
  return normalizeLanguage(process.env.DEFAULT_LANGUAGE || "english");
}

function cacheKey(kind, params) {
  return `${kind}:${JSON.stringify(params)}`;
}

function getMemory(key) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > MEMORY_TTL_MS) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function setMemory(key, value) {
  memoryCache.set(key, { createdAt: Date.now(), value });
  return value;
}

function optimizedQuery(category) {
  const key = normalizeCategory(category || "all");
  return CATEGORY_QUERIES[key] || `${key.replace(/-/g, " ")} shorts`;
}

function searchQueryForKeyword(keyword) {
  const clean = String(keyword || "").trim().toLowerCase();
  if (!clean) return "";
  if (clean.includes("gym")) return `${clean} shorts`;
  if (clean.includes("food")) return `${clean} reels`;
  if (clean.includes("coding") || clean.includes("programming")) return `${clean} reels`;
  return `${clean} shorts`;
}

function youtubeSearchUrl({ q, pageToken }) {
  const params = new URLSearchParams({
    key: apiKey(),
    part: "snippet",
    type: "video",
    videoDuration: "short",
    videoEmbeddable: "true",
    safeSearch: "moderate",
    order: "relevance",
    maxResults: "18",
    regionCode: region(),
    q,
  });
  if (pageToken) params.set("pageToken", pageToken);
  return `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
}

async function fetchWithRetry(url, attempts = 2) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    const startedAt = Date.now();
    try {
      discoverLog("ExternalAPI", "youtube_request", { attempt: index + 1 });
      const response = await fetch(url, {
        headers: { "User-Agent": "SyncWave Discover/1.0" },
        timeout: REQUEST_TIMEOUT_MS,
      });
      discoverLog("ExternalAPI", "youtube_response", { status: response.status, responseTimeMs: Date.now() - startedAt });
      if (!response.ok) throw new Error(`YouTube ${response.status}`);
      return response.json();
    } catch (err) {
      lastError = err;
      discoverLog("ExternalAPI", "youtube_error", { attempt: index + 1, error: err.message, stack: err.stack });
      if (index < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 450 * (index + 1)));
    }
  }
  throw lastError;
}

function normalizeVideo(item, category, queryKey) {
  const videoId = item.id?.videoId || item.id;
  if (!videoId || !item.snippet?.title) return null;
  const snippet = item.snippet;
  const thumbnailUrl = snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || "";
  return {
    provider: "youtube",
    providerVideoId: videoId,
    queryKey,
    category: normalizeCategory(category || "all"),
    language: defaultLanguage(),
    region: region(),
    title: String(snippet.title || "").slice(0, 240),
    description: String(snippet.description || "").slice(0, 1200),
    channelId: snippet.channelId || "",
    channelTitle: snippet.channelTitle || "YouTube Creator",
    thumbnailUrl,
    embedUrl: `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1`,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : new Date(),
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + MEMORY_TTL_MS),
    etag: item.etag || "",
    raw: item,
  };
}

async function upsertCached(videos) {
  if (!videos.length) return;
  await CachedVideo.bulkWrite(videos.map((video) => ({
    updateOne: {
      filter: { provider: "youtube", providerVideoId: video.providerVideoId },
      update: { $set: video },
      upsert: true,
    },
  })), { ordered: false });
}

async function creatorFor(video) {
  const handle = slug(video.channelTitle || video.channelId || "youtube-creator", "youtube-creator").slice(0, 80);
  return Creator.findOneAndUpdate(
    { handle },
    { $setOnInsert: { handle, displayName: video.channelTitle || "YouTube Creator", avatarUrl: "", verified: false } },
    { upsert: true, new: true }
  );
}

async function materialize(videos) {
  const reels = [];
  for (const video of videos) {
    const creator = await creatorFor(video);
    const reel = await Reel.findOneAndUpdate(
      { provider: "youtube", providerVideoId: video.providerVideoId },
      {
        $set: {
          creatorId: creator._id,
          title: video.title,
          description: video.description,
          provider: "youtube",
          providerVideoId: video.providerVideoId,
          videoUrl: video.embedUrl,
          embedUrl: video.embedUrl,
          watchUrl: video.watchUrl,
          thumbnailUrl: video.thumbnailUrl,
          category: video.category,
          language: video.language,
          hashtags: [`#${video.category}`, "#shorts"],
          source: "licensed-api",
          status: "approved",
          publishedAt: video.publishedAt,
        },
        $setOnInsert: { trendingScore: 1 },
      },
      { upsert: true, new: true }
    ).populate("creatorId");
    reels.push(reel);
  }
  return reels;
}

async function cachedVideos({ category, q, limit = 18 }) {
  const safeRegex = q ? q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const query = { provider: "youtube" };
  const normalized = normalizeCategory(category || "all");
  if (q) {
    query.$or = [
      { title: { $regex: safeRegex, $options: "i" } },
      { description: { $regex: safeRegex, $options: "i" } },
      { queryKey: slug(q) },
    ];
  } else if (!["all", "for-you", "trending"].includes(normalized)) {
    query.category = normalized;
  }
  return CachedVideo.find(query).sort({ fetchedAt: -1, publishedAt: -1 }).limit(limit).lean();
}

async function fetchReels({ accountId, category = "all", pageToken = "" } = {}) {
  const normalized = normalizeCategory(category || "all");
  const q = optimizedQuery(normalized);
  const key = cacheKey("category", { normalized, pageToken });
  const cachedMemory = getMemory(key);
  if (cachedMemory) {
    discoverLog("Cache", "memory_hit", { category: normalized, pageToken, count: cachedMemory.reels?.length || 0 });
    return cachedMemory;
  }

  const cachedDb = await cachedVideos({ category: normalized, limit: 18 });
  discoverLog("Cache", cachedDb.length ? "mongo_hit" : "mongo_miss", { category: normalized, count: cachedDb.length });
  if (!apiKey()) {
    await logUsage({ accountId, action: "cache-hit", query: normalized, ok: true }).catch(() => null);
    return setMemory(key, { reels: await materialize(cachedDb), nextPageToken: "", fromCache: true });
  }

  try {
    const data = await fetchWithRetry(youtubeSearchUrl({ q, pageToken }));
    const videos = (data.items || []).map((item) => normalizeVideo(item, normalized, slug(q))).filter(Boolean);
    await upsertCached(videos);
    await logUsage({ accountId, action: "auto-fetch", query: q, ok: true }).catch(() => null);
    const reels = await materialize(videos);
    discoverLog("Reels", "category_results", { category: normalized, query: q, count: reels.length, nextPageToken: Boolean(data.nextPageToken) });
    return setMemory(key, { reels, nextPageToken: data.nextPageToken || "", fromCache: false, recommendationSource: "youtube" });
  } catch (err) {
    await logUsage({ accountId, action: "api-error", query: q, ok: false, message: err.message }).catch(() => null);
    const reels = await materialize(cachedDb);
    discoverLog("Reels", "category_fallback_cache", { category: normalized, count: reels.length, error: err.message });
    return setMemory(key, { reels, nextPageToken: "", fromCache: true, error: err.message, recommendationSource: "cache" });
  }
}

async function searchReels({ accountId, q }) {
  const clean = String(q || "").trim().slice(0, 180);
  const cachedDb = await cachedVideos({ q: clean, limit: 18 });
  if (!clean) {
    const quota = await searchUsage(accountId);
    return { reels: [], nextPageToken: "", quota, fromCache: true };
  }
  const nextQuota = await consumeSearch(accountId, clean);
  if (!apiKey()) {
    discoverLog("Search", "search_cache_no_api_key", { keyword: clean, count: cachedDb.length });
    return { reels: await materialize(cachedDb), nextPageToken: "", quota: nextQuota, fromCache: true, recommendationSource: "cache" };
  }

  const key = cacheKey("search", { clean });
  const cachedMemory = getMemory(key);
  if (cachedMemory) {
    discoverLog("Search", "memory_hit", { keyword: clean, count: cachedMemory.reels?.length || 0 });
    return { ...cachedMemory, quota: nextQuota };
  }

  try {
    const query = searchQueryForKeyword(clean);
    discoverLog("Search", "youtube_search", { keyword: clean, query, remaining: nextQuota.remaining });
    const data = await fetchWithRetry(youtubeSearchUrl({ q: query }));
    const videos = (data.items || []).map((item) => normalizeVideo(item, "all", slug(clean))).filter(Boolean);
    await upsertCached(videos);
    await logUsage({ accountId, action: "manual-search", query: clean, ok: true }).catch(() => null);
    await TrendingKeyword.findOneAndUpdate(
      { keyword: slug(clean), category: "search" },
      { $inc: { score: 1 }, $set: { lastSearchedAt: new Date() } },
      { upsert: true }
    );
    const value = { reels: await materialize(videos), nextPageToken: data.nextPageToken || "", fromCache: false, recommendationSource: "youtube" };
    discoverLog("Search", "search_results", { keyword: clean, count: value.reels.length, nextPageToken: Boolean(data.nextPageToken) });
    setMemory(key, value);
    return { ...value, quota: await searchUsage(accountId) };
  } catch (err) {
    if (err.status === 429) throw err;
    await logUsage({ accountId, action: "api-error", query: clean, ok: false, message: err.message }).catch(() => null);
    const reels = await materialize(cachedDb);
    discoverLog("Search", "search_fallback_cache", { keyword: clean, count: reels.length, error: err.message });
    return { reels, nextPageToken: "", quota: await searchUsage(accountId), fromCache: true, error: err.message, recommendationSource: "cache" };
  }
}

module.exports = { CATEGORY_QUERIES, fetchReels, searchReels };
