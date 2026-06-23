const express = require("express");
const { authRequired } = require("../middleware/auth");
const {
  generateSong,
  getJob,
  generateInstrumentalEndpoint,
  generateVocalsEndpoint,
  listGeneratedSongs,
  deleteGeneratedSong,
} = require("../controllers/aiMusic.controller");

const router = express.Router();

router.post("/generate-song", authRequired, generateSong);
router.get("/generation-jobs/:jobId", authRequired, getJob);
router.get("/generated-songs", authRequired, listGeneratedSongs);
router.delete("/generated-songs/:id", authRequired, deleteGeneratedSong);
router.post("/generate-instrumental", authRequired, generateInstrumentalEndpoint);
router.post("/generate-vocals", authRequired, generateVocalsEndpoint);

module.exports = router;
