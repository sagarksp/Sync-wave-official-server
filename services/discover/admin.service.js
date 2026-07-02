const { ApiUsage, CachedVideo, Reel, SearchHistory, UserInterest, WatchHistory } = require("../../models/discover");
const { dateKey } = require("./quota.service");

async function adminStats() {
  const today = dateKey();
  const [usage, cacheSize, watched, searched, categories, activeUsers, apiErrors] = await Promise.all([
    ApiUsage.countDocuments({ provider: "youtube", dateKey: today }),
    CachedVideo.countDocuments({ provider: "youtube" }),
    Reel.find({ status: { $in: ["approved", "featured"] } }).sort({ "stats.views": -1, trendingScore: -1 }).limit(10).lean(),
    SearchHistory.aggregate([{ $group: { _id: "$query", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    WatchHistory.aggregate([{ $group: { _id: "$category", seconds: { $sum: "$seconds" }, events: { $sum: 1 } } }, { $sort: { events: -1 } }, { $limit: 10 }]),
    UserInterest.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
    ApiUsage.countDocuments({ provider: "youtube", dateKey: today, action: "api-error" }),
  ]);
  return {
    usageToday: usage,
    cacheSize,
    apiHealth: apiErrors ? "degraded" : "healthy",
    mostWatchedVideos: watched.map((item) => ({ id: item._id.toString(), title: item.title, views: item.stats?.views || 0, category: item.category })),
    mostSearchedKeywords: searched.map((item) => ({ query: item._id, count: item.count })),
    popularCategories: categories.map((item) => ({ category: item._id, events: item.events, seconds: item.seconds })),
    activeUsers,
    recommendationStats: {
      trackedUsers: await UserInterest.countDocuments(),
      watchEvents: await WatchHistory.countDocuments(),
    },
  };
}

module.exports = { adminStats };
