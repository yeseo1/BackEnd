import express from "express";
import { requireAuth } from "../middlewares/auth.js";

import { authController } from "../controllers/authController.js";

const router = express.Router();

router.get("/google/login", authController.googleLogin);
router.get("/google/callback", authController.googleCallback);
router.post("/google/logout", requireAuth, authController.googleLogout);

export default router;