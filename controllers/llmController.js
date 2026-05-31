import OpenAI from "openai";

import { llmModel } from "../models/llmModel.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL;
const MIN_RESULT_SENTENCE_COUNT = 5;

const EMPTY_SECTIONS = {
  facts: { a: "", b: "", self: "" },
  interpretations: { a: "", b: "", self: "" },
  emotions: { a: "", b: "", self: "" },
  needs: { a: "", b: "", self: "" },
  questions: [],
};

const EMPTY_DIAGRAM_KEYWORDS = {
  coreConflict: [],
  a:      { facts: [], interpretations: [], emotions: [], needs: [] },
  b:      { facts: [], interpretations: [], emotions: [], needs: [] },
  common: { facts: [], emotions: [], needs: [] },
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

function formatParticipants(participants) {
  if (!participants?.length) return "- 없음";
  return participants
    .map((p) => {
      const name   = p.name   || p.role;
      const gender = p.gender || "미입력";
      const age    = p.age != null ? `${p.age}세` : "미입력";
      return `${p.role} (${name}): 성별=${gender}, 나이=${age}`;
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

function buildJsonContract(mode, aLabel = "A", bLabel = "B") {
  const speakerShape =
    mode === "SINGLE"
      ? `{ "self": "문장" }`
      : `{ "a": "${aLabel}의 입장 문장", "b": "${bLabel}의 입장 문장" }`;

  const diagramKeywordsShape =
    mode === "SINGLE"
      ? `{
    "coreConflict": ["핵심 생각 키워드 1", "키워드 2"],
    "facts": ["사실 키워드들 (개수 제한 없음, 원문 기반)"],
    "interpretations": ["해석 키워드들"],
    "emotions": ["감정 키워드들"],
    "needs": ["요구·욕구 키워드들"]
  }`
      : `{
    "coreConflict": ["핵심 갈등 키워드 1", "키워드 2"],
    "a": {
      "facts": ["${aLabel}가 언급한 사실 키워드들 (개수 제한 없음)"],
      "interpretations": ["${aLabel}의 해석 키워드들"],
      "emotions": ["${aLabel}의 감정 키워드들"],
      "needs": ["${aLabel}의 요구 키워드들"]
    },
    "b": {
      "facts": ["${bLabel}가 언급한 사실 키워드들 (개수 제한 없음)"],
      "interpretations": ["${bLabel}의 해석 키워드들"],
      "emotions": ["${bLabel}의 감정 키워드들"],
      "needs": ["${bLabel}의 요구 키워드들"]
    },
    "common": {
      "facts": ["두 사람이 공통으로 언급한 사실 키워드들"],
      "emotions": ["두 사람이 공통으로 느낀 감정 키워드들"],
      "needs": ["두 사람이 공통으로 원하는 것 키워드들"]
    }
  }`;

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
  "diagramKeywords": ${diagramKeywordsShape}
}

resultText 작성 규칙:
- 반드시 5문장 이상, 300자 이상으로 작성하세요.
- 첫 1~2문장은 상황을 간결하게 짚는 도입부로 쓰고, 나머지는 심층 해석에 집중하세요.
- 표면적 사건 나열이 아닌, 말 뒤에 숨어 있는 심리 패턴·관계 역동·진짜 욕구를 부드럽게 분석하세요.
- 근거 없는 단정은 피하되, "~일 수 있어요", "~처럼 보여요" 같은 따뜻한 추론 표현을 적극 사용하세요.
- "갈등이 있어요", "대화가 필요해요"처럼 누구에게나 붙일 수 있는 막연한 문장은 쓰지 마세요.
- 한쪽을 비난하거나 단정하지 말고, 두 사람이 같은 상황을 다르게 받아들인 지점을 구체적으로 짚어주세요.
- 전문 용어를 쓸 때는 반드시 쉬운 말로 함께 풀어주세요. 예: "방어적인 반응(자신을 보호하려는 심리적 반응)", "인지 패턴(상황을 받아들이는 방식)"
- 마지막 문장은 지금 바로 시도할 수 있는 구체적인 대화 방향이나 내면 점검 질문을 제안하세요.
- '~합니다', '~입니다' 같은 딱딱한 어미보다 '~이에요', '~같아요', '~보여요'처럼 부드러운 어미를 사용하세요.

sections 작성 규칙:
- facts, interpretations, emotions, needs의 각 항목은 반드시 3문장 이상으로 작성하세요.
- 첫 문장은 원문에서 드러난 내용을 짚고, 이후 문장은 그 이면의 심리적 의미와 패턴을 해석하세요.
- 일상 대화로는 알아채기 어려운 마음속 욕구, 두려움, 상황을 받아들이는 방식까지 부드럽게 추론해 서술하세요.
- 어려운 전문 용어는 쉬운 말로 풀어서 쓰거나 괄호로 설명을 덧붙이세요.
- 빈약한 한 줄 요약, 키워드 나열, 막연한 위로 문구는 쓰지 마세요.

diagramKeywords 규칙:
- 키워드 개수는 정해진 제한이 없어요. 원문과 분류 결과에 실제로 등장한 내용만큼만 추출하세요.
  사실이 5개면 5개, 감정이 1개면 1개, 공통된 게 없으면 빈 배열([])로 두세요.
- a, b 각각의 키워드는 해당 사람의 원문과 FEIN 분류 결과에서만 추출하세요. 상대방 내용을 섞지 마세요.
- common은 두 사람이 실제로 공통으로 언급하거나 코사인 유사도로 겹치는 내용에서만 추출하세요.
- 각 키워드는 2-10자 정도의 짧은 한국어 명사구로, 다이어그램 노드에 바로 들어가도 자연스럽게 작성하세요.
- 원문에 없는 내용은 절대 만들지 마세요.
`;
}

function buildDualPrompt(context) {
  const aInfo = context.participants?.find((p) => p.role === "A");
  const bInfo = context.participants?.find((p) => p.role === "B");
  const aLabel = aInfo?.name || "A";
  const bLabel = bInfo?.name || "B";

  return `
아래는 두 사람이 함께 입력한 갈등 원문을 모델서버가 FEIN 기준으로 분류하고 정렬한 결과입니다.
이 데이터를 바탕으로 결과 화면 카드와 다이어그램에 바로 사용할 최종 분석 데이터를 만드세요.
분석은 짧은 요약이 아니라, 상담사가 양쪽 이야기를 듣고 핵심 패턴과 다음 대화 방향을 짚어주는 글이어야 합니다.

[참여자 정보]
${formatParticipants(context.participants)}

⚠️ 중요: resultText와 sections 작성 시 "A", "B" 대신 반드시 실제 이름인 "${aLabel}"과 "${bLabel}"을 사용하세요.

[${aLabel} 발화]
${formatStatements(context.statementsBySpeaker.A)}

[${bLabel} 발화]
${formatStatements(context.statementsBySpeaker.B)}

[공통점과 차이 정렬]
${formatAlignedPairs(context.alignedPairs)}

[갈등 긴장 지점]
${formatTensions(context.tensions)}

작성 기준:
- 어느 한쪽 편을 들거나 판단하지 마세요.
- 사실·해석·감정·욕구를 각각 명확하게 분리해 서술하세요.
- 두 사람이 같은 상황을 어떻게 다르게 받아들였는지, 그 차이를 구체적이고 부드럽게 설명하세요.
- 각자의 감정 반응이 어떤 진짜 욕구나 두려움에서 비롯된 것인지 따뜻하게 추론하세요.
- 말로 표현하지 않은 것, 즉 말 뒤에 숨겨진 기대나 상처도 살펴보세요.
- 두 사람 사이에 반복되는 관계 패턴(예: 한 사람이 다가가면 한 사람은 물러서는 패턴, 인정받고 싶은 마음이 서로 충돌하는 상황 등)이 보이면 쉬운 말로 설명하세요.
- 전문 용어(예: '방어 기제', '인지 패턴', '애착 욕구')는 쉬운 표현으로 함께 풀어 써주세요.
- resultText와 sections에서 두 사람을 언급할 때 반드시 "${aLabel}", "${bLabel}"으로 쓰고 절대 "A", "B"라고 쓰지 마세요.
- resultText는 상담사가 직접 이야기해주는 것처럼 따뜻하고 전문적인 문체로 작성하세요.
- sections는 화면의 "요소별 상세 분석" 카드에 바로 들어갈 문장으로 작성하세요.
- diagramKeywords는 다이어그램에 넣을 짧은 키워드만 추출하세요.

${buildJsonContract("DUAL", aLabel, bLabel)}
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
- 자기 자신이나 상대를 비난하는 방향으로 흐르지 않도록 주의하세요.
- 사실·해석·감정·욕구를 각각 명확하게 분리해 서술하세요.
- 사용자가 상황을 표현하는 방식 자체에서 어떤 마음의 패턴이 드러나는지 부드럽게 분석하세요.
- 사용자가 표현한 감정 뒤에 어떤 진짜 욕구나 두려움이 있는지 따뜻하게 추론하세요.
- 사용자가 원한다고 말하는 것과 진짜 필요한 것이 다를 수 있다면 그 간극을 부드럽게 짚어주세요.
- 자기 자신과 상대를 바라보는 시각이 이 상황에서 어떻게 작용하고 있는지 설명하세요.
- 일상 대화로는 알아채기 어려운 반복 패턴, 자신을 보호하려는 심리적 반응, 연결되고 싶은 마음 등을 쉬운 말로 풀어 분석하세요.
- 전문 용어는 반드시 괄호나 설명과 함께 써주세요.
- 상담사가 직접 이야기해주는 것처럼 따뜻하고 전문적인 문체로 작성하세요.
- resultText는 전체 흐름을 아우르는 심층 상담 분석문으로, 단순 요약이 아닌 심리 해석 중심으로 작성하세요.
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
      coreConflict: normalizeStringArray(diagramKeywords.coreConflict),
      // SINGLE 모드: flat 배열
      facts:           normalizeStringArray(diagramKeywords.facts),
      interpretations: normalizeStringArray(diagramKeywords.interpretations),
      emotions:        normalizeStringArray(diagramKeywords.emotions),
      needs:           normalizeStringArray(diagramKeywords.needs),
      // DUAL 모드: a/b/common 구조
      a: diagramKeywords.a ? {
        facts:           normalizeStringArray(diagramKeywords.a?.facts),
        interpretations: normalizeStringArray(diagramKeywords.a?.interpretations),
        emotions:        normalizeStringArray(diagramKeywords.a?.emotions),
        needs:           normalizeStringArray(diagramKeywords.a?.needs),
      } : undefined,
      b: diagramKeywords.b ? {
        facts:           normalizeStringArray(diagramKeywords.b?.facts),
        interpretations: normalizeStringArray(diagramKeywords.b?.interpretations),
        emotions:        normalizeStringArray(diagramKeywords.b?.emotions),
        needs:           normalizeStringArray(diagramKeywords.b?.needs),
      } : undefined,
      common: diagramKeywords.common ? {
        facts:   normalizeStringArray(diagramKeywords.common?.facts),
        emotions: normalizeStringArray(diagramKeywords.common?.emotions),
        needs:    normalizeStringArray(diagramKeywords.common?.needs),
      } : undefined,
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
    resultText.length >= 300 &&
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
          "너는 갈등 심리와 대인관계를 깊이 이해하는 따뜻한 한국어 상담사야. FEIN(사실·해석·감정·욕구) 프레임을 바탕으로, 일상 대화에서는 쉽게 알아채기 어려운 마음속 심리 패턴, 핵심 욕구, 관계 역동을 부드럽게 풀어 설명하는 게 네 역할이야. 표면적인 사건 요약에 머물지 않고, 말 뒤에 숨겨진 기대나 두려움, 관계 방식까지 살펴보되, 근거 없이 단정 짓지 않고 '~일 수 있어요', '~처럼 보여요'처럼 부드럽게 전달해. 전문 용어를 쓸 때는 누구나 이해할 수 있도록 쉬운 말로 풀어서 함께 써줘. 상담사가 직접 이야기해주는 것처럼 전문적이면서도 따뜻하고 편안한 문체로 써줘.",
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

이전 결과가 너무 짧거나 피상적이었습니다. 아래 기준을 반드시 충족해 다시 작성하세요.
- resultText는 반드시 5문장 이상, 300자 이상이어야 합니다.
- 표면적 사건 요약이 아닌, 발화 이면의 심리 패턴·핵심 욕구·관계 역동을 중심으로 분석하세요.
- 각 sections 항목은 3문장 이상으로, 단순 요약이 아닌 심층 해석을 포함해야 합니다.
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
