const express = require("express");
const authController = require("../controllers/auth.controller");
const { requireAuth } = require("../middlewares/auth.middleware");
const { authRateLimiter, signInRateLimiter } = require("../middlewares/rate-limit.middleware");
const { uploadProfileImage } = require("../middlewares/upload.middleware");

const router = express.Router();

router.get("/check-login-id", authRateLimiter, authController.checkLoginId);
router.post("/sign-up", authRateLimiter, uploadProfileImage("profileImage"), authController.signUp);
router.post("/sign-in", signInRateLimiter, authController.signIn);
router.post("/find-id", authRateLimiter, authController.findId);
router.post("/find-password", signInRateLimiter, authController.findPassword);
router.get("/me", requireAuth, authController.me);
router.post("/sign-out", authController.signOut);

module.exports = router;
