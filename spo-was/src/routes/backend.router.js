const express = require("express");
const backendController = require("../controllers/backend.controller");
const authRouter = require("./auth.router");
const appRouter = require("./app.router");
const { appRateLimiter } = require("../middlewares/rate-limit.middleware");

const router = express.Router();

router.get("/health", backendController.health);
router.get("/db/health", backendController.dbHealth);
router.get("/hello", backendController.hello);
router.get("/auth", backendController.authGuide);
router.use("/auth", authRouter);
router.use("/app", appRateLimiter, appRouter);

module.exports = router;
