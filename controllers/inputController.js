import OpenAI from "openai";

import { inputModel } from "../models/inputModel.js";
import { parseKakaoCaptureImages } from "../utils/kakaoCaptureParser.js";
import { splitIntoStatements } from "../utils/statementSplitter.js";
import { selectKeyTensions } from "../utils/tensionSelector.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODERATION_MODEL =
  process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";


const FEIN_MODEL_BASE_URL =
  process.env.FEIN_MODEL_BASE_URL || "http://localhost:8000";

const MAX_KAKAO_CAPTURE_IMAGES = Number(
  process.env.MAX_KAKAO_CAPTURE_IMAGES || 6,
);
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

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

function filesToImageInputs(files = []) {
  return files.map((file) => ({
    imageBase64: file.buffer.toString("base64"),
    mimeType: file.mimetype,
  }));
}

async function runDualFeinAnalysis({ sessionId, aRawText, bRawText }) {
  await inputModel.updateSessionStatus({
    sessionId,
    status: "ANALYZING",
  });

  const aStatementsInput = splitIntoStatements(aRawText);
  const bStatementsInput = splitIntoStatements(bRawText);

  const analyzeResponse = await postJson(
    `${FEIN_MODEL_BASE_URL}/internal/fein/analyze-dual`,
    {
      a_statements: aStatementsInput.length ? aStatementsInput : [aRawText],
      b_statements: bStatementsInput.length ? bStatementsInput : [bRawText],
    },
  );

  const aStatements = toStatements(
    analyzeResponse.data?.data?.a_results,
    "A",
    aRawText,
  );

  const bStatements = toStatements(
    analyzeResponse.data?.data?.b_results,
    "B",
    bRawText,
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

  return {
    alignedPairCount: savedArtifacts.alignmentPairs.length,
    tensionCount: savedArtifacts.tensions.length,
  };
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
            message: "rawText???꾩닔?낅땲??",
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
            message: "?꾪뿕 ?좏샇媛 媛먯??섏뼱 ?낅젰??李⑤떒?섏뿀?듬땲??",
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
        const isAnalysisTriggerStatus =
          result.status === "READY" || result.status === "ANALYZING";

        if (result.mode === "SINGLE" && isAnalysisTriggerStatus) {
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

        if (result.mode === "DUAL" && isAnalysisTriggerStatus) {
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
        message: "?낅젰????λ릺?덉뒿?덈떎.",
        data: {
          ...result,
          feinAnalysisStatus,
          next:
            feinAnalysisStatus === "DONE"
              ? {
                  generateLlmResult: `/llm/sessions/${sessionId}/analysis`,
                  getLlmResult: `/llm/sessions/${sessionId}/analysis`,
                }
              : null,
        },
      });
    } catch (error) {
      if (error.message === "SESSION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: { code: "SESSION_NOT_FOUND", message: "?몄뀡??李얠쓣 ???놁뒿?덈떎." },
        });
      }

      if (error.message === "NOT_PARTICIPANT") {
        return res.status(403).json({
          success: false,
          error: { code: "NOT_PARTICIPANT", message: "?대떦 ?몄뀡 李몄뿬?먭? ?꾨떃?덈떎." },
        });
      }

      if (error.message === "INPUT_ALREADY_SUBMITTED") {
        return res.status(409).json({
          success: false,
          error: { code: "INPUT_ALREADY_SUBMITTED", message: "?대? ?낅젰???쒖텧?덉뒿?덈떎." },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: "INPUT_SUBMIT_FAILED",
          message: "?낅젰 ???以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.",
        },
      });
    }
  },

  async submitKakaoCaptures(req, res) {
    try {
      const { sessionId } = req.params;
      const uploadedImages = filesToImageInputs(req.files);
      const images = uploadedImages.length
        ? uploadedImages
        : Array.isArray(req.body?.images)
          ? req.body.images
          : null;
      const imageCount =
        images?.length || (req.body?.imageBase64 || req.body?.imageDataUrl ? 1 : 0);

      if (!imageCount) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "images, imageBase64, or imageDataUrl is required.",
          },
        });
      }

      if (imageCount > MAX_KAKAO_CAPTURE_IMAGES) {
        return res.status(400).json({
          success: false,
          error: {
            code: "TOO_MANY_IMAGES",
            message: `Up to ${MAX_KAKAO_CAPTURE_IMAGES} images can be uploaded at once.`,
          },
        });
      }

      const parsed = await parseKakaoCaptureImages({
        images,
        imageBase64: req.body?.imageBase64,
        imageDataUrl: req.body?.imageDataUrl,
        mimeType: req.body?.mimeType,
      });

      if (!parsed.messages.length) {
        return res.status(422).json({
          success: false,
          error: {
            code: "KAKAO_CAPTURE_EMPTY",
            message: "No chat bubbles were extracted from the images.",
            details: parsed.notes,
          },
        });
      }

      if (!parsed.summary.hasBothSpeakers) {
        return res.status(422).json({
          success: false,
          error: {
            code: "KAKAO_CAPTURE_SPEAKER_INCOMPLETE",
            message: "Both A and B speaker messages are required.",
            details: {
              ...parsed.summary,
              notes: parsed.notes,
            },
          },
        });
      }

      const moderationResult = await moderateText(parsed.combinedText);

      if (moderationResult.flagged) {
        await inputModel.blockSession({ sessionId });

        return res.status(400).json({
          success: false,
          error: {
            code: "INPUT_BLOCKED",
            message: "Input was blocked by moderation.",
            details: moderationResult,
          },
        });
      }

      const result = await inputModel.submitDualCaptureInput({
        sessionId,
        userId: req.user.id,
        aRawText: parsed.rawTexts.A,
        bRawText: parsed.rawTexts.B,
      });

      let feinAnalysisStatus = "SKIPPED";

      try {
        result.analysisArtifacts = await runDualFeinAnalysis({
          sessionId,
          aRawText: parsed.rawTexts.A,
          bRawText: parsed.rawTexts.B,
        });
        feinAnalysisStatus = "DONE";
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
        message: "KakaoTalk capture input saved.",
        data: {
          ...result,
          captureParsing: {
            model: parsed.model,
            imageCount: parsed.imageCount,
            messages: parsed.messages,
            notes: parsed.notes,
            summary: parsed.summary,
          },
          feinAnalysisStatus,
          next:
            feinAnalysisStatus === "DONE"
              ? {
                  generateLlmResult: `/llm/sessions/${sessionId}/analysis`,
                  getLlmResult: `/llm/sessions/${sessionId}/analysis`,
                }
              : null,
        },
      });
    } catch (error) {
      if (error.message === "SESSION_NOT_FOUND") {
        return res.status(404).json({
          success: false,
          error: { code: "SESSION_NOT_FOUND", message: "Session not found." },
        });
      }

      if (error.message === "NOT_PARTICIPANT") {
        return res.status(403).json({
          success: false,
          error: { code: "NOT_PARTICIPANT", message: "Not a session participant." },
        });
      }

      if (error.message === "DUAL_SESSION_REQUIRED") {
        return res.status(409).json({
          success: false,
          error: {
            code: "DUAL_SESSION_REQUIRED",
            message: "KakaoTalk capture input requires a DUAL mode session.",
          },
        });
      }

      if (error.message === "INPUT_ALREADY_SUBMITTED") {
        return res.status(409).json({
          success: false,
          error: { code: "INPUT_ALREADY_SUBMITTED", message: "Input already submitted." },
        });
      }

      if (error.code === "KAKAO_CAPTURE_IMAGE_REQUIRED") {
        return res.status(400).json({
          success: false,
          error: {
            code: error.code,
            message: "At least one valid image is required.",
          },
        });
      }

      if (
        error.code === "KAKAO_CAPTURE_OCR_CONFIG_MISSING" ||
        error.code === "KAKAO_CAPTURE_OCR_CONFIG_INVALID"
      ) {
        return res.status(500).json({
          success: false,
          error: {
            code: error.code,
            message:
              error.details ||
              "Google Vision OCR credentials are not configured.",
          },
        });
      }

      if (
        error.code === "KAKAO_CAPTURE_OCR_AUTH_FAILED" ||
        error.code === "KAKAO_CAPTURE_OCR_REQUEST_FAILED"
      ) {
        console.error("Kakao capture OCR failed", {
          code: error.code,
          message: error.details,
          cause: error.cause?.message,
        });

        return res.status(502).json({
          success: false,
          error: {
            code: error.code,
            message:
              error.details ||
              "Google Vision OCR request failed.",
            details: IS_DEVELOPMENT
              ? {
                  cause: error.cause?.message,
                  googleCode: error.cause?.code,
                }
              : undefined,
          },
        });
      }

      console.error("Kakao capture input failed", error);

      return res.status(500).json({
        success: false,
        error: {
          code: "KAKAO_CAPTURE_SUBMIT_FAILED",
          message: "Failed to process KakaoTalk capture input.",
        },
      });
    }
  },
};
