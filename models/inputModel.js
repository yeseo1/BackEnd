import { db } from "../config/db.js";

export const inputModel = {
  async submitInput({ sessionId, userId, rawText }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `
        SELECT id, status
        FROM sessions
        WHERE id = $1
        LIMIT 1
        `,
        [sessionId],
      );

      if (!sessionResult.rows.length) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const participantResult = await client.query(
        `
        SELECT role
        FROM session_participants
        WHERE session_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [sessionId, userId],
      );

      if (!participantResult.rows.length) {
        throw new Error("NOT_PARTICIPANT");
      }

      const speaker = participantResult.rows[0].role;

      const existingInputResult = await client.query(
        `
        SELECT id
        FROM input_texts
        WHERE session_id = $1 AND speaker = $2
        LIMIT 1
        `,
        [sessionId, speaker],
      );

      if (existingInputResult.rows.length) {
        throw new Error("INPUT_ALREADY_SUBMITTED");
      }

      const inputResult = await client.query(
        `
        INSERT INTO input_texts (
          session_id,
          user_id,
          speaker,
          raw_text,
          submitted_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id, session_id, user_id, speaker, raw_text, submitted_at
        `,
        [sessionId, userId, speaker, rawText],
      );

      const countResult = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM input_texts
        WHERE session_id = $1
        `,
        [sessionId],
      );

      let status = sessionResult.rows[0].status;

      if (countResult.rows[0].count >= 2) {
        const updatedSessionResult = await client.query(
          `
          UPDATE sessions
          SET status = 'ANALYZING',
              updated_at = NOW()
          WHERE id = $1
          RETURNING status
          `,
          [sessionId],
        );

        status = updatedSessionResult.rows[0].status;
      }

      await client.query("COMMIT");

      return {
        input: inputResult.rows[0],
        speaker,
        status,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};