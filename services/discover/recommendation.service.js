const {
  FeedArticle,
  Reel,
  Recommendation,
  UserInterest,
  WatchHistory,
} = require("../../models/discover");

const SIGNAL_WEIGHTS = {
  view: 0.6,
  read: 1.4,
  watch: 1.1,
  complete: 2.2,
  like: 4,
  save: 5,
  share: 4.4,
  comment: 3.2,
  follow: 4,
  search: 1.8,
  replay: 2.4,
  skip: -1.4,
  ignore: -3.5,
};

function addMapScore(map, key, amount) {
  if (!key) return;
  map.set(key, Math.max(-50, Math.min(100, (map.get(key) || 0) + amount)));
}

async function recordSignal(accountId, signal) {
  const event = String(signal.event || "view");
  const weight = SIGNAL_WEIGHTS[event] ?? 1;
  const interest = await UserInterest.findOneAndUpdate(
    { accountId },
    { $setOnInsert: { categories: {}, languages: {}, topics: {}, creators: {} } },
    { upsert: true, new: true }
  );
  addMapScore(interest.categories, signal.category, weight);
  addMapScore(interest.languages, signal.language, weight * 0.6);
  (signal.topics || []).slice(0, 10).forEach((topic) => addMapScore(interest.topics, topic, weight * 0.8));
  if (signal.creatorId) addMapScore(interest.creators, signal.creatorId.toString(), weight);
  interest.lastSignalsAt = new Date();
  await interest.save();

  if (signal.itemId && ["article", "reel"].includes(signal.itemType)) {
    await WatchHistory.create({
      accountId,
      itemType: signal.itemType,
      itemId: signal.itemId,
      category: signal.category || "general",
      language: signal.language || "english",
      seconds: Math.max(0, Number(signal.seconds) || 0),
      completionRate: Math.max(0, Math.min(1, Number(signal.completionRate) || 0)),
      event: ["view", "read", "watch", "complete", "skip", "replay", "ignore"].includes(event) ? event : "view",
      sessionId: String(signal.sessionId || ""),
    });
  }
}

function scoreItem(item, interest, type) {
  const categories = interest?.categories || new Map();
  const languages = interest?.languages || new Map();
  const topics = interest?.topics || new Map();
  const ageHours = Math.max(0, (Date.now() - new Date(item.publishedAt || item.createdAt || Date.now()).getTime()) / 36e5);
  const freshness = Math.max(0, 22 - Math.log2(ageHours + 1) * 4);
  const popularity = Math.log10(1 + (item.trendingScore || 0) + (item.stats?.views || 0) + (item.stats?.likes || 0) * 3);
  let score = freshness + popularity;
  score += categories.get(item.category) || 0;
  score += (languages.get(item.language) || 0) * 0.55;
  (item.tags || item.hashtags || []).forEach((topic) => { score += (topics.get(topic) || 0) * 0.4; });
  if (type === "reel" && item.stats?.completions) score += Math.log10(1 + item.stats.completions) * 2;
  return Math.round(score * 100) / 100;
}

async function recommendedArticles(accountId, filters, limit, skip) {
  const interest = await UserInterest.findOne({ accountId });
  const query = { status: { $in: ["active", "featured"] } };
  if (filters.languages?.length) query.language = { $in: filters.languages };
  if (filters.categories?.length) query.category = { $in: filters.categories };
  if (filters.from || filters.to) query.publishedAt = {};
  if (filters.from) query.publishedAt.$gte = filters.from;
  if (filters.to) query.publishedAt.$lte = filters.to;
  const items = await FeedArticle.find(query).sort({ publishedAt: -1 }).limit(Math.min(120, limit + skip + 50)).lean();
  const scored = items
    .map((item) => ({ ...item, recommendationScore: scoreItem(item, interest, "article") }))
    .sort((a, b) => {
      if (filters.sort === "oldest") return new Date(a.publishedAt) - new Date(b.publishedAt);
      if (filters.sort === "popular") {
        const aScore = (a.trendingScore || 0) + (a.stats?.views || 0) + (a.stats?.likes || 0) * 3 + (a.stats?.shares || 0) * 4;
        const bScore = (b.trendingScore || 0) + (b.stats?.views || 0) + (b.stats?.likes || 0) * 3 + (b.stats?.shares || 0) * 4;
        return bScore - aScore || new Date(b.publishedAt) - new Date(a.publishedAt);
      }
      return new Date(b.publishedAt) - new Date(a.publishedAt) || b.recommendationScore - a.recommendationScore;
    });
  return scored.slice(skip, skip + limit);
}

async function recommendedReels(accountId, filters, limit, skip) {
  const interest = await UserInterest.findOne({ accountId });
  const query = { status: { $in: ["approved", "featured"] } };
  if (filters.categories?.length) query.category = { $in: filters.categories };
  const reels = await Reel.find(query).populate("creatorId").sort({ publishedAt: -1 }).limit(Math.min(180, limit + skip + 80)).lean();
  const scored = reels
    .map((item) => ({ ...item, recommendationScore: scoreItem(item, interest, "reel") }))
    .sort((a, b) => b.recommendationScore - a.recommendationScore || new Date(b.publishedAt) - new Date(a.publishedAt));
  const trending = [...reels].sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0)).slice(0, Math.ceil(limit * 0.2));
  const random = [...reels].sort(() => Math.random() - 0.5).slice(0, Math.ceil(limit * 0.1));
  const personalized = scored.slice(0, Math.ceil(limit * 0.7) + skip);
  const unique = new Map();
  [...personalized, ...trending, ...random, ...scored].forEach((item) => {
    const id = item._id.toString();
    if (!unique.has(id)) unique.set(id, item);
  });
  return Array.from(unique.values()).slice(skip, skip + limit);
}

async function persistRecommendations(accountId, itemType, items) {
  const operations = items.map((item) => ({
    updateOne: {
      filter: { accountId, itemType, itemId: item._id },
      update: {
        $set: {
          score: item.recommendationScore || 0,
          reasons: [item.category, item.language].filter(Boolean),
          generatedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));
  if (operations.length) await Recommendation.bulkWrite(operations, { ordered: false });
}

module.exports = { persistRecommendations, recordSignal, recommendedArticles, recommendedReels };
