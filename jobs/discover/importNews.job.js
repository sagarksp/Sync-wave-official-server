const { aggregateNews } = require("../../services/discover/newsAggregation.service");

async function runDiscoverNewsImport(options = {}) {
  return aggregateNews(options);
}

module.exports = { runDiscoverNewsImport };
