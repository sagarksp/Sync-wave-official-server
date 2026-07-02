const mongoose = require("mongoose");
const {
  Bookmark,
  Category,
  Comment,
  Creator,
  FeedArticle,
  Follow,
  Language,
  Like,
  Notification,
  Reel,
  SearchHistory,
  Share,
  TrendingKeyword,
} = require("../../models/discover");
const { CATEGORIES, LANGUAGES } = require("../../models/discover/constants");
const { aggregateNews } = require("../../services/discover/newsAggregation.service");
const { persistRecommendations, recordSignal, recommendedArticles, recommendedReels } = require("../../services/discover/recommendation.service");
const { normalizeCategory, normalizeLanguage, publicTaxonomy, slug } = require("../../services/discover/taxonomy");
const { saveBase64Video } = require("../../services/discover/videoUpload.service");
const { adminStats } = require("../../services/discover/admin.service");
const { bootstrapDiscoverCache, searchUsage } = require("../../services/discover/youtube.service");
const reelsService = require("../../services/discover/reelsService");
const { discoverLog } = require("../../services/discover/logger");

function listParam(value, normalizer) {
  if (!value || value === "all") return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return raw.map((item) => normalizer(item)).filter(Boolean);
}

function dateFilter(query) {
  const preset = String(query.date || "").toLowerCase();
  const now = new Date();
  const start = new Date(now);
  if (preset === "today") start.setHours(0, 0, 0, 0);
  else if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start, to: end };
  } else if (preset === "last-3-days") start.setDate(start.getDate() - 3);
  else if (preset === "last-week") start.setDate(start.getDate() - 7);
  else if (preset === "last-month") start.setMonth(start.getMonth() - 1);
  else if (preset === "last-year") start.setFullYear(start.getFullYear() - 1);
  else if (query.from || query.to) {
    return {
      from: query.from ? new Date(query.from) : null,
      to: query.to ? new Date(query.to) : null,
    };
  } else return {};
  return { from: start, to: now };
}

function objectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || "")) ? value : null;
}

function articlePayload(item, flags = {}) {
  return {
    id: item._id.toString(),
    title: item.title,
    description: item.description,
    imageUrl: item.imageUrl,
    source: item.source,
    author: item.author || "",
    category: item.category,
    language: item.language,
    publishedAt: item.publishedAt,
    readingTimeMinutes: item.readingTimeMinutes,
    url: item.url,
    tags: item.tags || [],
    stats: item.stats || {},
    recommendationScore: item.recommendationScore || item.score || 0,
    liked: Boolean(flags.liked),
    saved: Boolean(flags.saved),
  };
}

function reelPayload(item, flags = {}) {
  const creator = item.creatorId && typeof item.creatorId === "object" ? item.creatorId : null;
  return {
    id: item._id.toString(),
    title: item.title,
    description: item.description,
    videoUrl: item.videoUrl,
    provider: item.provider || "upload",
    providerVideoId: item.providerVideoId || "",
    embedUrl: item.embedUrl || item.videoUrl,
    watchUrl: item.watchUrl || item.videoUrl,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    category: item.category,
    language: item.language,
    hashtags: item.hashtags || [],
    source: item.source,
    publishedAt: item.publishedAt,
    stats: item.stats || {},
    recommendationScore: item.recommendationScore || item.score || 0,
    creator: creator ? {
      id: creator._id.toString(),
      handle: creator.handle,
      displayName: creator.displayName,
      avatarUrl: creator.avatarUrl,
      verified: creator.verified,
    } : null,
    liked: Boolean(flags.liked),
    saved: Boolean(flags.saved),
    followed: Boolean(flags.followed),
  };
}

async function flagsFor(accountId, itemType, ids) {
  const [likes, bookmarks] = await Promise.all([
    Like.find({ accountId, itemType, itemId: { $in: ids } }).lean(),
    Bookmark.find({ accountId, itemType, itemId: { $in: ids } }).lean(),
  ]);
  const liked = new Set(likes.map((item) => item.itemId.toString()));
  const saved = new Set(bookmarks.map((item) => item.itemId.toString()));
  return { liked, saved };
}

async function getMeta(req, res) {
  const seededCategories = CATEGORIES.map((key) => ({ updateOne: { filter: { key }, update: { $setOnInsert: { key, label: key.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join(" "), type: "both" } }, upsert: true } }));
  const seededLanguages = LANGUAGES.map((key) => ({ updateOne: { filter: { key }, update: { $setOnInsert: { key, label: publicTaxonomy().languages.find((item) => item.key === key)?.label || key } }, upsert: true } }));
  await Promise.all([
    Category.bulkWrite(seededCategories, { ordered: false }).catch(() => null),
    Language.bulkWrite(seededLanguages, { ordered: false }).catch(() => null),
  ]);
  const [categories, languages] = await Promise.all([
    Category.find({ active: true }).sort({ label: 1 }).lean(),
    Language.find({ active: true }).sort({ label: 1 }).lean(),
  ]);
  res.json({
    categories: categories.map((item) => ({ key: item.key, label: item.label, type: item.type })),
    languages: languages.map((item) => ({ key: item.key, label: item.label, isoCode: item.isoCode })),
    quota: await searchUsage(req.user._id),
  });
}

async function refreshNews(req, res) {
  const categories = listParam(req.body.categories || req.query.categories, normalizeCategory);
  const languages = listParam(req.body.languages || req.query.languages, normalizeLanguage);
  const result = await aggregateNews({ categories: categories.length ? categories : ["general", "technology", "ai", "business", "sports"], languages: languages.length ? languages : ["english"] });
  res.json({ ok: true, ...result });
}

async function getFeed(req, res) {
  const startedAt = Date.now();
  const limit = Math.min(30, Math.max(5, Number(req.query.limit) || 12));
  const page = Math.max(0, Number(req.query.page) || 0);
  const filters = {
    categories: listParam(req.query.categories, normalizeCategory),
    languages: listParam(req.query.languages, normalizeLanguage),
    sort: ["oldest", "popular", "latest", "newest"].includes(String(req.query.sort || "")) ? String(req.query.sort) : "latest",
    ...dateFilter(req.query),
  };
  discoverLog("Request", "incoming_feed", {
    userId: req.user._id.toString(),
    page,
    limit,
    categories: filters.categories,
    languages: filters.languages,
    date: req.query.date,
    sort: filters.sort,
  });
  if (await FeedArticle.estimatedDocumentCount() === 0) {
    await aggregateNews({ categories: filters.categories.length ? filters.categories : ["general", "technology", "ai"], languages: filters.languages.length ? filters.languages : ["english"] }).catch((err) => {
      discoverLog("Error", "feed_initial_aggregate_failed", { error: err.message, stack: err.stack });
    });
  }
  let items = await recommendedArticles(req.user._id, filters, limit, page * limit);
  if (!items.length && page === 0) {
    discoverLog("Cache", "feed_miss_refreshing", { categories: filters.categories, languages: filters.languages });
    await aggregateNews({ categories: filters.categories.length ? filters.categories : ["general"], languages: filters.languages.length ? filters.languages : ["english"] }).catch((err) => {
      discoverLog("Error", "feed_aggregate_failed", { error: err.message, stack: err.stack });
    });
    items = await recommendedArticles(req.user._id, filters, limit, page * limit);
  }
  await persistRecommendations(req.user._id, "article", items);
  const articleIds = items.map((item) => item._id);
  const articleFlags = await flagsFor(req.user._id, "article", articleIds);
  const payload = {
    articles: items.map((item) => ({ ...articlePayload(item, { liked: articleFlags.liked.has(item._id.toString()), saved: articleFlags.saved.has(item._id.toString()) }), feedType: "article" })),
    nextPage: items.length === limit ? page + 1 : null,
  };
  discoverLog("Response", "feed_response", { count: payload.articles.length, page, responseTimeMs: Date.now() - startedAt });
  res.json(payload);
}

async function getReels(req, res) {
  const startedAt = Date.now();
  const limit = Math.min(20, Math.max(3, Number(req.query.limit) || 8));
  const page = Math.max(0, Number(req.query.page) || 0);
  const requestedCategory = req.query.category || req.query.categories || "all";
  const categories = listParam(requestedCategory, normalizeCategory);
  const category = categories[0] || normalizeCategory(requestedCategory) || "all";
  discoverLog("Request", "incoming_reels", { userId: req.user._id.toString(), category, pageToken: String(req.query.pageToken || ""), limit });
  const fetched = await reelsService.fetchReels({ accountId: req.user._id, category, pageToken: String(req.query.pageToken || "") });
  const filters = { categories: ["all", "for-you", "trending"].includes(category) ? [] : [category] };
  const recommended = await recommendedReels(req.user._id, filters, limit, page * limit);
  const merged = new Map();
  [...recommended, ...(fetched.reels || [])].forEach((item) => {
    if (item?._id) merged.set(item._id.toString(), item);
  });
  const items = Array.from(merged.values()).slice(0, limit);
  await persistRecommendations(req.user._id, "reel", items);
  const ids = items.map((item) => item._id);
  const [flags, follows] = await Promise.all([
    flagsFor(req.user._id, "reel", ids),
    Follow.find({ accountId: req.user._id, creatorId: { $in: items.map((item) => item.creatorId?._id || item.creatorId).filter(Boolean) } }).lean(),
  ]);
  const followed = new Set(follows.map((item) => item.creatorId.toString()));
  const payload = {
    reels: items.map((item) => reelPayload(item, {
      liked: flags.liked.has(item._id.toString()),
      saved: flags.saved.has(item._id.toString()),
      followed: item.creatorId && followed.has((item.creatorId._id || item.creatorId).toString()),
    })),
    nextPage: fetched.nextPageToken ? page + 1 : null,
    nextPageToken: fetched.nextPageToken || "",
    fromCache: Boolean(fetched.fromCache),
    recommendationSource: fetched.recommendationSource || (fetched.fromCache ? "cache" : "youtube"),
  };
  discoverLog("Response", "reels_response", { category, count: payload.reels.length, fromCache: payload.fromCache, responseTimeMs: Date.now() - startedAt });
  res.json(payload);
}

async function searchReels(req, res) {
  const startedAt = Date.now();
  const q = String(req.query.q || "").trim().slice(0, 180);
  discoverLog("Request", "incoming_reels_search", { userId: req.user._id.toString(), keyword: q });
  try {
    const result = await reelsService.searchReels({ accountId: req.user._id, q });
    const payload = {
      reels: (result.reels || []).map((item) => reelPayload(item)),
      nextPageToken: result.nextPageToken || "",
      fromCache: Boolean(result.fromCache),
      quota: result.quota || await searchUsage(req.user._id),
      recommendationSource: result.recommendationSource || (result.fromCache ? "cache" : "youtube"),
    };
    discoverLog("Response", "reels_search_response", { keyword: q, count: payload.reels.length, fromCache: payload.fromCache, responseTimeMs: Date.now() - startedAt });
    res.json(payload);
  } catch (err) {
    discoverLog("Error", "reels_search_failed", { keyword: q, error: err.message, stack: err.stack, status: err.status || 500, responseTimeMs: Date.now() - startedAt });
    res.status(err.status || 500).json(err.payload || { message: "Search temporarily unavailable", remaining: 0 });
  }
}

async function interact(req, res) {
  const itemType = req.params.type === "reels" ? "reel" : "article";
  const itemId = objectId(req.params.id);
  if (!itemId) return res.status(400).json({ error: "Invalid item id" });
  const action = String(req.body.action || "").toLowerCase();
  const Model = itemType === "article" ? FeedArticle : Reel;
  const item = await Model.findById(itemId);
  if (!item) return res.status(404).json({ error: "Item not found" });

  if (action === "like") {
    await Like.updateOne({ accountId: req.user._id, itemType, itemId }, { $setOnInsert: { accountId: req.user._id, itemType, itemId } }, { upsert: true });
    await Model.updateOne({ _id: itemId }, { $inc: { "stats.likes": 1, trendingScore: 4 } });
  } else if (action === "unlike") {
    const deleted = await Like.deleteOne({ accountId: req.user._id, itemType, itemId });
    if (deleted.deletedCount) await Model.updateOne({ _id: itemId }, { $inc: { "stats.likes": -1 } });
  } else if (action === "save") {
    await Bookmark.updateOne({ accountId: req.user._id, itemType, itemId }, { $setOnInsert: { accountId: req.user._id, itemType, itemId } }, { upsert: true });
    await Model.updateOne({ _id: itemId }, { $inc: { "stats.saves": 1, trendingScore: 5 } });
  } else if (action === "unsave") {
    const deleted = await Bookmark.deleteOne({ accountId: req.user._id, itemType, itemId });
    if (deleted.deletedCount) await Model.updateOne({ _id: itemId }, { $inc: { "stats.saves": -1 } });
  } else if (["view", "read", "watch", "complete", "skip", "replay", "ignore", "share"].includes(action)) {
    const statKey = action === "share" ? "shares" : action === "ignore" ? "ignores" : action === "complete" ? "completions" : action === "skip" ? "skips" : action === "replay" ? "replays" : "views";
    await Model.updateOne({ _id: itemId }, { $inc: { [`stats.${statKey}`]: 1, trendingScore: action === "ignore" || action === "skip" ? -1 : 1 } });
    if (action === "share") await Share.create({ accountId: req.user._id, itemType, itemId, target: req.body.target || "native" }).catch(() => null);
  } else {
    return res.status(400).json({ error: "Unsupported action" });
  }

  await recordSignal(req.user._id, {
    itemType,
    itemId,
    event: action === "share" ? "share" : action,
    category: item.category,
    language: item.language,
    topics: item.tags || item.hashtags || [],
    creatorId: item.creatorId,
    seconds: req.body.seconds,
    completionRate: req.body.completionRate,
    sessionId: req.body.sessionId,
  });
  res.json({ ok: true });
}

async function getComments(req, res) {
  const itemType = req.params.type === "reels" ? "reel" : "article";
  const itemId = objectId(req.params.id);
  const comments = await Comment.find({ itemType, itemId, status: "active" }).sort({ createdAt: -1 }).limit(80).populate("accountId", "username displayName avatarUrl").lean();
  res.json({ comments: comments.map((item) => ({
    id: item._id.toString(),
    body: item.body,
    createdAt: item.createdAt,
    user: {
      id: item.accountId?._id?.toString() || "",
      username: item.accountId?.username || "",
      displayName: item.accountId?.displayName || item.accountId?.username || "SyncWave User",
      avatarUrl: item.accountId?.avatarUrl || "",
    },
  })) });
}

async function addComment(req, res) {
  const itemType = req.params.type === "reels" ? "reel" : "article";
  const itemId = objectId(req.params.id);
  const body = String(req.body.body || "").trim().slice(0, 1200);
  if (!itemId || !body) return res.status(400).json({ error: "Comment body required" });
  const Model = itemType === "article" ? FeedArticle : Reel;
  const item = await Model.findById(itemId);
  if (!item) return res.status(404).json({ error: "Item not found" });
  const comment = await Comment.create({ accountId: req.user._id, itemType, itemId, body });
  await Model.updateOne({ _id: itemId }, { $inc: { "stats.comments": 1, trendingScore: 3 } });
  await recordSignal(req.user._id, { itemType, itemId, event: "comment", category: item.category, language: item.language, topics: item.tags || item.hashtags || [], creatorId: item.creatorId });
  res.status(201).json({ comment: { id: comment._id.toString(), body: comment.body, createdAt: comment.createdAt } });
}

async function search(req, res) {
  const startedAt = Date.now();
  const q = String(req.query.q || "").trim().slice(0, 180);
  const scope = String(req.query.scope || "all");
  if (!q) return res.json({ articles: [], reels: [], creators: [], topics: [], quota: await searchUsage(req.user._id), recent: [] });
  discoverLog("Request", "incoming_search", { userId: req.user._id.toString(), keyword: q, scope });
  const text = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  try {
    const [articles, youtube, creators, recent] = await Promise.all([
      scope === "all" || scope === "articles" ? FeedArticle.find({ status: { $in: ["active", "featured"] }, $or: [{ title: text }, { description: text }, { source: text }, { category: text }, { language: text }] }).sort({ publishedAt: -1 }).limit(12).lean() : [],
      scope === "all" || scope === "reels" ? reelsService.searchReels({ accountId: req.user._id, q }) : { reels: [], quota: await searchUsage(req.user._id), fromCache: true },
      scope === "all" || scope === "creators" ? Creator.find({ $or: [{ handle: text }, { displayName: text }, { bio: text }] }).limit(12).lean() : [],
      SearchHistory.find({ accountId: req.user._id }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const reels = youtube.reels || [];
    const topics = Array.from(new Set([...CATEGORIES, ...LANGUAGES].filter((item) => item.includes(slug(q, ""))).slice(0, 20)));
    await SearchHistory.create({ accountId: req.user._id, query: q, scope: ["all", "articles", "reels", "creators", "topics"].includes(scope) ? scope : "all", resultCount: articles.length + reels.length + creators.length + topics.length });
    await recordSignal(req.user._id, { event: "search", topics: [slug(q)] });
    const payload = {
      articles: articles.map((item) => articlePayload(item)),
      reels: reels.map((item) => reelPayload(item)),
      creators: creators.map((item) => ({ id: item._id.toString(), handle: item.handle, displayName: item.displayName, avatarUrl: item.avatarUrl, verified: item.verified })),
      topics,
      quota: youtube.quota || await searchUsage(req.user._id),
      fromCache: Boolean(youtube.fromCache),
      recommendationSource: youtube.recommendationSource || (youtube.fromCache ? "cache" : "youtube"),
      recent: recent.map((item) => item.query),
    };
    discoverLog("Response", "search_response", { keyword: q, scope, reels: payload.reels.length, articles: payload.articles.length, responseTimeMs: Date.now() - startedAt });
    res.json(payload);
  } catch (err) {
    discoverLog("Error", "search_failed", { keyword: q, scope, status: err.status || 500, error: err.message, stack: err.stack });
    res.status(err.status || 500).json(err.payload || { message: "Search temporarily unavailable", remaining: 0 });
  }
}

async function trending(req, res) {
  const [articles, reels, searches, keywords] = await Promise.all([
    FeedArticle.find({ status: { $in: ["active", "featured"] } }).sort({ trendingScore: -1, publishedAt: -1 }).limit(10).lean(),
    Reel.find({ status: { $in: ["approved", "featured"] } }).populate("creatorId").sort({ trendingScore: -1, publishedAt: -1 }).limit(10).lean(),
    SearchHistory.aggregate([{ $group: { _id: "$query", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    TrendingKeyword.find({}).sort({ score: -1, lastSearchedAt: -1 }).limit(16).lean(),
  ]);
  const topics = Array.from(new Set([...keywords.map((item) => item.keyword), ...articles.map((item) => item.category), ...reels.flatMap((item) => item.hashtags || [])])).slice(0, 16);
  res.json({
    hashtags: topics.filter((item) => item.startsWith("#") || item.length).map((item) => item.startsWith("#") ? item : `#${item}`),
    topics,
    articles: articles.map((item) => articlePayload(item)),
    reels: reels.map((item) => reelPayload(item)),
    searches: searches.map((item) => ({ query: item._id, count: item.count })),
  });
}

async function quota(req, res) {
  res.json({ quota: await searchUsage(req.user._id) });
}

async function adminDashboard(req, res) {
  res.json({ stats: await adminStats() });
}

async function adminRefreshCache(req, res) {
  await bootstrapDiscoverCache(req.user._id);
  res.json({ ok: true, stats: await adminStats() });
}

async function bookmarks(req, res) {
  const rows = await Bookmark.find({ accountId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  const articleIds = rows.filter((item) => item.itemType === "article").map((item) => item.itemId);
  const reelIds = rows.filter((item) => item.itemType === "reel").map((item) => item.itemId);
  const [articles, reels] = await Promise.all([
    FeedArticle.find({ _id: { $in: articleIds } }).lean(),
    Reel.find({ _id: { $in: reelIds } }).populate("creatorId").lean(),
  ]);
  res.json({ articles: articles.map((item) => articlePayload(item, { saved: true })), reels: reels.map((item) => reelPayload(item, { saved: true })) });
}

async function uploadReel(req, res) {
  const videoUrl = req.body.videoDataUrl ? await saveBase64Video({ accountId: req.user._id, dataUrl: req.body.videoDataUrl }) : String(req.body.videoUrl || "").trim();
  if (!videoUrl) return res.status(400).json({ error: "Video is required" });
  const handle = slug(req.body.creatorHandle || req.user.username, req.user.username);
  const creator = await Creator.findOneAndUpdate(
    { handle },
    {
      $setOnInsert: {
        ownerAccountId: req.user._id,
        handle,
        displayName: req.body.creatorName || req.user.displayName || req.user.username,
        avatarUrl: req.user.avatarUrl || "",
      },
    },
    { upsert: true, new: true }
  );
  const reel = await Reel.create({
    creatorId: creator._id,
    uploaderAccountId: req.user._id,
    title: String(req.body.title || "Untitled reel").trim().slice(0, 180),
    description: String(req.body.description || "").trim().slice(0, 900),
    videoUrl,
    thumbnailUrl: String(req.body.thumbnailUrl || "").trim().slice(0, 2000),
    durationSeconds: Math.max(0, Number(req.body.durationSeconds) || 0),
    category: normalizeCategory(req.body.category || "news"),
    language: normalizeLanguage(req.body.language || "english"),
    hashtags: listParam(req.body.hashtags, (value) => `#${slug(value, "topic")}`).slice(0, 12),
    source: req.body.adminUpload ? "admin" : "user",
    status: req.body.adminUpload ? "approved" : "pending",
  });
  await Creator.updateOne({ _id: creator._id }, { $inc: { "stats.reels": 1 } });
  res.status(201).json({ reel: reelPayload({ ...reel.toObject(), creatorId: creator }) });
}

async function followCreator(req, res) {
  const creatorId = objectId(req.params.creatorId);
  if (!creatorId) return res.status(400).json({ error: "Invalid creator id" });
  const action = String(req.body.action || "follow");
  if (action === "unfollow") {
    const deleted = await Follow.deleteOne({ accountId: req.user._id, creatorId });
    if (deleted.deletedCount) await Creator.updateOne({ _id: creatorId }, { $inc: { "stats.followers": -1 } });
  } else {
    await Follow.updateOne({ accountId: req.user._id, creatorId }, { $setOnInsert: { accountId: req.user._id, creatorId } }, { upsert: true });
    await Creator.updateOne({ _id: creatorId }, { $inc: { "stats.followers": 1 } });
    await recordSignal(req.user._id, { event: "follow", creatorId });
  }
  res.json({ ok: true });
}

async function notifications(req, res) {
  const rows = await Notification.find({ accountId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ notifications: rows.map((item) => ({ id: item._id.toString(), type: item.type, title: item.title, body: item.body, readAt: item.readAt, createdAt: item.createdAt })) });
}

async function adminModerateReel(req, res) {
  const reel = await Reel.findByIdAndUpdate(req.params.id, { $set: { status: String(req.body.status || "approved") } }, { new: true }).populate("creatorId").lean();
  if (!reel) return res.status(404).json({ error: "Reel not found" });
  res.json({ reel: reelPayload(reel) });
}

async function adminFeatureArticle(req, res) {
  const article = await FeedArticle.findByIdAndUpdate(req.params.id, { $set: { status: req.body.featured === false ? "active" : "featured" } }, { new: true }).lean();
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json({ article: articlePayload(article) });
}

module.exports = {
  addComment,
  adminFeatureArticle,
  adminDashboard,
  adminModerateReel,
  adminRefreshCache,
  bookmarks,
  followCreator,
  getComments,
  getFeed,
  getMeta,
  getReels,
  searchReels,
  interact,
  notifications,
  quota,
  refreshNews,
  search,
  trending,
  uploadReel,
};
