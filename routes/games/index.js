const express = require("express");
const { authRequired } = require("../../middleware/auth");
const controller = require("../../controllers/games/games.controller");

const router = express.Router();

router.use(authRequired);

router.get("/home", controller.getHome);
router.post("/rooms", controller.createRoom);
router.post("/rooms/join", controller.joinRoom);
router.post("/rooms/:code/join", controller.joinRoom);
router.post("/rooms/:code/leave", controller.leaveRoom);
router.post("/rooms/:code/start", controller.startMatch);
router.post("/rooms/:code/end", controller.endMatch);
router.get("/leaderboard", controller.getLeaderboard);
router.get("/history", controller.getMatchHistory);
router.post("/rewards/daily", controller.claimRewards);
router.post("/offline/sync", controller.syncOffline);

module.exports = router;
