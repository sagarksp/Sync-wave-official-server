const { createAiProject } = require("../aiMusicService");

async function generateSongMetadata(input) {
  const project = await createAiProject(input);
  return {
    title: project.title,
    lyrics: project.lyrics,
    musicPrompt: project.musicPrompt,
    beatPrompt: project.beatPrompt,
    coverPrompt: project.coverPrompt,
    coverImage: project.coverImage,
    provider: project.provider,
  };
}

module.exports = { generateSongMetadata };
