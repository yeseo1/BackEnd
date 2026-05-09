import { analysisModel } from "../models/analysisModel.js";

export const analysisController = {
  async getAnalysis(req, res) {
    try {
      const { sessionId } = req.params;

      const result = await analysisModel.getAnalysisBySessionId({
        sessionId,
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: "분석 결과 조회 성공",
        data: result,
      });
    } catch (error) {
      console.error("Analysis fetch error:", error);

      if (error.message === "SESSION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: {
            code: "SESSION_NOT_FOUND",
            message: "세션을 찾을 수 없습니다.",
          },
        });
      }

      if (error.message === "NOT_PARTICIPANT") {
        return res.status(403).json({
          success: false,
          error: {
            code: "NOT_PARTICIPANT",
            message: "해당 세션 참여자가 아닙니다.",
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: "ANALYSIS_FETCH_FAILED",
          message: "분석 결과 조회 중 오류가 발생했습니다.",
        },
      });
    }
  },
};