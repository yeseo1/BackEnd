import express from "express";
import { requireAuth } from "../middlewares/auth.js";
import { sessionController } from "../controllers/sessionController.js";

const router = express.Router();

router.post("/", requireAuth, sessionController.createSession);
router.post("/:sessionId/join", requireAuth, sessionController.joinSession);
router.get("/:sessionId/status", requireAuth, sessionController.getSessionStatus);

export default router;