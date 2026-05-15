import crypto from "crypto";

import { db } from "../config/db.js";

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

export const llmModel = {
  async getSessionContext({ sessionId, userId }) {
    const session = await getSessionAndParticipant({ sessionId, userId });

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
    );

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
        participantRole: session.role,
      },
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
};
