import { sessionModel } from "../models/sessionModel.js";

const VALID_RELATIONSHIP_TYPES = [
  "COUPLE",
  "FRIEND",
  "FAMILY",
  "ROOMMATE",
  "TEAM",
  "OTHER",
];

const VALID_MODES = ["DUAL", "SELF"];

export const sessionController = {
  async createSession(req, res) {
    try {
      const { relationshipType, mode } = req.body;

      if (!relationshipType || !VALID_RELATIONSHIP_TYPES.includes(relationshipType)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "relationshipType 값이 올바르지 않습니다.",
          },
        });
      }

      if (mode && !VALID_MODES.includes(mode)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "mode 값이 올바르지 않습니다.",
          },
        });
      }

      const result = await sessionModel.createSession({
        ownerUserId: req.user.id,
        relationshipType,
        mode: mode || "DUAL",
      });

      return res.status(201).json({
        success: true,
        message: "세션이 생성되었습니다.",
        data: result,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: "SESSION_CREATE_FAILED",
          message: "세션 생성 중 오류 발생",
        },
      });
    }
  },

  async joinSession(req, res) {
    try {
      const { sessionId } = req.params;

      const result = await sessionModel.joinSession({
        sessionId,
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: "세션 참여 완료",
        data: result,
      });
    } catch (error) {
      if (error.message === "SESSION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: { code: "SESSION_NOT_FOUND", message: "세션 없음" },
        });
      }

      if (error.message === "ALREADY_JOINED") {
        return res.status(409).json({
          success: false,
          error: { code: "ALREADY_JOINED", message: "이미 참여함" },
        });
      }

      if (error.message === "SESSION_FULL") {
        return res.status(409).json({
          success: false,
          error: { code: "SESSION_FULL", message: "정원 초과" },
        });
      }

      return res.status(500).json({
        success: false,
        error: { code: "SESSION_JOIN_FAILED", message: "참여 실패" },
      });
    }
  },
};