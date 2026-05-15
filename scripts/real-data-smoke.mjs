import "dotenv/config";

import { setTimeout as delay } from "node:timers/promises";

import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;

const TEST_PORT = process.env.REAL_DATA_TEST_PORT || "4010";
const API_BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const FEIN_MODEL_BASE_URL =
  process.env.FEIN_MODEL_BASE_URL || "http://localhost:8000";
const USER_A_ID = "11111111-1111-1111-1111-111111111111";
const USER_B_ID = "22222222-2222-2222-2222-222222222222";
const ROOM_PASSWORD = "1234";

process.env.PORT = TEST_PORT;
process.env.FEIN_MODEL_BASE_URL = FEIN_MODEL_BASE_URL;
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const originalFetch = globalThis.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

globalThis.fetch = async (url, options) => {
  const href = typeof url === "string" ? url : url?.url || String(url);

  if (href.includes("/moderations")) {
    return jsonResponse({
      id: "modr-real-data-smoke",
      model: process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest",
      results: [
        {
          flagged: false,
          categories: {},
          category_scores: {},
        },
      ],
    });
  }

  if (
    process.env.REAL_DATA_SMOKE_MOCK_FEIN === "true" &&
    href.endsWith("/internal/fein/analyze-dual")
  ) {
    return jsonResponse({
      success: true,
      data: {
        a_results: [
          {
            index: 0,
            text: "나는 약속 시간이 자주 바뀌면 존중받지 못한다고 느껴.",
            label: "EMOTION",
            confidence: 0.94,
          },
          {
            index: 1,
            text: "미리 알려주면 계획을 조정할 수 있어.",
            label: "NEED",
            confidence: 0.91,
          },
        ],
        b_results: [
          {
            index: 0,
            text: "나는 일정 변경이 불가피할 때가 많았어.",
            label: "FACT",
            confidence: 0.9,
          },
          {
            index: 1,
            text: "늦게 말해서 네가 답답했을 거라고 생각해.",
            label: "INTERPRETATION",
            confidence: 0.88,
          },
        ],
        aligned_pairs: [
          {
            a_index: 0,
            b_index: 1,
            similarity: 0.82,
            pair_type: "EMOTION_NEED_CROSS",
          },
          {
            a_index: 1,
            b_index: 0,
            similarity: 0.77,
            pair_type: "FACT_INTERPRETATION_CROSS",
          },
        ],
        tension_candidates: [
          {
            type: "EMOTION_NEED_GAP",
            score: 0.93,
            rationale: "A는 사전 공유와 존중감을 원하고, B는 일정 변경의 불가피성을 강조한다.",
            evidence: [
              { side: "A", statement_index: 0 },
              { side: "B", statement_index: 0 },
            ],
          },
        ],
      },
    });
  }

  if (href.endsWith("/chat/completions")) {
    return jsonResponse({
      id: "chatcmpl-real-data-smoke",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: JSON.stringify({
              resultText:
                "두 사람 모두 약속 변경 자체보다 사전 공유와 존중감에 대한 기대가 어긋나 갈등이 커졌습니다.",
              sections: {
                facts: {
                  a: "A는 약속 시간이 자주 바뀌었다고 말합니다.",
                  b: "B는 일정 변경이 불가피한 상황이 있었다고 말합니다.",
                },
                interpretations: {
                  a: "A는 변경 통보가 늦으면 존중받지 못한다고 해석합니다.",
                  b: "B는 늦은 공유가 A를 답답하게 했을 수 있다고 봅니다.",
                },
                emotions: {
                  a: "A는 답답함과 서운함을 느낍니다.",
                  b: "B는 미안함과 부담을 느낍니다.",
                },
                needs: {
                  a: "A는 미리 알려주는 것과 예측 가능성을 원합니다.",
                  b: "B는 불가피한 상황을 이해받고 싶어합니다.",
                },
                questions: [
                  "일정 변경은 언제까지 알려주는 것이 좋을까요?",
                  "불가피한 변경을 어떻게 설명하면 덜 상처가 될까요?",
                  "서로의 기대치를 어디까지 맞출 수 있을까요?",
                ],
              },
              diagramKeywords: {
                coreConflict: ["사전 공유", "존중감"],
                facts: ["일정 변경", "늦은 통보"],
                interpretations: ["존중 부족", "불가피함"],
                emotions: ["서운함", "미안함"],
                needs: ["예측 가능성", "이해"],
                relationshipShift: ["합의된 통보 기준", "기대 조율"],
                questions: ["통보 시점", "설명 방식"],
              },
            }),
          },
        },
      ],
    });
  }

  return originalFetch(url, options);
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

function signToken(userId, email) {
  return jwt.sign({ sub: userId, email }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

async function seedUsers() {
  await pool.query("DELETE FROM sessions WHERE owner_user_id = ANY($1::uuid[])", [
    [USER_A_ID, USER_B_ID],
  ]);

  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
    [USER_A_ID, USER_B_ID],
  ]);

  await pool.query(
    `
    INSERT INTO users (
      id, provider, provider_user_id, email, name, picture_url, gender, age, created_at, last_login_at
    )
    VALUES
      ($1, 'google', 'real-data-a', 'real-data-a@example.com', 'Real Data A', NULL, 'UNSPECIFIED', 29, NOW(), NOW()),
      ($2, 'google', 'real-data-b', 'real-data-b@example.com', 'Real Data B', NULL, 'UNSPECIFIED', 31, NOW(), NOW())
    `,
    [USER_A_ID, USER_B_ID],
  );
}

async function request(method, path, { token, body } = {}) {
  const response = await originalFetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(`${method} ${path} failed with ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return { status: response.status, data };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await request("GET", "/health");
      return;
    } catch {
      await delay(250);
    }
  }

  throw new Error("Server did not become healthy");
}

async function main() {
  await seedUsers();

  await import("../server.js");
  await waitForServer();

  const tokenA = signToken(USER_A_ID, "real-data-a@example.com");
  const tokenB = signToken(USER_B_ID, "real-data-b@example.com");

  const profile = await request("GET", "/users/me", { token: tokenA });
  const updatedProfile = await request("PATCH", "/users/me/profile", {
    token: tokenA,
    body: { gender: "OTHER", age: 30 },
  });

  const session = await request("POST", "/sessions", {
    token: tokenA,
    body: {
      relationshipType: "FRIEND",
      mode: "DUAL",
      roomPassword: ROOM_PASSWORD,
    },
  });
  const sessionId = session.data.data.id;

  const joined = await request("POST", `/sessions/${sessionId}/join`, {
    token: tokenB,
    body: { roomPassword: ROOM_PASSWORD },
  });

  const inputA = await request("POST", `/sessions/${sessionId}/inputs`, {
    token: tokenA,
    body: {
      rawText:
        "나는 약속 시간이 자주 바뀌면 존중받지 못한다고 느껴. 미리 알려주면 계획을 조정할 수 있어.",
    },
  });

  const inputB = await request("POST", `/sessions/${sessionId}/inputs`, {
    token: tokenB,
    body: {
      rawText:
        "나는 일정 변경이 불가피할 때가 많았어. 늦게 말해서 네가 답답했을 거라고 생각해.",
    },
  });

  const status = await request("GET", `/sessions/${sessionId}/analysis-status`, {
    token: tokenA,
  });
  const basicAnalysis = await request("GET", `/sessions/${sessionId}/analysis`, {
    token: tokenA,
  });
  const dualResults = await request("GET", `/sessions/${sessionId}/results/dual`, {
    token: tokenA,
  });
  const llmCreated = await request("POST", `/llm/sessions/${sessionId}/analysis`, {
    token: tokenA,
  });
  const llmFetched = await request("GET", `/llm/sessions/${sessionId}/analysis`, {
    token: tokenB,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiBaseUrl: API_BASE_URL,
        sessionId,
        checks: {
          profileName: profile.data.data.name,
          updatedAge: updatedProfile.data.data.age,
          joinRole: joined.data.data.role,
          firstInputFeinStatus: inputA.data.data.feinAnalysisStatus,
          secondInputFeinStatus: inputB.data.data.feinAnalysisStatus,
          analysisStatus: status.data.data.status,
          statementCount: basicAnalysis.data.data.statements.length,
          dualSummary: dualResults.data.data.summary,
          llmResultText: llmCreated.data.data.resultText,
          llmFetchedByParticipantB: Boolean(llmFetched.data.data.id),
        },
      },
      null,
      2,
    ),
  );

  await pool.end();
  process.exit(0);
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error.message,
        status: error.status,
        data: error.data,
      },
      null,
      2,
    ),
  );

  await pool.end().catch(() => {});
  process.exit(1);
});
