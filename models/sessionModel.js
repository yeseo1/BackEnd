import bcrypt from "bcrypt";

import { db } from "../config/db.js";

export const sessionModel = {
  async createSession({ ownerUserId, relationshipType, mode, roomPassword, nickname }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const roomPasswordHash = await bcrypt.hash(roomPassword, 10);
      const ownerRole = mode === "SINGLE" ? "SELF" : "A";

      const sessionResult = await client.query(
        `
        INSERT INTO sessions (
          owner_user_id,
          status,
          relationship_type,
          mode,
          room_password_hash,
          created_at,
          updated_at
        )
        VALUES ($1, 'WAITING_INPUT', $2, $3, $4, NOW(), NOW())
        RETURNING id, owner_user_id, status, relationship_type, mode, created_at, updated_at
        `,
        [ownerUserId, relationshipType, mode, roomPasswordHash],
      );

      const session = sessionResult.rows[0];

      const participantResult = await client.query(
        `
        INSERT INTO session_participants (
          session_id,
          user_id,
          role,
          nickname,
          joined_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id, session_id, user_id, role, nickname, joined_at
        `,
        [session.id, ownerUserId, ownerRole, nickname || null],
      );

      await client.query("COMMIT");

      return {
        ...session,
        role: ownerRole,
        participant: participantResult.rows[0],
        inviteLink: `${process.env.FRONTEND_URL}/invite/${session.id}`,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async joinSession({ sessionId, userId, roomPassword, nickname }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `
        SELECT id, owner_user_id, status, relationship_type, mode, room_password_hash, created_at, updated_at
        FROM sessions
        WHERE id = $1
        LIMIT 1
        `,
        [sessionId],
      );

      if (!sessionResult.rows.length) throw new Error("SESSION_NOT_FOUND");

      const session = sessionResult.rows[0];

      if (session.mode === "SINGLE") {
        throw new Error("SINGLE_SESSION_NOT_JOINABLE");
      }

      const isValidPassword = await bcrypt.compare(
        roomPassword,
        session.room_password_hash,
      );

      if (!isValidPassword) {
        throw new Error("INVALID_ROOM_PASSWORD");
      }

      const already = await client.query(
        `
        SELECT id
        FROM session_participants
        WHERE session_id = $1 AND user_id = $2
        LIMIT 1
        `,
        [sessionId, userId],
      );

      if (already.rows.length) throw new Error("ALREADY_JOINED");

      const count = await client.query(
        `
        SELECT COUNT(*)::int AS count
        FROM session_participants
        WHERE session_id = $1
        `,
        [sessionId],
      );

      if (count.rows[0].count >= 2) throw new Error("SESSION_FULL");

      const participantResult = await client.query(
        `
        INSERT INTO session_participants (
          session_id,
          user_id,
          role,
          nickname,
          joined_at
        )
        VALUES ($1, $2, 'B', $3, NOW())
        RETURNING id, session_id, user_id, role, nickname, joined_at
        `,
        [sessionId, userId, nickname || null],
      );

      await client.query(
        `
        UPDATE sessions
        SET updated_at = NOW()
        WHERE id = $1
        `,
        [sessionId],
      );

      await client.query("COMMIT");

      return {
        sessionId: session.id,
        role: "B",
        status: session.status,
        participant: participantResult.rows[0],
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async getSessionStatus({ sessionId, userId }) {
    const client = await db.connect();

    try {
      const result = await client.query(
        `
        SELECT 
          s.id,
          s.status,
          sp.role,
          COUNT(it.id) AS input_count
        FROM sessions s
        JOIN session_participants sp 
          ON s.id = sp.session_id
        LEFT JOIN input_texts it 
          ON s.id = it.session_id
        WHERE s.id = $1 
          AND sp.user_id = $2
        GROUP BY s.id, s.status, sp.role
        `,
        [sessionId, userId]
      );

      if (!result.rows.length) return null;

      const row = result.rows[0];

      return {
        id: row.id,
        status: row.status,
        role: row.role,
        bothSubmitted: parseInt(row.input_count) >= 2,
      };

    } finally {
      client.release();
    }
  }
};
