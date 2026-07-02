const express = require("express");
const { authRequired } = require("../../middleware/auth");
const controller = require("../../controllers/discover/discover.controller");

const router = express.Router();

router.use(authRequired);

router.get("/meta", controller.getMeta);
router.get("/quota", controller.quota);
router.post("/refresh-news", controller.refreshNews);
router.get("/feed", controller.getFeed);
router.get("/reels/search", controller.searchReels);
router.get("/reels", controller.getReels);
router.post("/:type(articles|reels)/:id/interactions", controller.interact);
router.get("/:type(articles|reels)/:id/comments", controller.getComments);
router.post("/:type(articles|reels)/:id/comments", controller.addComment);
router.get("/search", controller.search);
router.get("/trending", controller.trending);
router.get("/bookmarks", controller.bookmarks);
router.post("/reels", controller.uploadReel);
router.post("/creators/:creatorId/follow", controller.followCreator);
router.get("/notifications", controller.notifications);
router.get("/admin/dashboard", controller.adminDashboard);
router.post("/admin/cache/refresh", controller.adminRefreshCache);
router.patch("/admin/reels/:id", controller.adminModerateReel);
router.patch("/admin/articles/:id/feature", controller.adminFeatureArticle);

module.exports = router;
