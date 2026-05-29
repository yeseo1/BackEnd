import express from "express";

import { inputController } from "../controllers/inputController.js";
import { requireAuth } from "../middlewares/auth.js";
import { kakaoCaptureUpload } from "../middlewares/kakaoCaptureUpload.js";

const router = express.Router();

router.post("/:sessionId/inputs", requireAuth, inputController.submitInput);
router.post(
  "/:sessionId/inputs/kakao-captures",
  requireAuth,
  kakaoCaptureUpload.array("images", Number(process.env.MAX_KAKAO_CAPTURE_IMAGES || 6)),
  inputController.submitKakaoCaptures,
);

export default router;
