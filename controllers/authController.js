import jwt from "jsonwebtoken";

import { authModel } from "../models/authModel.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_POST_LOGIN_PATH = "/";

function normalizeNextPath(next) {
  if (typeof next !== "string") return null;

  const trimmed = next.trim();

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, "http://localhost");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function encodeOAuthState(nextPath) {
  return Buffer.from(JSON.stringify({ nextPath }), "utf8").toString("base64url");
}

function decodeOAuthState(state) {
  if (typeof state !== "string" || !state.trim()) {
    return null;
  }

  try {
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    return normalizeNextPath(parsed.nextPath);
  } catch {
    return null;
  }
}

function buildFrontendRedirectUrl(nextPath = DEFAULT_POST_LOGIN_PATH) {
  const frontendBase =
    process.env.FRONTEND_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:4000";

  return `${frontendBase.replace(/\/$/, "")}${nextPath}`;
}

export const authController = {
  googleLogin(req, res) {
    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CALLBACK_URL
    ) {
      return res.status(500).json({
        success: false,
        error: {
          code: "GOOGLE_OAUTH_CONFIG_MISSING",
          message: "Google OAuth 설정이 누락되었습니다.",
        },
      });
    }

    const nextPath =
      normalizeNextPath(req.query.next) || DEFAULT_POST_LOGIN_PATH;

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_CALLBACK_URL,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "consent",
      state: encodeOAuthState(nextPath),
    });

    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return res.redirect(302, googleAuthUrl);
  },

  async googleCallback(req, res) {
    try {
      const { code, error, state } = req.query;

      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: "GOOGLE_OAUTH_DENIED",
            message: `Google OAuth 인증이 거부되었습니다: ${error}`,
          },
        });
      }

      if (!code) {
        return res.status(400).json({
          success: false,
          error: {
            code: "GOOGLE_OAUTH_CODE_MISSING",
            message: "Google OAuth code가 없습니다.",
          },
        });
      }

      const tokenParams = new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL,
        grant_type: "authorization_code",
      });

      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: tokenParams.toString(),
      });

      if (!tokenResponse.ok) {
        const tokenError = await tokenResponse.text();
        return res.status(502).json({
          success: false,
          error: {
            code: "GOOGLE_TOKEN_EXCHANGE_FAILED",
            message: "Google 토큰 교환에 실패했습니다.",
            details: tokenError,
          },
        });
      }

      const tokenData = await tokenResponse.json();

      const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      });

      if (!userInfoResponse.ok) {
        const userInfoError = await userInfoResponse.text();
        return res.status(502).json({
          success: false,
          error: {
            code: "GOOGLE_USERINFO_FETCH_FAILED",
            message: "Google 사용자 정보 조회에 실패했습니다.",
            details: userInfoError,
          },
        });
      }

      const googleUser = await userInfoResponse.json();

      if (!googleUser.sub || !googleUser.email) {
        return res.status(502).json({
          success: false,
          error: {
            code: "GOOGLE_USERINFO_INVALID",
            message: "Google 사용자 정보가 올바르지 않습니다.",
          },
        });
      }

      let user = await authModel.findByProviderUserId("google", googleUser.sub);

      if (!user) {
        user = await authModel.createGoogleUser({
          providerUserId: googleUser.sub,
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          pictureUrl: googleUser.picture || null,
        });
      } else {
        user = await authModel.updateGoogleLoginProfile(user.id, {
          email: googleUser.email,
          name: googleUser.name || googleUser.email,
          pictureUrl: googleUser.picture || null,
        });
      }

      const token = jwt.sign(
        {
          sub: user.id,
          email: user.email,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.JWT_EXPIRES_IN || "7d",
        },
      );

      res.cookie(process.env.COOKIE_NAME || "tigyeok_session", token, {
        httpOnly: true,
        secure: process.env.COOKIE_SECURE === "true",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      const nextPath =
        decodeOAuthState(state) || DEFAULT_POST_LOGIN_PATH;

      return res.redirect(302, buildFrontendRedirectUrl(nextPath));
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: "GOOGLE_CALLBACK_FAILED",
          message: "Google OAuth callback 처리 중 오류가 발생했습니다.",
          details: error.message,
        },
      });
    }
  },

  async googleLogout(req, res) {
  try {
    res.clearCookie(process.env.COOKIE_NAME || "tigyeok_session", {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === "true",
      sameSite: "lax",
    });

    return res.status(200).json({
      success: true,
      message: "로그아웃 성공",
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "LOGOUT_FAILED",
        message: "로그아웃 처리 중 오류 발생",
        details: error.message,
      },
    });
  }
}
};
