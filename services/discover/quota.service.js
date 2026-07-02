const { ApiUsage, SearchUsage } = require("../../models/discover");
const { discoverLog } = require("./logger");

function dateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function maxSearchPerDay() {
  return Math.max(1, Number(process.env.MAX_SEARCH_PER_DAY) || 5);
}

function warningLimit() {
  return Math.max(1, Number(process.env.SEARCH_WARNING_LIMIT) || 4);
}

function resetAtForTomorrow(now = new Date()) {
  const resetAt = new Date(now);
  resetAt.setDate(resetAt.getDate() + 1);
  resetAt.setHours(0, 0, 0, 0);
  return resetAt;
}

async function searchUsage(accountId) {
  const key = dateKey();
  const usage = accountId ? await SearchUsage.findOne({ userId: accountId, date: key }).lean() : null;
  const used = usage?.searchCount || 0;
  return {
    dateKey: key,
    used,
    max: maxSearchPerDay(),
    warningLimit: warningLimit(),
    warning: used >= warningLimit() && used < maxSearchPerDay(),
    exhausted: used >= maxSearchPerDay(),
    remaining: Math.max(0, maxSearchPerDay() - used),
    resetAt: usage?.resetAt || resetAtForTomorrow(),
  };
}

async function consumeSearch(accountId, keyword) {
  const key = dateKey();
  const current = await searchUsage(accountId);
  if (current.used >= maxSearchPerDay()) {
    discoverLog("RateLimit", "search_limit_reached", {
      userId: accountId?.toString(),
      keyword,
      searchCount: current.used,
      remaining: 0,
      resetAt: current.resetAt,
    });
    const err = new Error("Free search limit reached. Upgrade later or wait until tomorrow.");
    err.status = 429;
    err.payload = {
      message: "Free search limit reached. Upgrade later or wait until tomorrow.",
      remaining: 0,
      resetAt: current.resetAt,
    };
    throw err;
  }
  const updated = await SearchUsage.findOneAndUpdate(
    { userId: accountId, date: key },
    {
      $inc: { searchCount: 1 },
      $setOnInsert: { userId: accountId, date: key, resetAt: resetAtForTomorrow() },
    },
    { upsert: true, new: true }
  ).lean();
  discoverLog("RateLimit", "search_count_incremented", {
    userId: accountId?.toString(),
    keyword,
    searchCount: updated.searchCount,
    remaining: Math.max(0, maxSearchPerDay() - updated.searchCount),
  });
  return searchUsage(accountId);
}

async function logUsage({ accountId, action, query = "", ok = true, message = "", units = 1 }) {
  await ApiUsage.create({
    accountId,
    provider: "youtube",
    dateKey: dateKey(),
    action,
    query: String(query || "").slice(0, 180),
    ok,
    message: String(message || "").slice(0, 300),
    units,
  });
}

module.exports = { consumeSearch, dateKey, logUsage, searchUsage };
