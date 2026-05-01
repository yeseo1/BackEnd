import { db } from "../config/db.js";

export const sessionModel = {
  async createSession({ ownerUserId, relationshipType, mode }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `
        INSERT INTO sessions (
          owner_user_id,
          status,
          relationship_type,
          mode,
          created_at,
          updated_at
        )
        VALUES ($1, 'WAITING_INPUT', $2, $3, NOW(), NOW())
        RETURNING *
        `,
        [ownerUserId, relationshipType, mode],
      );

      const session = sessionResult.rows[0];

      await client.query(
        `
        INSERT INTO session_participants (
          session_id,
          user_id,
          role,
          joined_at
        )
        VALUES ($1, $2, 'A', NOW())
        `,
        [session.id, ownerUserId],
      );

      await client.query("COMMIT");

      return session;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async joinSession({ sessionId, userId }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `SELECT * FROM sessions WHERE id = $1`,
        [sessionId],
      );

      if (!sessionResult.rows.length) throw new Error("SESSION_NOT_FOUND");

      const already = await client.query(
        `SELECT * FROM session_participants WHERE session_id = $1 AND user_id = $2`,
        [sessionId, userId],
      );

      if (already.rows.length) throw new Error("ALREADY_JOINED");

      const count = await client.query(
        `SELECT COUNT(*) FROM session_participants WHERE session_id = $1`,
        [sessionId],
      );

      if (parseInt(count.rows[0].count) >= 2) throw new Error("SESSION_FULL");

      await client.query(
        `
        INSERT INTO session_participants (
          session_id,
          user_id,
          role,
          joined_at
        )
        VALUES ($1, $2, 'B', NOW())
        `,
        [sessionId, userId],
      );

      await client.query(
        `UPDATE sessions SET status='READY', updated_at=NOW() WHERE id=$1`,
        [sessionId],
      );

      await client.query("COMMIT");

      return { sessionId };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};