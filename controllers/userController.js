import { profileModel } from "../models/profileModel.js";

const VALID_GENDERS = ["M", "F", "OTHER", "UNSPECIFIED"];

export const userController = {
  async getMyProfile(req, res) {
    try {
      const user = await profileModel.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "사용자를 찾을 수 없습니다.",
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: "프로필을 조회했습니다.",
        data: user,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: "PROFILE_FETCH_FAILED",
          message: "프로필 조회 중 오류가 발생했습니다.",
        },
      });
    }
  },

  async updateMyProfile(req, res) {
    try {
      const { gender, age } = req.body;
      const hasGender = Object.prototype.hasOwnProperty.call(req.body, "gender");
      const hasAge = Object.prototype.hasOwnProperty.call(req.body, "age");

      if (!hasGender && !hasAge) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "gender 또는 age 중 하나 이상은 전달해야 합니다.",
          },
        });
      }

      if (hasGender && gender !== null && !VALID_GENDERS.includes(gender)) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "gender 값이 올바르지 않습니다.",
          },
        });
      }

      if (
        hasAge &&
        age !== null &&
        (!Number.isInteger(age) || age < 0 || age > 130)
      ) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "age 값이 올바르지 않습니다.",
          },
        });
      }

      const updatedUser = await profileModel.updateProfile(req.user.id, {
        ...(hasGender ? { gender } : {}),
        ...(hasAge ? { age } : {}),
      });

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: {
            code: "USER_NOT_FOUND",
            message: "사용자를 찾을 수 없습니다.",
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: "프로필을 저장했습니다.",
        data: updatedUser,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: "PROFILE_UPDATE_FAILED",
          message: "프로필 저장 중 오류가 발생했습니다.",
        },
      });
    }
  },
};
