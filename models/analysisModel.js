import { db } from "../config/db.js";

export const analysisModel = {
  async getAnalysisBySessionId({ sessionId, userId }) {
    const sessionResult = await db.query(
      `
      SELECT id, status, relationship_type, mode, created_at, updated_at
      FROM sessions
      WHERE id = $1
      LIMIT 1
      `,
      [sessionId],
    );

    if (!sessionResult.rows.length) {
      throw new Error("SESSION_NOT_FOUND");
    }

    const participantResult = await db.query(
      `
      SELECT id
      FROM session_participants
      WHERE session_id = $1 AND user_id = $2
      LIMIT 1
      `,
      [sessionId, userId],
    );

    if (!participantResult.rows.length) {
      throw new Error("NOT_PARTICIPANT");
    }

    const statementsResult = await db.query(
      `
      SELECT
        id,
        speaker,
        text,
        span_start,
        span_end,
        label,
        confidence
      FROM statements
      WHERE session_id = $1
      ORDER BY speaker ASC, span_start ASC
      `,
      [sessionId],
    );

    return {
      session: sessionResult.rows[0],
      statements: statementsResult.rows.map((row) => ({
        id: row.id,
        speaker: row.speaker,
        text: row.text,
        spanStart: row.span_start,
        spanEnd: row.span_end,
        label: row.label,
        confidence: row.confidence,
      })),
    };
  },
};