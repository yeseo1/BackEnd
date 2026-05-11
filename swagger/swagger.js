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
                    enum: ["DUAL", "SINGLE"],
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
    
    "/sessions/{sessionId}/analysis-status": {
      get: {
        summary: "분석 상태 조회",
        description:
          "실제 요청 URI는 /sessions/{sessionId}/analysis-status 입니다. 현재 세션의 분석 상태와 모드, 관계 유형, 현재 사용자의 참여 역할을 반환합니다.",
        tags: ["Analysis"],
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
            description: "분석 상태 조회 성공",
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
                        mode: {
                          type: "string",
                          example: "DUAL",
                          description: "세션 모드 (DUAL 또는 SINGLE)",
                        },
                        status: {
                          type: "string",
                          example: "DONE",
                          description:
                            "세션 상태 (WAITING_INPUT / READY / ANALYZING / DONE / FAILED / BLOCKED)",
                        },
                        relationshipType: {
                          type: "string",
                          example: "FRIEND",
                          description:
                            "관계 유형 (COUPLE / FRIEND / FAMILY / ROOMMATE / TEAM / OTHER)",
                        },
                        participantRole: {
                          type: "string",
                          example: "A",
                          description: "현재 사용자의 역할",
                        },
                        updatedAt: {
                          type: "string",
                          format: "date-time",
                          example: "2026-05-09T15:36:32.389Z",
                        },
                      },
                    },
                  },
                },
                example: {
                  success: true,
                  message: "분석 상태 조회 성공",
                  data: {
                    sessionId: "5f2748d9-eb79-4064-9eb7-b8281e17c8ef",
                    mode: "DUAL",
                    status: "DONE",
                    relationshipType: "FRIEND",
                    participantRole: "A",
                    updatedAt: "2026-05-09T15:36:32.389Z",
                  },
                },
              },
            },
          },
          "401": { description: "인증 실패 또는 로그인 필요" },
          "403": { description: "세션 참여자가 아님" },
          "404": {
            description: "세션을 찾을 수 없음",
          },
          "500": {
            description: "분석 상태 조회 실패",
          },
        },
      },
    },
    "/sessions/{sessionId}/results/dual": {
      get: {
        summary: "2인 모드 분석 결과 조회",
        description:
          "실제 요청 URI는 /sessions/{sessionId}/results/dual 입니다. 2인 모드 세션에서 statement 분류 결과, 대응 문장 정렬 결과, 공통 지점, 핵심 긴장요인을 반환합니다.",
        tags: ["Analysis"],
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
            description: "조회할 2인 모드 세션 ID",
          },
        ],
        responses: {
          "200": {
            description: "2인 모드 분석 결과 조회 성공",
            content: {
              "application/json": {
                example: {
                  success: true,
                  message: "2인 모드 분석 결과 조회 성공",
                  data: {
                    session: {
                      id: "5f2748d9-eb79-4064-9eb7-b8281e17c8ef",
                      status: "DONE",
                      relationshipType: "FRIEND",
                      mode: "DUAL",
                      createdAt: "2026-05-09T15:36:24.346Z",
                      updatedAt: "2026-05-09T15:36:32.389Z",
                    },
                    statements: {
                      A: [
                        {
                          id: "524c4caa-7b75-41d5-8a30-8f1ab6b4361a",
                          speaker: "A",
                          text: "어제 너가 약속 시간보다 30분 늦었어",
                          spanStart: 0,
                          spanEnd: 21,
                          label: "FACT",
                          confidence: 0.9953,
                        },
                      ],
                      B: [
                        {
                          id: "6df6f6ad-a7aa-481d-9e9f-5ecb73c4270e",
                          speaker: "B",
                          text: "어제 내가 늦은 건 맞아",
                          spanStart: 0,
                          spanEnd: 13,
                          label: "INTERPRETATION",
                          confidence: 0.9314,
                        },
                      ],
                    },
                    alignedPairs: [
                      {
                        id: "7d0be37d-0925-4b03-954d-304235561a63",
                        similarity: 0.7718,
                        pairType: "NEED_ALIGNMENT",
                        pairTypeDisplayName: "공통 니즈",
                        aStatement: {
                          id: "2da181b8-a5f1-46ef-9802-d1074f5f6b3b",
                          text: "다음에는 미리 연락해줬으면 좋겠어",
                          label: "NEED",
                          confidence: 0.9999,
                          spanStart: 35,
                          spanEnd: 53,
                        },
                        bStatement: {
                          id: "f6d2ab53-61c0-4f36-83b2-62bca53eeaea",
                          text: "다음엔 늦으면 먼저 연락할게",
                          label: "NEED",
                          confidence: 0.9960,
                          spanStart: 31,
                          spanEnd: 46,
                        },
                      },
                    ],
                    commonGroundPairs: [
                      {
                        id: "7d0be37d-0925-4b03-954d-304235561a63",
                        similarity: 0.7718,
                        pairType: "NEED_ALIGNMENT",
                        pairTypeDisplayName: "공통 니즈",
                      },
                    ],
                    tensions: [
                      {
                        id: "34696e42-8db1-4618-8a45-942b3c671fa1",
                        type: "PERSPECTIVE_GAP",
                        displayName: "관점 차이",
                        rationale:
                          "한쪽은 사실을 말하고 다른 한쪽은 해석을 말해 관점 차이가 핵심 긴장일 수 있습니다.",
                        createdAt: "2026-05-09T15:36:32.249Z",
                        evidence: [
                          {
                            statementId: "524c4caa-7b75-41d5-8a30-8f1ab6b4361a",
                            speaker: "A",
                            text: "어제 너가 약속 시간보다 30분 늦었어",
                            label: "FACT",
                            confidence: 0.9953,
                            spanStart: 0,
                            spanEnd: 21,
                          },
                        ],
                      },
                    ],
                    summary: {
                      aStatementCount: 3,
                      bStatementCount: 3,
                      alignedPairCount: 3,
                      commonGroundPairCount: 1,
                      tensionCount: 2,
                    },
                  },
                },
              },
            },
          },
          "401": { description: "인증 실패 또는 로그인 필요" },
          "403": { description: "세션 참여자가 아님" },
          "404": { description: "세션을 찾을 수 없음" },
          "409": { description: "2인 모드 세션이 아님" },
          "500": { description: "2인 모드 결과 조회 실패" },
        },
      },
    },
    "/llm/sessions/{sessionId}/analysis": {
      get: {
        summary: "갈등 분석 결과 생성 (1인/2인 자동 분기)",
        tags: ["LLM"],
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sessionId",
            in: "path",
            required: true,
            schema: { type: "string" },
            description: "세션 ID",
          },
        ],
        responses: {
          "200": {
            description: "분석 성공",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    mode: { type: "string", example: "DUAL" },
                    data: {
                      type: "string",
                      description: "갈등 분석 결과 텍스트",
                      example: "갈등이 가장 컸던 지점 ...",
                    },
                  },
                },
              },
            },
          },
          "404": { description: "세션 없음 또는 데이터 부족" },
          "500": { description: "LLM 처리 실패" },
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
