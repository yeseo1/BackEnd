import express from "express";

import { historyController } from "../controllers/historyController.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

router.get("/history", requireAuth, historyController.getHistory);

export default router;