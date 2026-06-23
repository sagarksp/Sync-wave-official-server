let Bull = null;
try {
  Bull = require("bull");
} catch (err) {
  Bull = null;
}

const redisUrl = process.env.REDIS_URL || "";
const useBull = Boolean(Bull && redisUrl);

function createQueue(name) {
  if (!useBull) return null;
  return new Bull(name, redisUrl);
}

const lyricsQueue = createQueue("lyricsQueue");
const musicQueue = createQueue("musicQueue");
const ttsQueue = createQueue("ttsQueue");
const mergeQueue = createQueue("mergeQueue");

function assertSerializableQueueData(name, data) {
  try {
    JSON.stringify(data);
  } catch (err) {
    const keys = data && typeof data === "object" ? Object.keys(data) : [];
    console.error("[AI Queue] QUEUE_DATA_NOT_SERIALIZABLE", { name, keys, error: err.message });
    throw new Error(`${name} received non-serializable job data`);
  }
}

async function runStep(queue, name, data, handler) {
  assertSerializableQueueData(name, data);
  if (!queue) return handler(data);
  const job = await queue.add(data, { removeOnComplete: true, removeOnFail: 50 });
  return new Promise((resolve, reject) => {
    const onCompleted = (completedJob, result) => {
      if (completedJob.id !== job.id) return;
      cleanup();
      resolve(result);
    };
    const onFailed = (failedJob, err) => {
      if (failedJob.id !== job.id) return;
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      queue.off("completed", onCompleted);
      queue.off("failed", onFailed);
    };
    queue.on("completed", onCompleted);
    queue.on("failed", onFailed);
  });
}

function registerProcessors(handlers) {
  if (!useBull) return;
  lyricsQueue.process((job) => handlers.lyrics(job.data));
  musicQueue.process((job) => handlers.music(job.data));
  ttsQueue.process((job) => handlers.tts(job.data));
  mergeQueue.process((job) => handlers.merge(job.data));
}

module.exports = {
  lyricsQueue,
  musicQueue,
  ttsQueue,
  mergeQueue,
  runStep,
  registerProcessors,
  usingBull: useBull,
};
