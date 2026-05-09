import express from "express";

import { analysisController } from "../controllers/analysisController.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/:sessionId/analysis", requireAuth, analysisController.getAnalysis);

export default router;