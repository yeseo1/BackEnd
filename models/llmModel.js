import crypto from "crypto";
import OpenAI from "openai";

import { db } from "../config/db.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

let llmResultsTableReady = false;

async function ensureLlmResultsTable() {
  if (llmResultsTableReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS llm_results (
      id UUID PRIMARY KEY,
      session_id UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      result_text TEXT NOT NULL,
      structured_result JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE llm_results
    ADD COLUMN IF NOT EXISTS structured_result JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  llmResultsTableReady = true;
}

function mapLlmResult(row) {
  if (!row) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    mode: row.mode,
    resultText: row.result_text,
    structuredResult: row.structured_result,
    sections: row.structured_result?.sections || null,
    diagramKeywords: row.structured_result?.diagramKeywords || null,
    sourceSnapshot: row.source_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSelfResult(row) {
  const result = mapLlmResult(row);
  if (!result) return null;

  return {
    ...result,
    session: {
      id: row.session_id,
      status: row.session_status,
      relationshipType: row.relationship_type,
      mode: row.session_mode,
      createdAt: row.session_created_at,
      updatedAt: row.session_updated_at,
    },
    input: row.input_id
      ? {
          id: row.input_id,
          speaker: row.input_speaker,
          rawText: row.raw_text,
          submittedAt: row.submitted_at,
        }
      : null,
  };
}

function mapStatement(row) {
  return {
    id: row.id,
    speaker: row.speaker,
    text: row.text,
    label: row.label,
    confidence: row.confidence,
    spanStart: row.span_start,
    spanEnd: row.span_end,
  };
}

async function getSessionAndParticipant({ sessionId, userId }) {
  const result = await db.query(
    `
    SELECT
     s.id,
     s.mode,
     s.status,
     s.relationship_type,
     sp.role
    FROM sessions s
    JOIN session_participants sp ON sp.session_id = s.id
    WHERE s.id = $1 AND sp.user_id = $2
    LIMIT 1
    `,
    [sessionId, userId],
  );

  if (!result.rows.length) {
    const sessionResult = await db.query(
      "SELECT id FROM sessions WHERE id = $1 LIMIT 1",
      [sessionId],
    );

    if (!sessionResult.rows.length) throw new Error("SESSION_NOT_FOUND");
    throw new Error("NOT_PARTICIPANT");
  }

  return result.rows[0];
}
const SECTION_TO_LABEL = {
  facts: "FACT",
  emotions: "EMOTION",
  interpretations: "INTERPRETATION",
  needs: "NEED",
};

function normalizeKeywords(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function toEvidenceStatement(statement, extra = {}) {
  const confidence = Number(statement.confidence);

  return {
    statementId: statement.id || statement.statementId,
    speaker: statement.speaker,
    text: statement.text,
    label: statement.label,
    confidence: Number.isFinite(confidence) ? confidence : null,
    confidencePercent: Number.isFinite(confidence)
      ? Math.round(confidence * 100)
      : null,
    spanStart: statement.spanStart ?? statement.span_start ?? 0,
    spanEnd: statement.spanEnd ?? statement.span_end ?? statement.text?.length ?? 0,
    ...extra,
  };
}

async function createEmbeddings(texts) {
  if (!texts.length) return [];

  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });

  return response.data.map((item) => item.embedding);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (!normA || !normB) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildKeywordEvidence({ diagramKeywords, statements, visibleSpeaker }) {
  const result = {};

  // 새 구조: diagramKeywords.a / diagramKeywords.b / diagramKeywords.common
  // 본인 키워드(a 또는 b)에 대해서만 evidence를 빌드 (공통·상대방은 원문 미표시)
  const speakerKey = visibleSpeaker === "A" ? "a" : visibleSpeaker === "B" ? "b" : "self";
  const ownKeywords = diagramKeywords?.[speakerKey] || {};

  for (const section of ["facts", "emotions", "interpretations", "needs"]) {
    const label = SECTION_TO_LABEL[section];
    const keywords = normalizeKeywords(ownKeywords[section] ?? diagramKeywords?.[section]);

    const sectionStatements = statements.filter(
      (statement) => statement.label === label,
    );

    if (!keywords.length || !sectionStatements.length) {
      result[section] = keywords.map((keyword) => ({
        keyword,
        label,
        evidence: [],
      }));
      continue;
    }

    const keywordEmbeddings = await createEmbeddings(keywords);
    const statementTexts = sectionStatements.map((statement) => statement.text);
    const statementEmbeddings = await createEmbeddings(statementTexts);

    result[section] = keywords.map((keyword, keywordIndex) => {
      const evidence = sectionStatements
        .map((statement, statementIndex) => {
          const keywordSimilarity = cosineSimilarity(
            keywordEmbeddings[keywordIndex],
            statementEmbeddings[statementIndex],
          );

          return toEvidenceStatement(statement, {
            keywordSimilarity,
            keywordSimilarityPercent: Math.round(keywordSimilarity * 100),
          });
        })
        .sort((a, b) => {
          if (b.keywordSimilarity !== a.keywordSimilarity) {
            return b.keywordSimilarity - a.keywordSimilarity;
          }

          return (b.confidence ?? 0) - (a.confidence ?? 0);
        })
        .slice(0, 3);

      return {
        keyword,
        label,
        evidence,
      };
    });
  }

  return result;
}

function keywordMatchScore(keyword, text) {
  if (!keyword || !text) return 0;

  const normalizedKeyword = keyword.replace(/\s+/g, "");
  const normalizedText = text.replace(/\s+/g, "");

  if (normalizedText.includes(normalizedKeyword)) return 2;

  const keywordParts = normalizedKeyword
    .split(/[,/·ㆍ\-\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (keywordParts.some((part) => normalizedText.includes(part))) return 1;

  return 0;
}


export const llmModel = {
  async getSessionContext({ sessionId, userId }) {
    const session = await getSessionAndParticipant({ sessionId, userId });
    const participantsResult = await db.query(
  `
  SELECT
    sp.role,
    COALESCE(sp.nickname, u.name) AS name,
    u.gender,
    u.age
  FROM session_participants sp
  JOIN users u ON u.id = sp.user_id
  WHERE sp.session_id = $1
  ORDER BY
    CASE sp.role
      WHEN 'A' THEN 1
      WHEN 'B' THEN 2
      WHEN 'SELF' THEN 3
      ELSE 4
    END
  `,
  [sessionId],
);

const participants = participantsResult.rows;
    const statementsResult = await db.query(
      `
      SELECT id, speaker, text, label, confidence, span_start, span_end
      FROM statements
      WHERE session_id = $1
      ORDER BY
        CASE speaker
          WHEN 'A' THEN 1
          WHEN 'B' THEN 2
          WHEN 'SELF' THEN 3
          ELSE 4
        END,
        span_start ASC,
        id ASC
      `,
      [sessionId],
    );

    const statements = statementsResult.rows.map(mapStatement);

    const tensionsResult = await db.query(
      `
      SELECT
        t.id,
        t.type,
        t.rationale,
        s.id AS statement_id,
        s.speaker,
        s.text,
        s.label,
        s.confidence,
        s.span_start,
        s.span_end
      FROM tensions t
      LEFT JOIN tension_evidence te ON te.tension_id = t.id
      LEFT JOIN statements s ON s.id = te.statement_id
      WHERE t.session_id = $1
      ORDER BY t.created_at ASC, t.id ASC, s.span_start ASC
      `,
      [sessionId],
    );0

    const tensionsById = new Map();

    for (const row of tensionsResult.rows) {
      if (!tensionsById.has(row.id)) {
        tensionsById.set(row.id, {
          id: row.id,
          type: row.type,
          rationale: row.rationale,
          evidence: [],
        });
      }

      if (row.statement_id) {
        tensionsById.get(row.id).evidence.push(
          mapStatement({
            id: row.statement_id,
            speaker: row.speaker,
            text: row.text,
            label: row.label,
            confidence: row.confidence,
            span_start: row.span_start,
            span_end: row.span_end,
          }),
        );
      }
    }

    const alignedPairsResult = await db.query(
      `
      SELECT
        ap.id,
        ap.similarity,
        ap.pair_type,
        a.id AS a_statement_id,
        a.text AS a_text,
        a.label AS a_label,
        b.id AS b_statement_id,
        b.text AS b_text,
        b.label AS b_label
      FROM alignment_pairs ap
      JOIN statements a ON a.id = ap.a_statement_id
      JOIN statements b ON b.id = ap.b_statement_id
      WHERE ap.session_id = $1
      ORDER BY ap.similarity DESC, ap.id ASC
      `,
      [sessionId],
    );

    const alignedPairs = alignedPairsResult.rows.map((row) => ({
      id: row.id,
      similarity: row.similarity,
      pairType: row.pair_type,
      aStatement: {
        id: row.a_statement_id,
        text: row.a_text,
        label: row.a_label,
      },
      bStatement: {
        id: row.b_statement_id,
        text: row.b_text,
        label: row.b_label,
      },
    }));

    return {
      session: {
  id: session.id,
  mode: session.mode,
  status: session.status,
  relationshipType: session.relationship_type,
  participantRole: session.role,
},
participants,
      statements,
      statementsBySpeaker: {
        A: statements.filter((statement) => statement.speaker === "A"),
        B: statements.filter((statement) => statement.speaker === "B"),
        SELF: statements.filter((statement) => statement.speaker === "SELF"),
      },
      tensions: Array.from(tensionsById.values()),
      alignedPairs,
    };
  },

  async getSavedResult({ sessionId, userId }) {
    await ensureLlmResultsTable();
    await getSessionAndParticipant({ sessionId, userId });

    const result = await db.query(
      `
      SELECT
        id,
        session_id,
        mode,
        result_text,
        structured_result,
        source_snapshot,
        created_at,
        updated_at
      FROM llm_results
      WHERE session_id = $1
      LIMIT 1
      `,
      [sessionId],
    );

    return mapLlmResult(result.rows[0]);
  },

  async getSelfResults({ userId }) {
    await ensureLlmResultsTable();

    const result = await db.query(
      `
      SELECT
        lr.id,
        lr.session_id,
        lr.mode,
        lr.result_text,
        lr.structured_result,
        lr.source_snapshot,
        lr.created_at,
        lr.updated_at,
        s.status AS session_status,
        s.relationship_type,
        s.mode AS session_mode,
        s.created_at AS session_created_at,
        s.updated_at AS session_updated_at,
        it.id AS input_id,
        it.speaker AS input_speaker,
        it.raw_text,
        it.submitted_at
      FROM llm_results lr
      JOIN sessions s ON s.id = lr.session_id
      JOIN session_participants sp ON sp.session_id = s.id
      LEFT JOIN LATERAL (
        SELECT id, speaker, raw_text, submitted_at
        FROM input_texts
        WHERE session_id = s.id
        ORDER BY submitted_at ASC
        LIMIT 1
      ) it ON TRUE
      WHERE sp.user_id = $1
        AND s.mode = 'SINGLE'
        AND lr.mode = 'SINGLE'
      ORDER BY lr.updated_at DESC, lr.created_at DESC
      `,
      [userId],
    );

    return result.rows.map(mapSelfResult);
  },

  async saveResult({ sessionId, mode, resultText, structuredResult, sourceSnapshot }) {
    await ensureLlmResultsTable();

    const result = await db.query(
      `
      INSERT INTO llm_results (
        id,
        session_id,
        mode,
        result_text,
        structured_result,
        source_snapshot,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (session_id)
      DO UPDATE SET
        mode = EXCLUDED.mode,
        result_text = EXCLUDED.result_text,
        structured_result = EXCLUDED.structured_result,
        source_snapshot = EXCLUDED.source_snapshot,
        updated_at = NOW()
      RETURNING
        id,
        session_id,
        mode,
        result_text,
        structured_result,
        source_snapshot,
        created_at,
        updated_at
      `,
      [
        crypto.randomUUID(),
        sessionId,
        mode,
        resultText,
        JSON.stringify(structuredResult || {}),
        JSON.stringify(sourceSnapshot || {}),
      ],
      
    );

    return mapLlmResult(result.rows[0]);
  },
    async getEvidenceBySessionId({ sessionId, userId }) {
    await ensureLlmResultsTable();
    const participant = await getSessionAndParticipant({ sessionId, userId });

    const result = await db.query(
      `
      SELECT
        session_id,
        mode,
        structured_result,
        source_snapshot,
        created_at,
        updated_at
      FROM llm_results
      WHERE session_id = $1
      LIMIT 1
      `,
      [sessionId],
    );

    if (!result.rows.length) {
      throw new Error("LLM_RESULT_NOT_FOUND");
    }

    const row = result.rows[0];
    const structuredResult = row.structured_result || {};
    const sourceSnapshot = row.source_snapshot || {};
    const visibleSpeaker =
  participant.role === "A"
    ? "A"
    : participant.role === "B"
      ? "B"
      : "SELF";

const visibleStatements = (sourceSnapshot.statements || []).filter(
  (statement) => statement.speaker === visibleSpeaker,
);
    return {
      sessionId: row.session_id,
      mode: row.mode,
      keywordEvidence: await buildKeywordEvidence({
        diagramKeywords: structuredResult.diagramKeywords || {},
        statements: visibleStatements,
        visibleSpeaker,
      }),
      tensions: (sourceSnapshot.tensions || []).map((tension) => ({
        id: tension.id,
        type: tension.type,
        rationale: tension.rationale,
        evidence: (tension.evidence || [])
  .filter((statement) => statement.speaker === visibleSpeaker)
  .map(toEvidenceStatement),
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
};
