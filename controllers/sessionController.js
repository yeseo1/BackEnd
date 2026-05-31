import { sessionModel } from "../models/sessionModel.js";

const VALID_RELATIONSHIP_TYPES = [
  "COUPLE",
  "FRIEND",
  "FAMILY",
  "ROOMMATE",
  "TEAM",
  "OTHER",
];

const VALID_MODES = ["DUAL", "SINGLE"];

function isValidRoomPassword(roomPassword) {
  return (
    typeof roomPassword === "string" &&
    /^[0-9]{4}$/.test(roomPassword)
  );
}
function isValidNickname(nickname) {
  return (
    typeof nickname === "string" &&
    nickname.trim().length > 0 &&
    nickname.trim().length <= 20
  );
}

export const sessionController = {
  async createSession(req, res) {
    try {
      const { relationshipType, mode, roomPassword, nickname } = req.body;
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

      if (!isValidRoomPassword(roomPassword)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "roomPassword는 숫자 4자리여야 합니다.",
          },
        });
      }

      if (!isValidNickname(nickname)) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "nickname은 1자 이상 20자 이하로 입력해야 합니다.",
    },
  });
}

    const result = await sessionModel.createSession({
   ownerUserId: req.user.id,
   relationshipType,
    mode: mode || "DUAL",
   roomPassword,
    nickname: nickname.trim(),
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
      const { roomPassword, nickname  } = req.body;

      if (!isValidRoomPassword(roomPassword)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "roomPassword는 숫자 4자리여야 합니다.",
          },
        });
      }
      if (!isValidNickname(nickname)) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "nickname은 1자 이상 20자 이하로 입력해야 합니다.",
    },
  });
}
      const result = await sessionModel.joinSession({
  sessionId,
  userId: req.user.id,
  roomPassword,
  nickname: nickname.trim(),
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

      if (error.message === "INVALID_ROOM_PASSWORD") {
        return res.status(401).json({
          success: false,
          error: {
            code: "INVALID_ROOM_PASSWORD",
            message: "방 비밀번호가 올바르지 않습니다.",
          },
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

      if (error.message === "SINGLE_SESSION_NOT_JOINABLE") {
        return res.status(409).json({
          success: false,
          error: {
            code: "SINGLE_SESSION_NOT_JOINABLE",
            message: "1인 모드 세션은 추가 참여가 불가능합니다.",
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: { code: "SESSION_JOIN_FAILED", message: "참여 실패" },
      });
    }
  },

  async getSessionStatus(req, res) {
    try {
      const { sessionId } = req.params;

      const session = await sessionModel.getSessionStatus({
        sessionId,
        userId: req.user.id,
      });

      if (!session) {
        return res.status(404).json({
          success: false,
          error: {
            code: "SESSION_NOT_FOUND",
            message: "세션을 찾을 수 없습니다.",
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          sessionId: session.id,
          status: session.status,
          myRole: session.role,
          myNickname: session.nickname,
          bothSubmitted: session.bothSubmitted,
        },
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: "SESSION_STATUS_FAILED",
          message: "세션 상태 조회 실패",
        },
      });
    }
  }
};
