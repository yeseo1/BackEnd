import { db } from "../config/db.js";

export const inputModel = {
  async blockSession({ sessionId }) {
    const query = `
      UPDATE sessions
      SET status = 'BLOCKED',
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, updated_at
    `;

    const result = await db.query(query, [sessionId]);

    return result.rows[0] || null;
  },

  async submitInput({ sessionId, userId, rawText }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `
        SELECT id, status, mode
        FROM sessions
        WHERE id = $1
        LIMIT 1
        `,
        [sessionId],
      );

      if (!sessionResult.rows.length) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const session = sessionResult.rows[0];

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

      let status = session.status;
      const requiredInputCount = session.mode === "SINGLE" ? 1 : 2;

      if (countResult.rows[0].count >= requiredInputCount) {
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
        mode: session.mode,
        status,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async submitDualCaptureInput({ sessionId, userId, aRawText, bRawText }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const sessionResult = await client.query(
        `
        SELECT id, status, mode
        FROM sessions
        WHERE id = $1
        LIMIT 1
        `,
        [sessionId],
      );

      if (!sessionResult.rows.length) {
        throw new Error("SESSION_NOT_FOUND");
      }

      const session = sessionResult.rows[0];

      if (session.mode !== "DUAL") {
        throw new Error("DUAL_SESSION_REQUIRED");
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

      const existingInputResult = await client.query(
        `
        SELECT id
        FROM input_texts
        WHERE session_id = $1
        LIMIT 1
        `,
        [sessionId],
      );

      if (existingInputResult.rows.length) {
        throw new Error("INPUT_ALREADY_SUBMITTED");
      }

      const insertedInputs = [];

      for (const input of [
        { speaker: "A", rawText: aRawText },
        { speaker: "B", rawText: bRawText },
      ]) {
        const inputResult = await client.query(
          `
          INSERT INTO input_texts (
            session_id,
            user_id,
            speaker,
            raw_text,
            ocr_text,
            submitted_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
          RETURNING id, session_id, user_id, speaker, raw_text, ocr_text, submitted_at
          `,
          [sessionId, userId, input.speaker, input.rawText, input.rawText],
        );

        insertedInputs.push(inputResult.rows[0]);
      }

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

      await client.query("COMMIT");

      return {
        inputs: insertedInputs,
        speaker: participantResult.rows[0].role,
        mode: session.mode,
        status: updatedSessionResult.rows[0].status,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async getSessionInputs({ sessionId }) {
    const query = `
      SELECT speaker, raw_text
      FROM input_texts
      WHERE session_id = $1
      ORDER BY submitted_at ASC
    `;

    const result = await db.query(query, [sessionId]);
    return result.rows;
  },

  async updateSessionStatus({ sessionId, status }) {
    const query = `
      UPDATE sessions
      SET status = $2,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, status, updated_at
    `;

    const result = await db.query(query, [sessionId, status]);
    return result.rows[0] || null;
  },

  async saveStatements({ sessionId, statements }) {
    if (!statements?.length) return [];

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const inserted = [];

      for (const statement of statements) {
        const row = await client.query(
          `
          INSERT INTO statements (
            session_id,
            speaker,
            text,
            span_start,
            span_end,
            label,
            confidence
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, session_id, speaker, text, span_start, span_end, label, confidence
          `,
          [
            sessionId,
            statement.speaker,
            statement.text,
            statement.span_start,
            statement.span_end,
            statement.label,
            statement.confidence,
          ],
        );

        inserted.push(row.rows[0]);
      }

      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async saveDualAnalysisArtifacts({
    sessionId,
    aStatements,
    bStatements,
    alignedPairs,
    tensions,
  }) {
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const aStatementIdByIndex = new Map(
        (aStatements || []).map((statement, index) => [index, statement.id]),
      );
      const bStatementIdByIndex = new Map(
        (bStatements || []).map((statement, index) => [index, statement.id]),
      );

      const savedAlignmentPairs = [];

      for (const pair of alignedPairs || []) {
        const aStatementId = aStatementIdByIndex.get(pair.a_index);
        const bStatementId = bStatementIdByIndex.get(pair.b_index);

        if (!aStatementId || !bStatementId) {
          continue;
        }

        const result = await client.query(
          `
          INSERT INTO alignment_pairs (
            session_id,
            a_statement_id,
            b_statement_id,
            similarity,
            pair_type
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, session_id, a_statement_id, b_statement_id, similarity, pair_type
          `,
          [
            sessionId,
            aStatementId,
            bStatementId,
            pair.similarity,
            pair.pair_type,
          ],
        );

        savedAlignmentPairs.push(result.rows[0]);
      }

      const savedTensions = [];

      for (const tension of tensions || []) {
        const tensionResult = await client.query(
          `
          INSERT INTO tensions (
            session_id,
            type,
            rationale,
            created_at
          )
          VALUES ($1, $2, $3, NOW())
          RETURNING id, session_id, type, rationale, created_at
          `,
          [sessionId, tension.type, tension.rationale],
        );

        const savedTension = {
          ...tensionResult.rows[0],
          score: tension.score,
          evidence_count: 0,
        };

        const evidenceStatementIds = new Set();

        for (const evidence of tension.evidence || []) {
          if (typeof evidence.a_index === "number") {
            const statementId = aStatementIdByIndex.get(evidence.a_index);
            if (statementId) evidenceStatementIds.add(statementId);
          }

          if (typeof evidence.b_index === "number") {
            const statementId = bStatementIdByIndex.get(evidence.b_index);
            if (statementId) evidenceStatementIds.add(statementId);
          }

          if (evidence.side === "A" && typeof evidence.statement_index === "number") {
            const statementId = aStatementIdByIndex.get(evidence.statement_index);
            if (statementId) evidenceStatementIds.add(statementId);
          }

          if (evidence.side === "B" && typeof evidence.statement_index === "number") {
            const statementId = bStatementIdByIndex.get(evidence.statement_index);
            if (statementId) evidenceStatementIds.add(statementId);
          }
        }

        for (const statementId of evidenceStatementIds) {
          await client.query(
            `
            INSERT INTO tension_evidence (
              tension_id,
              statement_id
            )
            VALUES ($1, $2)
            ON CONFLICT (tension_id, statement_id) DO NOTHING
            `,
            [savedTension.id, statementId],
          );
        }

        savedTension.evidence_count = evidenceStatementIds.size;
        savedTensions.push(savedTension);
      }

      await client.query("COMMIT");

      return {
        alignmentPairs: savedAlignmentPairs,
        tensions: savedTensions,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
