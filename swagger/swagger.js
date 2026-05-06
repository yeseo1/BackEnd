import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";

dotenv.config();

export const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "TigyeokTaegyeok API",
    version: "0.1.0",
    description: "Backend API skeleton for the capstone project",
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
        summary: "Health check",
        responses: {
          "200": {
            description: "Server health response",
          },
        },
      },
    },
    "/auth/google/login": {
      get: {
        summary: "Google OAuth login entrypoint",
        responses: {
          "302": {
            description: "Google OAuth 인증 페이지로 리다이렉트",
          },
          "500": {
            description: "Google OAuth 설정 누락",
          },
        },
      },
    },
    "/auth/google/logout": {
      post: {
        summary: "로그아웃",
        tags: ["Auth"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "로그아웃 성공",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    message: { type: "string", example: "로그아웃 성공" }
                  }
                }
              }
            }
          },
          "401": { description: "인증 실패" }
        }
      }
    },
    "/auth/google/callback": {
      get: {
        summary: "Google OAuth callback",
        parameters: [
          {
            name: "code",
            in: "query",
            required: false,
            schema: {
              type: "string",
            },
          },
          {
            name: "error",
            in: "query",
            required: false,
            schema: {
              type: "string",
            },
          },
        ],
        responses: {
          "302": {
            description: "로그인 성공 후 Swagger로 리다이렉트",
          },
          "400": {
            description: "Google OAuth 요청 오류",
          },
          "500": {
            description: "Callback 처리 오류",
          },
          "502": {
            description: "Google API 연동 오류",
          },
        },
      },
    },
    "/users/me": {
      get: {
        summary: "로그인 사용자 프로필 조회",
        tags: ["Users"],
        security: [
          {
            bearerAuth: [],
          },
        ],
        responses: {
          "200": {
            description: "프로필 조회 성공",
          },
          "401": {
            description: "인증 실패 또는 로그인 필요",
          },
          "404": {
            description: "사용자 없음",
          },
          "500": {
            description: "프로필 조회 실패",
          },
        },
      },
    },
    "/users/me/profile": {
      patch: {
        summary: "로그인 사용자 프로필 저장",
        tags: ["Users"],
        security: [
          {
            bearerAuth: [],
          },
        ],
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
              examples: {
                saveProfile: {
                  value: {
                    gender: "M",
                    age: 24,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "프로필 저장 성공",
          },
          "400": {
            description: "입력 검증 실패",
          },
          "401": {
            description: "인증 실패 또는 로그인 필요",
          },
          "404": {
            description: "사용자 없음",
          },
        },
      },
    },
        "/sessions": {
      post: {
        summary: "세션 생성",
        tags: ["Sessions"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["relationshipType", "roomPassword"],
                properties: {
                  relationshipType: {
                    type: "string",
                    enum: ["COUPLE", "FRIEND", "FAMILY", "ROOMMATE", "TEAM", "OTHER"],
                  },
                  mode: {
                    type: "string",
                    enum: ["DUAL", "SELF"],
                    default: "DUAL",
                 },
                roomPassword: {
                  type: "string",
                  example: "1234"
                }
              },
            },
              examples: {
                createSession: {
                  value: {
                    relationshipType: "FRIEND",
                    mode: "DUAL",
                    roomPassword: "1234",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "세션 생성 성공" },
          "400": { description: "입력 검증 실패" },
          "401": { description: "인증 실패 또는 로그인 필요" },
          "500": { description: "세션 생성 실패" },
        },
      },
    },
    "/sessions/{sessionId}/join": {
      post: {
        summary: "세션 참여",
        tags: ["Sessions"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["roomPassword"],
                properties: {
                  roomPassword: {
                    type: "string",
                    example: "1234"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "세션 참여 성공" },
          "401": { description: "인증 실패 또는 로그인 필요" },
          "404": { description: "세션 없음" },
          "409": { description: "이미 참여했거나 정원 초과" },
          "500": { description: "세션 참여 실패" },
        },
      },
    },
    "/sessions/{sessionId}/inputs": {
      post: {
        summary: "세션 원문 입력 제출",
        tags: ["Inputs"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
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
                  rawText: {
                    type: "string",
                    example: "오늘 있었던 갈등 상황을 작성합니다.",
                  },
                },
              },
              examples: {
                submitInput: {
                  value: {
                    rawText: "오늘 있었던 갈등 상황을 작성합니다.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "입력 저장 성공" },
          "400": { description: "입력 검증 실패" },
          "401": { description: "인증 실패 또는 로그인 필요" },
          "403": { description: "세션 참여자가 아님" },
          "404": { description: "세션 없음" },
          "409": { description: "이미 입력 제출됨" },
          "500": { description: "입력 저장 실패" },
        },
      },
    },
    
    "/sessions/{sessionId}/status": {
      get: {
        summary: "세션 상태 조회",
        description: "현재 세션의 상태, 사용자 역할, 입력 완료 여부를 반환합니다.",
        tags: ["Sessions"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
            description: "조회할 세션 ID",
          },
        ],
        responses: {
          "200": {
            description: "세션 상태 조회 성공",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: {
                      type: "boolean",
                      example: true,
                    },
                    data: {
                      type: "object",
                      properties: {
                        sessionId: {
                          type: "string",
                          example: "b3c1e2d4-1234-5678-9abc-abcdef123456",
                        },
                        status: {
                          type: "string",
                          example: "ANALYZING",
                          description: "세션 상태 (WAITING_INPUT / ANALYZING / COMPLETED 등)",
                        },
                        myRole: {
                          type: "string",
                          example: "A",
                          description: "현재 사용자의 역할",
                        },
                        bothSubmitted: {
                          type: "boolean",
                          example: true,
                          description: "양측 입력 완료 여부",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "인증 실패 또는 로그인 필요",
          },
          "404": {
            description: "세션을 찾을 수 없음",
          },
          "500": {
            description: "세션 상태 조회 실패",
          },
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
