import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";

dotenv.config();

const jsonResponse = {
  "application/json": {
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        data: { type: "object" },
        error: { type: "object" },
      },
    },
  },
};

const bearerSecurity = [{ bearerAuth: [] }];

export const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "TigyeokTaegyeok API",
    version: "0.1.0",
    description: "AI 기반 갈등 구조화 서비스 백엔드 API",
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
  servers: [
    {
      url: process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`,
    },
  ],
  paths: {
    "/health": {
      get: {
        summary: "서버 상태 확인",
        tags: ["System"],
        responses: {
          "200": { description: "서버 정상 응답", content: jsonResponse },
        },
      },
    },
    "/auth/google/login": {
      get: {
        summary: "Google OAuth 로그인 시작",
        tags: ["Auth"],
        responses: {
          "302": { description: "Google OAuth 페이지로 이동" },
          "500": { description: "Google OAuth 설정 오류" },
        },
      },
    },
    "/auth/google/callback": {
      get: {
        summary: "Google OAuth 콜백",
        tags: ["Auth"],
        responses: {
          "302": { description: "로그인 성공 후 리다이렉트" },
          "400": { description: "Google OAuth 요청 오류" },
          "500": { description: "콜백 처리 오류" },
          "502": { description: "Google API 연동 오류" },
        },
      },
    },
    "/auth/google/logout": {
      post: {
        summary: "로그아웃",
        tags: ["Auth"],
        security: bearerSecurity,
        responses: {
          "200": { description: "로그아웃 성공", content: jsonResponse },
          "401": { description: "인증 실패" },
        },
      },
    },
    "/users/me": {
      get: {
        summary: "내 프로필 조회",
        tags: ["Users"],
        security: bearerSecurity,
        responses: {
          "200": { description: "프로필 조회 성공", content: jsonResponse },
          "401": { description: "인증 실패" },
          "404": { description: "사용자를 찾을 수 없음" },
          "500": { description: "프로필 조회 실패" },
        },
      },
    },
    "/users/me/profile": {
      patch: {
        summary: "내 프로필 수정",
        tags: ["Users"],
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  gender: {
                    type: "string",
                    enum: ["M", "F", "OTHER", "UNSPECIFIED"],
                    nullable: true,
                  },
                  age: {
                    type: "integer",
                    minimum: 0,
                    maximum: 130,
                    nullable: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "프로필 수정 성공", content: jsonResponse },
          "400": { description: "입력 검증 실패" },
          "401": { description: "인증 실패" },
          "404": { description: "사용자를 찾을 수 없음" },
        },
      },
    },
    "/sessions": {
      post: {
        summary: "세션 생성",
        tags: ["Sessions"],
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["relationshipType", "roomPassword", "nickname"],
                properties: {
                  relationshipType: {
                    type: "string",
                    enum: ["COUPLE", "FRIEND", "FAMILY", "ROOMMATE", "TEAM", "OTHER"],
                  },
                  nickname: {
                    type: "string",
                    minLength: 1,
                    maxLength: 20,
                    example: "혜성",
                  },
                  mode: { type: "string", enum: ["DUAL", "SINGLE"], default: "DUAL" },
                  roomPassword: { type: "string", example: "1234" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "세션 생성 성공", content: jsonResponse },
          "400": { description: "입력 검증 실패" },
          "401": { description: "인증 실패" },
          "500": { description: "세션 생성 실패" },
        },
      },
    },
    "/sessions/{sessionId}/join": {
      post: {
        summary: "세션 참여",
        tags: ["Sessions"],
        security: bearerSecurity,
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["roomPassword", "nickname"],
                properties: {
                  roomPassword: { type: "string", example: "1234" },
                  nickname: {
                   type: "string",
                   minLength: 1,
                   maxLength: 20,
                   example: "박박박",
},
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "세션 참여 성공", content: jsonResponse },
          "401": { description: "인증 실패" },
          "404": { description: "세션을 찾을 수 없음" },
          "409": { description: "이미 참여했거나 세션 정원 초과" },
          "500": { description: "세션 참여 실패" },
        },
      },
    },
    "/sessions/{sessionId}/inputs": {
      post: {
        summary: "텍스트 입력 제출",
        tags: ["Inputs"],
        security: bearerSecurity,
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rawText"],
                properties: {
                  rawText: { type: "string", example: "오늘 있었던 갈등 상황을 작성합니다." },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "입력 저장 및 분석 처리 성공", content: jsonResponse },
          "400": { description: "입력 검증 실패 또는 moderation 차단" },
          "401": { description: "인증 실패" },
          "403": { description: "세션 참여자가 아님" },
          "404": { description: "세션을 찾을 수 없음" },
          "409": { description: "이미 입력이 제출됨" },
          "500": { description: "입력 저장 실패" },
        },
      },
    },
    "/sessions/{sessionId}/inputs/kakao-captures": {
      post: {
        summary: "카카오톡 캡처 이미지 입력 제출",
        description:
          "Swagger에서 이미지 파일을 직접 선택해 업로드할 수 있습니다. 여러 장은 선택 순서대로 Google Vision OCR이 읽고 하나의 대화로 합칩니다.",
        tags: ["Inputs"],
        security: bearerSecurity,
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["images"],
                properties: {
                  images: {
                    type: "array",
                    description: "업로드할 카카오톡 캡처 이미지 파일들",
                    items: { type: "string", format: "binary" },
                  },
                },
              },
            },
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  images: {
                    type: "array",
                    description: "base64 방식으로 보낼 때 사용하는 이미지 배열",
                    items: {
                      type: "object",
                      properties: {
                        imageDataUrl: { type: "string" },
                        imageBase64: { type: "string" },
                        mimeType: {
                          type: "string",
                          enum: ["image/png", "image/jpeg", "image/webp"],
                        },
                      },
                    },
                  },
                  imageDataUrl: { type: "string" },
                  imageBase64: { type: "string" },
                  mimeType: {
                    type: "string",
                    enum: ["image/png", "image/jpeg", "image/webp"],
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "캡처 입력 저장 및 FEIN 분석 실행 성공", content: jsonResponse },
          "400": { description: "이미지 입력 오류 또는 moderation 차단" },
          "401": { description: "인증 실패" },
          "403": { description: "세션 참여자가 아님" },
          "404": { description: "세션을 찾을 수 없음" },
          "409": { description: "DUAL 세션이 아니거나 이미 입력됨" },
          "422": { description: "A/B 양쪽 화자 대화를 추출하지 못함" },
          "500": { description: "캡처 처리 실패" },
        },
      },
    },
    "/sessions/{sessionId}/analysis-status": {
      get: {
        summary: "분석 상태 조회",
        tags: ["Analysis"],
        security: bearerSecurity,
        responses: {
          "200": { description: "분석 상태 조회 성공", content: jsonResponse },
          "401": { description: "인증 실패" },
          "403": { description: "세션 참여자가 아님" },
          "404": { description: "세션을 찾을 수 없음" },
          "500": { description: "분석 상태 조회 실패" },
        },
      },
    },
    "/sessions/{sessionId}/results/dual": {
      get: {
        summary: "2인 모드 분석 결과 조회",
        tags: ["Analysis"],
        security: bearerSecurity,
        responses: {
          "200": { description: "2인 모드 분석 결과 조회 성공", content: jsonResponse },
          "401": { description: "인증 실패" },
          "403": { description: "세션 참여자가 아님" },
          "404": { description: "세션을 찾을 수 없음" },
          "409": { description: "2인 모드 세션이 아님" },
          "500": { description: "2인 모드 결과 조회 실패" },
        },
      },
    },
    "/llm/sessions/{sessionId}/analysis": {
      get: {
        summary: "저장된 LLM 분석 결과 조회",
        tags: ["LLM"],
        security: bearerSecurity,
        responses: {
          "200": { description: "LLM 분석 결과 조회 성공", content: jsonResponse },
          "404": { description: "저장된 LLM 결과 없음" },
          "500": { description: "LLM 결과 조회 실패" },
        },
      },
      post: {
        summary: "LLM 분석 결과 생성",
        tags: ["LLM"],
        security: bearerSecurity,
        responses: {
          "201": { description: "LLM 분석 결과 생성 성공", content: jsonResponse },
          "404": { description: "모델 분석 결과 없음" },
          "409": { description: "모델 분석이 아직 완료되지 않음" },
          "500": { description: "LLM 분석 생성 실패" },
        },
      },
    },
    "/test/image": {
      post: {
        summary: "이미지 업로드 테스트",
        tags: ["Test"],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["image"],
                properties: {
                  image: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "이미지 업로드 성공", content: jsonResponse },
        },
      },
    },
  },
};

export default function swaggerSetup(app) {
  app.get("/swagger.json", (_req, res) => {
    res.status(200).json(swaggerSpec);
  });

  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
