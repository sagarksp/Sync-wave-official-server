function emitSongGeneration(io, userId, event, payload) {
  if (!io || !userId) return;
  io.to(String(userId)).emit(event, payload);
}

function emitStarted(io, userId, payload) {
  emitSongGeneration(io, userId, "song_generation_started", payload);
}

function emitProgress(io, userId, payload) {
  emitSongGeneration(io, userId, "song_generation_progress", payload);
}

function emitCompleted(io, userId, payload) {
  emitSongGeneration(io, userId, "song_generation_completed", payload);
}

function emitFailed(io, userId, payload) {
  emitSongGeneration(io, userId, "song_generation_failed", payload);
}

module.exports = { emitStarted, emitProgress, emitCompleted, emitFailed };
