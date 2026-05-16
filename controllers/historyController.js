import { historyModel } from "../models/historyModel.js";

export const historyController = {
  async getHistory(req, res) {
    try {
      const result = await historyModel.getHistoryByUserId({
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: "히스토리 조회 성공",
        data: result,
      });
    } catch (error) {
      console.error("HISTORY API ERROR", error);

      return res.status(500).json({
        success: false,
        error: {
          code: "HISTORY_FETCH_FAILED",
          message: "히스토리 조회 중 오류가 발생했습니다.",
        },
      });
    }
  },
};