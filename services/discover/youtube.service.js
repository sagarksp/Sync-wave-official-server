const fetch = require("node-fetch");
const { CachedVideo, Creator, Reel, TrendingKeyword } = require("../../models/discover");
const { normalizeCategory, normalizeLanguage, slug } = require("./taxonomy");
const { logUsage, searchUsage } = require("./quota.service");

const DEFAULT_QUERIES = [
  "trending shorts",
  "entertainment shorts",
  "music shorts",
  "comedy shorts",
  "education shorts",
  "technology shorts",
  "gaming shorts",
  "travel shorts",
  "food shorts",
  "sports shorts",
  "business shorts",
  "finance shorts",
  "news shorts",
  "movies shorts",
  "lifestyle shorts",
];

function cacheHours() {
  return Math.max(1, Number(process.env.CACHE_HOURS) || 12);
}

function cacheEnabled() {
  return String(process.env.ENABLE_CACHE || "true").toLowerCase() !== "false";
}

function apiKey() {
  return process.env.YOUTUBE_API_KEY || "";
}

function region() {
  return process.env.YOUTUBE_REGION || "US";
}

function defaultLanguage() {
  return normalizeLanguage(process.env.DEFAULT_LANGUAGE || "english");
}

function queryForCategory(category) {
  const clean = normalizeCategory(category);
  if (clean === "all" || clean === "for-you") return "trending shorts";
  if (clean === "coding") return "coding programming shorts";
  if (clean === "stock-market") return "stock market finance shorts";
  if (clean === "street-food") return "street food shorts";
  return `${clean.replace(/-/g, " ")} shorts`;
}

function youtubeUrl(path, params) {
  const query = new URLSearchParams({ key: apiKey(), ...params });
  return `https://www.googleapis.com/youtube/v3/${path}?${query.toString()}`;
}

function videoIdFromItem(item) {
  return item.id?.videoId || item.id;
}

function toCachedVideo(item, queryKey, category) {
  const videoId = videoIdFromItem(item);
  if (!videoId || !item.snippet?.title) return null;
  const thumb = item.snippet.thumbnails?.maxres?.url || item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || "";
  return {
    provider: "youtube",
    providerVideoId: videoId,
    queryKey,
    category: normalizeCategory(category),
    language: defaultLanguage(),
    region: region(),
    title: item.snippet.title,
    description: item.snippet.description || "",
    channelId: item.snippet.channelId || "",
    channelTitle: item.snippet.channelTitle || "YouTube Creator",
    thumbnailUrl: thumb,
    embedUrl: `https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1&enablejsapi=1`,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt: item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + cacheHours() * 60 * 60 * 1000),
    etag: item.etag || "",
    raw: item,
  };
}

async function fetchYouTubeSearch({ query, category, accountId, action }) {
  if (!apiKey()) throw new Error("YOUTUBE_API_KEY is not configured");
  const url = youtubeUrl("search", {
    part: "snippet",
    type: "video",
    videoDuration: "short",
    videoEmbeddable: "true",
    safeSearch: "moderate",
    order: category === "trending" ? "viewCount" : "relevance",
    maxResults: "25",
    regionCode: region(),
    q: query,
  });
  const response = await fetch(url, { headers: { "User-Agent": "SyncWave Discover/1.0" }, timeout: 10000 });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    await logUsage({ accountId, action: "api-error", query, ok: false, message: `YouTube ${response.status} ${text.slice(0, 120)}` }).catch(() => null);
    throw new Error(`YouTube API unavailable (${response.status})`);
  }
  const data = await response.json();
  await logUsage({ accountId, action, query, ok: true }).catch(() => null);
  return (data.items || []).map((item) => toCachedVideo(item, slug(query), category)).filter(Boolean);
}

async function upsertCachedVideos(videos) {
  if (!videos.length || !cacheEnabled()) return videos;
  await CachedVideo.bulkWrite(videos.map((video) => ({
    updateOne: {
      filter: { provider: "youtube", providerVideoId: video.providerVideoId },
      update: { $set: video },
      upsert: true,
    },
  })), { ordered: false });
  return videos;
}

async function creatorForVideo(video) {
  const handle = slug(video.channelTitle || video.channelId || "youtube-creator", "youtube-creator").slice(0, 80);
  return Creator.findOneAndUpdate(
    { handle },
    {
      $setOnInsert: {
        handle,
        displayName: video.channelTitle || "YouTube Creator",
        avatarUrl: "",
        verified: false,
      },
    },
    { upsert: true, new: true }
  );
}

async function materializeReels(videos) {
  const reels = [];
  for (const video of videos) {
    const creator = await creatorForVideo(video);
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

async function cachedVideosFor(category, limit = 25) {
  const query = { provider: "youtube" };
  const normalized = normalizeCategory(category || "all");
  if (normalized && !["all", "for-you"].includes(normalized)) query.category = normalized;
  return CachedVideo.find(query).sort({ fetchedAt: -1, publishedAt: -1 }).limit(limit).lean();
}

async function ensureVideosForCategory({ accountId, category = "trending", limit = 25 } = {}) {
  const normalized = normalizeCategory(category);
  const cached = await cachedVideosFor(normalized, limit);
  const freshEnough = cached.some((item) => item.expiresAt && new Date(item.expiresAt).getTime() > Date.now());
  if (freshEnough || !apiKey()) {
    await logUsage({ accountId, action: "cache-hit", query: normalized, ok: true }).catch(() => null);
    return materializeReels(cached.slice(0, limit));
  }
  try {
    const videos = await fetchYouTubeSearch({ query: queryForCategory(normalized), category: normalized, accountId, action: "auto-fetch" });
    await upsertCachedVideos(videos);
    return materializeReels(videos.slice(0, limit));
  } catch (err) {
    return materializeReels(cached.slice(0, limit));
  }
}

async function bootstrapDiscoverCache(accountId) {
  const categories = DEFAULT_QUERIES.map((query) => query.replace(" shorts", ""));
  for (const category of categories.slice(0, 5)) {
    await ensureVideosForCategory({ accountId, category, limit: 10 });
  }
}

async function searchYouTubeWithQuota({ accountId, query }) {
  const usage = await searchUsage(accountId);
  const clean = String(query || "").trim().slice(0, 180);
  const cached = await CachedVideo.find({
    provider: "youtube",
    $or: [
      { title: { $regex: clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { description: { $regex: clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { queryKey: slug(clean) },
    ],
  }).sort({ fetchedAt: -1 }).limit(24).lean();
  if (usage.exhausted || !apiKey()) {
    return { videos: await materializeReels(cached), quota: usage, fromCache: true };
  }
  try {
    const videos = await fetchYouTubeSearch({ query: `${clean} shorts`, category: "trending", accountId, action: "manual-search" });
    await upsertCachedVideos(videos);
    await TrendingKeyword.findOneAndUpdate(
      { keyword: slug(clean), category: "search" },
      { $inc: { score: 1 }, $set: { lastSearchedAt: new Date() } },
      { upsert: true }
    );
    const nextUsage = await searchUsage(accountId);
    return { videos: await materializeReels(videos), quota: nextUsage, fromCache: false };
  } catch (err) {
    return { videos: await materializeReels(cached), quota: await searchUsage(accountId), fromCache: true, error: err.message };
  }
}

module.exports = {
  bootstrapDiscoverCache,
  ensureVideosForCategory,
  searchYouTubeWithQuota,
  searchUsage,
};
