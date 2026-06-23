const express = require("express");
const { authRequired } = require("../middleware/auth");
const { ttsStatus } = require("../controllers/tts.controller");

const router = express.Router();

router.get("/status", authRequired, ttsStatus);

module.exports = router;
