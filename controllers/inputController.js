import OpenAI from "openai";

import { inputModel } from "../models/inputModel.js";
import { splitIntoStatements } from "../utils/statementSplitter.js";
import { selectKeyTensions } from "../utils/tensionSelector.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODERATION_MODEL =
  process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";

const FEIN_MODEL_BASE_URL =
  process.env.FEIN_MODEL_BASE_URL || "http://localhost:8000";

async function moderateText(input) {
  const response = await client.moderations.create({
    model: MODERATION_MODEL,
    input,
  });

  const result = response.results[0];

  return {
    flagged: result.flagged,
    categories: result.categories,
    category_scores: result.category_scores,
  };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error("MODEL_SERVER_REQUEST_FAILED");
    error.response = {
      status: response.status,
      data,
    };
    throw error;
  }

  return { data };
}

function findSpan(rawText, text) {
  const index = rawText.indexOf(text);

  if (index === -1) {
    return {
      span_start: 0,
      span_end: text.length,
    };
  }

  return {
    span_start: index,
    span_end: index + text.length,
  };
}

function toStatements(results, speaker, rawText) {
  return (results || []).map((result) => ({
    sourceIndex: result.index,
    speaker,
    text: result.text,
    label: result.label,
    confidence: result.confidence,
    ...findSpan(rawText, result.text),
  }));
}

export const inputController = {
  async submitInput(req, res) {
    try {
      const { sessionId } = req.params;
      const { rawText } = req.body;

      if (!rawText || typeof rawText !== "string" || rawText.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "rawText는 필수입니다.",
          },
        });
      }

      const cleanedText = rawText.trim();

      const moderationResult = await moderateText(cleanedText);

      if (moderationResult.flagged) {
        await inputModel.blockSession({ sessionId });

        return res.status(400).json({
          success: false,
          error: {
            code: "INPUT_BLOCKED",
            message: "위험 신호가 감지되어 입력이 차단되었습니다.",
            details: moderationResult,
          },
        });
      }

      const result = await inputModel.submitInput({
        sessionId,
        userId: req.user.id,
        rawText: cleanedText,
      });

      let feinAnalysisStatus = "SKIPPED";

      try {
        if (result.mode === "SINGLE" && result.status === "READY") {
          await inputModel.updateSessionStatus({
            sessionId,
            status: "ANALYZING",
          });

          const statementsInput = splitIntoStatements(cleanedText);

          const classifyResponse = await postJson(
            `${FEIN_MODEL_BASE_URL}/internal/fein/classify`,
            {
              statements: statementsInput.length ? statementsInput : [cleanedText],
            },
          );

          const statements = toStatements(
            classifyResponse.data?.data?.results,
            result.speaker,
            cleanedText,
          );

          await inputModel.saveStatements({
            sessionId,
            statements,
          });

          await inputModel.updateSessionStatus({
            sessionId,
            status: "DONE",
          });

          feinAnalysisStatus = "DONE";
        }

        if (result.mode === "DUAL" && result.status === "READY") {
          await inputModel.updateSessionStatus({
            sessionId,
            status: "ANALYZING",
          });

          const inputs = await inputModel.getSessionInputs({ sessionId });

          const aInput = inputs.find((row) => row.speaker === "A");
          const bInput = inputs.find((row) => row.speaker === "B");

          const aStatementsInput = aInput ? splitIntoStatements(aInput.raw_text) : [];
          const bStatementsInput = bInput ? splitIntoStatements(bInput.raw_text) : [];

          const analyzeResponse = await postJson(
            `${FEIN_MODEL_BASE_URL}/internal/fein/analyze-dual`,
            {
              a_statements: aStatementsInput.length
                ? aStatementsInput
                : aInput
                  ? [aInput.raw_text]
                  : [],
              b_statements: bStatementsInput.length
                ? bStatementsInput
                : bInput
                  ? [bInput.raw_text]
                  : [],
            },
          );

          const aStatements = toStatements(
            analyzeResponse.data?.data?.a_results,
            "A",
            aInput?.raw_text || "",
          );

          const bStatements = toStatements(
            analyzeResponse.data?.data?.b_results,
            "B",
            bInput?.raw_text || "",
          );

          const savedStatements = await inputModel.saveStatements({
            sessionId,
            statements: [...aStatements, ...bStatements],
          });

          const savedAStatements = savedStatements.filter(
            (statement) => statement.speaker === "A",
          );
          const savedBStatements = savedStatements.filter(
            (statement) => statement.speaker === "B",
          );

          const selectedTensions = selectKeyTensions(
            analyzeResponse.data?.data?.tension_candidates,
          );

          const savedArtifacts = await inputModel.saveDualAnalysisArtifacts({
            sessionId,
            aStatements: savedAStatements,
            bStatements: savedBStatements,
            alignedPairs: analyzeResponse.data?.data?.aligned_pairs || [],
            tensions: selectedTensions,
          });

          await inputModel.updateSessionStatus({
            sessionId,
            status: "DONE",
          });

          feinAnalysisStatus = "DONE";

          result.analysisArtifacts = {
            alignedPairCount: savedArtifacts.alignmentPairs.length,
            tensionCount: savedArtifacts.tensions.length,
          };
        }
      } catch (feinError) {
        await inputModel.updateSessionStatus({
          sessionId,
          status: "FAILED",
        });
        feinAnalysisStatus = "FAILED";
        console.error(
          "FEIN model analysis failed",
          feinError?.response?.data || feinError,
        );
      }

      return res.status(201).json({
        success: true,
        message: "입력이 저장되었습니다.",
        data: {
          ...result,
          feinAnalysisStatus,
        },
      });
    } catch (error) {
      if (error.message === "SESSION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: { code: "SESSION_NOT_FOUND", message: "세션을 찾을 수 없습니다." },
        });
      }

      if (error.message === "NOT_PARTICIPANT") {
        return res.status(403).json({
          success: false,
          error: { code: "NOT_PARTICIPANT", message: "해당 세션 참여자가 아닙니다." },
        });
      }

      if (error.message === "INPUT_ALREADY_SUBMITTED") {
        return res.status(409).json({
          success: false,
          error: { code: "INPUT_ALREADY_SUBMITTED", message: "이미 입력을 제출했습니다." },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: "INPUT_SUBMIT_FAILED",
          message: "입력 저장 중 오류가 발생했습니다.",
        },
      });
    }
  },
};
