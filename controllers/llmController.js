import OpenAI from "openai";

import { llmModel } from "../models/llmModel.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5.1";
const MIN_RESULT_SENTENCE_COUNT = 3;

const EMPTY_SECTIONS = {
  facts: { a: "", b: "", self: "" },
  interpretations: { a: "", b: "", self: "" },
  emotions: { a: "", b: "", self: "" },
  needs: { a: "", b: "", self: "" },
  questions: [],
};

const EMPTY_DIAGRAM_KEYWORDS = {
  common: {
    coreConflict: [],
    facts: [],
    interpretations: [],
    emotions: [],
    needs: [],
    relationshipShift: [],
    questions: [],
  },
  a: { facts: [], interpretations: [], emotions: [], needs: [] },
  b: { facts: [], interpretations: [], emotions: [], needs: [] },
};

function formatStatements(statements) {
  if (!statements.length) return "- 없음";

  return statements
    .map((statement, index) => {
      const confidence =
        typeof statement.confidence === "number"
          ? `, confidence=${statement.confidence.toFixed(2)}`
          : "";

      return `${index + 1}. [${statement.label}${confidence}] ${statement.text}`;
    })
    .join("\n");
}

function formatTensions(tensions) {
  if (!tensions.length) return "- 없음";

  return tensions
    .map((tension, index) => {
      const evidence = tension.evidence.length
        ? tension.evidence
            .map((item) => `${item.speaker}: ${item.text}`)
            .join(" / ")
        : "근거 없음";

      return `${index + 1}. ${tension.type}: ${tension.rationale}\n   근거: ${evidence}`;
    })
    .join("\n");
}

function formatAlignedPairs(alignedPairs) {
  if (!alignedPairs.length) return "- 없음";

  return alignedPairs
    .map(
      (pair, index) =>
        `${index + 1}. ${pair.pairType} (${Number(pair.similarity).toFixed(3)})\n` +
        `   A: [${pair.aStatement.label}] ${pair.aStatement.text}\n` +
        `   B: [${pair.bStatement.label}] ${pair.bStatement.text}`,
    )
    .join("\n");
}

function buildJsonContract(mode) {
  const speakerShape =
    mode === "SINGLE"
      ? `{ "self": "문장" }`
      : `{ "a": "A 입장 문장", "b": "B 입장 문장" }`;

  return `
반드시 아래 JSON 객체 하나만 반환하세요. 마크다운 코드블록이나 JSON 밖 설명은 쓰지 마세요.
{
  "resultText": "결과 화면 상단이나 상세 보기에서 그대로 보여줄 전체 분석문",
  "sections": {
    "facts": ${speakerShape},
    "interpretations": ${speakerShape},
    "emotions": ${speakerShape},
    "needs": ${speakerShape},
    "questions": ["함께 생각해볼 질문 1", "질문 2", "질문 3"]
  },
  "diagramKeywords": {
    "coreConflict": ["핵심 갈등 키워드 1", "키워드 2"],
    "facts": ["사실 키워드 1", "사실 키워드 2"],
    "interpretations": ["해석 키워드 1", "해석 키워드 2"],
    "emotions": ["감정 키워드 1", "감정 키워드 2"],
    "needs": ["욕구 키워드 1", "욕구 키워드 2"],
    "relationshipShift": ["관계 전환 키워드 1", "키워드 2"],
    "questions": ["질문 키워드 1", "질문 키워드 2"]
  }
}

resultText 작성 규칙:
- 최소 3문장, 가능하면 4-5문장으로 작성하세요.
- 각 문장은 사용자가 입력한 원문 근거를 바탕으로 구체적인 관찰, 해석, 조언을 하나씩 담으세요.
- "갈등이 있습니다", "대화가 필요합니다"처럼 누구에게나 붙일 수 있는 겉핥기 문장은 피하세요.
- 친절한 챗봇 말투보다 상담사가 상황을 정리하고 다음 행동을 조언하는 차분한 문체로 쓰세요.
- 한쪽을 비난하거나 진단하듯 단정하지 말고, "상대는 틀렸다"보다 "서로 다르게 받아들인 지점"을 짚으세요.
- 마지막 문장은 바로 시도할 수 있는 대화 방향이나 확인 질문을 제안하세요.

sections 작성 규칙:
- facts, interpretations, emotions, needs의 각 문장은 최소 2문장으로 작성하세요.
- 원문 표현을 직접 반영해 "무엇이 드러났는지"와 "그래서 어떤 조정이 필요한지"를 함께 설명하세요.
- 빈약한 한 줄 요약, 키워드 나열, AI가 쓴 듯한 추상 문구는 피하세요.

diagramKeywords 규칙:
- 각 배열은 2-5개입니다.
- 각 키워드는 2-12자 정도의 짧은 한국어 명사구입니다.
- 다이어그램 노드/칩에 바로 들어가도 어색하지 않게 작성하세요.
- 원문에 없는 사실을 만들지 마세요.
`;
}

function buildDualPrompt(context) {
  return `
아래는 사용자가 입력한 2인 갈등 원문을 모델서버가 FEIN 기준으로 분류하고 정렬한 결과입니다.
이 데이터를 바탕으로 결과 화면 카드와 다이어그램에 바로 사용할 최종 분석 데이터를 만드세요.
분석은 짧은 요약이 아니라, 상담사가 양쪽 이야기를 듣고 핵심 패턴과 다음 대화 방향을 짚어주는 글이어야 합니다.

[A 발화]
${formatStatements(context.statementsBySpeaker.A)}

[B 발화]
${formatStatements(context.statementsBySpeaker.B)}

[공통점과 차이 정렬]
${formatAlignedPairs(context.alignedPairs)}

[갈등 긴장 지점]
${formatTensions(context.tensions)}

작성 기준:
- 판단하거나 편을 들지 마세요.
- 사실, 해석, 감정, 욕구를 분리해 읽히게 하세요.
- A와 B가 같은 사건을 어떻게 다르게 받아들였는지 구체적으로 짚으세요.
- 감정 뒤에 있는 욕구와 기대를 연결해서 설명하세요.
- resultText는 전체 결과를 읽을 수 있는 상담형 분석문으로 작성하세요.
- sections는 화면의 "요소별 상세 분석" 카드에 바로 들어갈 문장으로 작성하세요.
- diagramKeywords는 다이어그램에 넣을 짧은 키워드만 추출하세요.

${buildJsonContract("DUAL")}
`;
}

function buildSinglePrompt(context) {
  const selfStatements =
    context.statementsBySpeaker.SELF.length > 0
      ? context.statementsBySpeaker.SELF
      : context.statementsBySpeaker.A;

  return `
아래는 사용자가 혼자 입력한 갈등 원문을 모델서버가 FEIN 기준으로 분류한 결과입니다.
이 데이터를 바탕으로 1인 모드 결과 화면 카드와 다이어그램에 바로 사용할 최종 분석 데이터를 만드세요.
분석은 짧은 요약이 아니라, 상담사가 사용자의 말을 정리해주고 다음 행동을 조언하는 글이어야 합니다.

[사용자 발화]
${formatStatements(selfStatements)}

작성 기준:
- 자기 비난이나 상대 비난으로 몰지 마세요.
- 사실, 해석, 감정, 욕구를 분리해 읽히게 하세요.
- 사용자가 실제로 말한 표현을 근거로 어떤 패턴이 보이는지 구체적으로 설명하세요.
- 감정 뒤에 있는 욕구와 기대를 연결해서 설명하세요.
- resultText는 전체 결과를 읽을 수 있는 상담형 분석문으로 작성하세요.
- sections는 화면의 "요소별 상세 분석" 카드에 바로 들어갈 문장으로 작성하세요.
- diagramKeywords는 다이어그램에 넣을 짧은 키워드만 추출하세요.

${buildJsonContract("SINGLE")}
`;
}

function extractJsonObject(text) {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("INVALID_LLM_JSON");
  }

  return trimmed.slice(start, end + 1);
}

function normalizeStringMap(value) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" ? item : String(item || ""),
    ]),
  );
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeStructuredResult(parsed) {
  const sections = parsed.sections || {};
  const diagramKeywords = parsed.diagramKeywords || {};

  return {
    resultText:
      typeof parsed.resultText === "string" ? parsed.resultText.trim() : "",
    sections: {
      facts: { ...EMPTY_SECTIONS.facts, ...normalizeStringMap(sections.facts) },
      interpretations: {
        ...EMPTY_SECTIONS.interpretations,
        ...normalizeStringMap(sections.interpretations),
      },
      emotions: {
        ...EMPTY_SECTIONS.emotions,
        ...normalizeStringMap(sections.emotions),
      },
      needs: { ...EMPTY_SECTIONS.needs, ...normalizeStringMap(sections.needs) },
      questions: normalizeStringArray(sections.questions).slice(0, 3),
    },
    diagramKeywords: {
      coreConflict: normalizeStringArray(diagramKeywords.coreConflict).slice(0, 5),
      facts: normalizeStringArray(diagramKeywords.facts).slice(0, 5),
      interpretations: normalizeStringArray(diagramKeywords.interpretations).slice(0, 5),
      emotions: normalizeStringArray(diagramKeywords.emotions).slice(0, 5),
      needs: normalizeStringArray(diagramKeywords.needs).slice(0, 5),
      relationshipShift: normalizeStringArray(diagramKeywords.relationshipShift).slice(0, 5),
      questions: normalizeStringArray(diagramKeywords.questions).slice(0, 5),
    },
  };
}

function countSentences(text) {
  return text
    .split(/[.!?。！？\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

function hasDetailedResultText(resultText) {
  return (
    resultText.length >= 120 &&
    countSentences(resultText) >= MIN_RESULT_SENTENCE_COUNT
  );
}

async function requestStructuredAnalysis(prompt) {
  const response = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "너는 갈등 상황을 사실, 해석, 감정, 욕구로 구조화하는 한국어 상담형 분석가다. 결과는 짧은 AI식 요약이 아니라, 사용자가 자기 상황을 다시 볼 수 있도록 근거를 짚고 다음 대화 방향을 제안하는 차분한 분석문으로 작성한다.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || "";
  const parsed = JSON.parse(extractJsonObject(content));

  return normalizeStructuredResult(parsed);
}

async function generateStructuredAnalysis(prompt) {
  let normalized = await requestStructuredAnalysis(prompt);

  if (!normalized.resultText) {
    throw new Error("EMPTY_LLM_RESULT");
  }

  if (!hasDetailedResultText(normalized.resultText)) {
    normalized = await requestStructuredAnalysis(`
${prompt}

이전 결과가 너무 짧거나 피상적이었습니다. resultText는 반드시 3문장 이상, 120자 이상으로 다시 작성하세요.
각 문장에는 원문 근거, FEIN 관점의 해석, 상담사가 제안하는 다음 대화 방향이 드러나야 합니다.
`);
  }

  if (!normalized.resultText || !hasDetailedResultText(normalized.resultText)) {
    throw new Error("LLM_RESULT_TOO_SHORT");
  }

  return normalized;
}

function buildSourceSnapshot(context) {
  return {
    session: context.session,
    statements: context.statements,
    tensions: context.tensions,
    alignedPairs: context.alignedPairs,
  };
}

function assertAnalysisReady(context) {
  if (context.session.status !== "DONE") {
    const error = new Error("ANALYSIS_NOT_READY");
    error.status = context.session.status;
    throw error;
  }

  if (!context.statements.length) {
    throw new Error("MODEL_ANALYSIS_NOT_FOUND");
  }

  if (
    context.session.mode === "DUAL" &&
    (!context.statementsBySpeaker.A.length || !context.statementsBySpeaker.B.length)
  ) {
    throw new Error("DUAL_STATEMENTS_NOT_READY");
  }
}

function sendControllerError(res, error) {
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

  if (error.message === "ANALYSIS_NOT_READY") {
    return res.status(409).json({
      success: false,
      error: {
        code: "ANALYSIS_NOT_READY",
        message: "모델 분석이 아직 완료되지 않았습니다.",
        status: error.status,
      },
    });
  }

  if (
    error.message === "MODEL_ANALYSIS_NOT_FOUND" ||
    error.message === "DUAL_STATEMENTS_NOT_READY"
  ) {
    return res.status(404).json({
      success: false,
      error: {
        code: "MODEL_ANALYSIS_NOT_FOUND",
        message: "LLM 정리에 사용할 모델 분석 결과가 없습니다.",
      },
    });
  }

  return res.status(500).json({
    success: false,
    error: {
      code: "LLM_ANALYSIS_FAILED",
      message: "LLM 분석 결과 생성 중 오류가 발생했습니다.",
      details: error.message,
    },
  });
}

export const llmController = {
  async getSelfResults(req, res) {
    try {
      const results = await llmModel.getSelfResults({
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: "Single mode LLM results fetched",
        data: {
          count: results.length,
          results,
        },
      });
    } catch (error) {
      return sendControllerError(res, error);
    }
  },

  async getAnalysis(req, res) {
    try {
      const { sessionId } = req.params;
      const savedResult = await llmModel.getSavedResult({
        sessionId,
        userId: req.user.id,
      });

      if (!savedResult) {
        return res.status(404).json({
          success: false,
          error: {
            code: "LLM_RESULT_NOT_FOUND",
            message: "저장된 LLM 결과가 없습니다. 먼저 결과 생성을 요청하세요.",
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: "LLM 분석 결과 조회 성공",
        data: savedResult,
      });
    } catch (error) {
      return sendControllerError(res, error);
    }
  },

  async generateAnalysis(req, res) {
    try {
      const { sessionId } = req.params;
      const context = await llmModel.getSessionContext({
        sessionId,
        userId: req.user.id,
      });

      assertAnalysisReady(context);

      const prompt =
        context.session.mode === "SINGLE"
          ? buildSinglePrompt(context)
          : buildDualPrompt(context);

      const structuredResult = await generateStructuredAnalysis(prompt);

      const savedResult = await llmModel.saveResult({
        sessionId,
        mode: context.session.mode,
        resultText: structuredResult.resultText,
        structuredResult,
        sourceSnapshot: buildSourceSnapshot(context),
      });

      return res.status(201).json({
        success: true,
        message: "LLM 분석 결과 생성 성공",
        data: savedResult,
      });
    } catch (error) {
      return sendControllerError(res, error);
    }
  },

  async getEvidence(req, res) {
    try {
      const { sessionId } = req.params;

      const result = await llmModel.getEvidenceBySessionId({
        sessionId,
        userId: req.user.id,
      });

      return res.status(200).json({
        success: true,
        message: "LLM 원문 근거 데이터 조회 성공",
        data: result,
      });
    } catch (error) {
      if (error.message === "LLM_RESULT_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: {
            code: "LLM_RESULT_NOT_FOUND",
            message: "저장된 LLM 결과가 없습니다.",
          },
        });
      }

      return sendControllerError(res, error);
    }
  },
};
