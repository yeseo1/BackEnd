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

export const historyModel = {
  async getHistoryByUserId({ userId }) {
    const listResult = await db.query(
      `
      SELECT
        s.id,
        s.status,
        s.mode,
        s.relationship_type,
        s.created_at,
        s.updated_at
      FROM sessions s
      INNER JOIN session_participants sp ON sp.session_id = s.id
      WHERE sp.user_id = $1
      ORDER BY s.created_at DESC
      `,
      [userId],
    );

    return {
      items: listResult.rows.map((row) => ({
        sessionId: row.id,
        status: row.status,
        mode: row.mode,
        relationshipType: row.relationship_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  },

  async getHistoryResultBySessionId({ sessionId, userId }) {
    await ensureLlmResultsTable();

    const sessionResult = await db.query(
      `
      SELECT
        s.id,
        s.status,
        s.mode,
        s.relationship_type,
        s.created_at,
        s.updated_at,
        sp.role
      FROM sessions s
      INNER JOIN session_participants sp ON sp.session_id = s.id
      WHERE s.id = $1 AND sp.user_id = $2
      LIMIT 1
      `,
      [sessionId, userId],
    );

    if (!sessionResult.rows.length) {
      const existsResult = await db.query(
        `
        SELECT id
        FROM sessions
        WHERE id = $1
        LIMIT 1
        `,
        [sessionId],
      );

      if (!existsResult.rows.length) {
        throw new Error("SESSION_NOT_FOUND");
      }

      throw new Error("NOT_PARTICIPANT");
    }

    const llmResult = await db.query(
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

    if (!llmResult.rows.length) {
      throw new Error("LLM_RESULT_NOT_FOUND");
    }

    const session = sessionResult.rows[0];

    return {
      session: {
        sessionId: session.id,
        status: session.status,
        mode: session.mode,
        relationshipType: session.relationship_type,
        participantRole: session.role,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      },
      result: mapLlmResult(llmResult.rows[0]),
    };
  },
};