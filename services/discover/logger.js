function discoverLog(scope, event, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    scope,
    event,
    ...meta,
  };
  const level = meta.error || meta.stack ? "error" : "log";
  console[level](`[Discover:${scope}] ${event}`, entry);
}

module.exports = { discoverLog };
