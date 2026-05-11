import OpenAI from "openai";

import { llmModel } from "../models/llmModel.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL || "gpt-5.1";

const EMPTY_SECTIONS = {
  facts: { a: "", b: "", self: "" },
  interpretations: { a: "", b: "", self: "" },
  emotions: { a: "", b: "", self: "" },
  needs: { a: "", b: "", self: "" },
  questions: [],
};

const EMPTY_DIAGRAM_KEYWORDS = {
  coreConflict: [],
  facts: [],
  interpretations: [],
  emotions: [],
  needs: [],
  relationshipShift: [],
  questions: [],
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
반드시 아래 JSON 객체 하나만 반환하세요. 마크다운 코드블록은 쓰지 마세요.
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

diagramKeywords 규칙:
- 각 배열은 2-5개
- 각 키워드는 2-12자 정도의 짧은 한국어 명사구
- 다이어그램 노드/칩에 바로 들어가도 어색하지 않게 작성
- 원문에 없는 사실을 만들지 말 것
`;
}

function buildDualPrompt(context) {
  return `
아래는 사용자가 입력한 2인 갈등 원문을 모델서버가 FEIN 기준으로 분류하고 정렬한 결과입니다.
이 데이터를 바탕으로 결과 화면 카드와 다이어그램에 바로 사용할 최종 분석 데이터를 만드세요.

[A 발화]
${formatStatements(context.statementsBySpeaker.A)}

[B 발화]
${formatStatements(context.statementsBySpeaker.B)}

[공통점/차이 정렬]
${formatAlignedPairs(context.alignedPairs)}

[갈등 긴장 지점]
${formatTensions(context.tensions)}

작성 기준:
- 판단하거나 편들지 말 것
- 사실, 해석, 감정, 욕구를 분리할 것
- sections는 스크린샷의 "요소별 상세 분석" 카드에 바로 들어갈 문장으로 작성
- resultText는 전체 결과를 읽을 수 있는 요약형 분석문으로 작성
- diagramKeywords는 다이어그램에 넣을 짧은 키워드만 추출

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

[사용자 발화]
${formatStatements(selfStatements)}

작성 기준:
- 자기 비난이나 상대 비난으로 몰지 말 것
- 사실, 해석, 감정, 욕구를 분리할 것
- sections는 스크린샷의 "요소별 상세 분석" 카드에 바로 들어갈 문장으로 작성
- resultText는 전체 결과를 읽을 수 있는 요약형 분석문으로 작성
- diagramKeywords는 다이어그램에 넣을 짧은 키워드만 추출

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

async function generateStructuredAnalysis(prompt) {
  const response = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "너는 갈등 상황을 사실, 해석, 감정, 욕구로 구조화하고 결과 화면 및 다이어그램용 키워드를 추출하는 한국어 분석 도우미다.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || "";
  const parsed = JSON.parse(extractJsonObject(content));
  const normalized = normalizeStructuredResult(parsed);

  if (!normalized.resultText) {
    throw new Error("EMPTY_LLM_RESULT");
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
};
