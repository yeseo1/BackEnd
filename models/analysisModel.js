import { db } from "../config/db.js";

const TENSION_DISPLAY_NAMES = {
  FACT_CONFLICT: "사실 인식 충돌",
  PERSPECTIVE_GAP: "관점 차이",
  EMOTION_NEED_GAP: "감정-필요 엇갈림",
  LABEL_MISMATCH: "대화 초점 불일치",
  UNADDRESSED_NEEDS: "다뤄지지 않은 요구",
  INTERPRETATION_GAP: "해석 차이",
};

const PAIR_TYPE_DISPLAY_NAMES = {
  COMMON_FACT: "공통 사실",
  CONFLICTING_FACT_CLAIM: "사실 불일치",
  SHARED_EMOTION: "공통 감정",
  INTERPRETATION_ALIGNMENT: "해석 정렬",
  NEED_ALIGNMENT: "공통 니즈",
  FACT_INTERPRETATION_CROSS: "사실-해석 교차",
  EMOTION_NEED_CROSS: "감정-니즈 교차",
  CROSS_LABEL: "라벨 불일치",
};

const COMMON_GROUND_PAIR_TYPES = new Set([
  "COMMON_FACT",
  "SHARED_EMOTION",
  "INTERPRETATION_ALIGNMENT",
  "NEED_ALIGNMENT",
]);

function mapSessionRow(row) {
  return {
    id: row.id,
    status: row.status,
    relationshipType: row.relationship_type,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStatementRow(row) {
  return {
    id: row.id,
    speaker: row.speaker,
    text: row.text,
    spanStart: row.span_start,
    spanEnd: row.span_end,
    label: row.label,
    confidence: row.confidence,
  };
}

function mapInputRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    speaker: row.speaker,
    rawText: row.raw_text,
    submittedAt: row.submitted_at,
  };
}

async function getSessionAndParticipant({ sessionId, userId }) {
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
    SELECT id, role
    FROM session_participants
    WHERE session_id = $1 AND user_id = $2
    LIMIT 1
    `,
    [sessionId, userId],
  );

  if (!participantResult.rows.length) {
    throw new Error("NOT_PARTICIPANT");
  }

  return {
    session: sessionResult.rows[0],
    participant: participantResult.rows[0],
  };
}

async function getStatementsBySessionId(sessionId) {
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
    ORDER BY
      CASE speaker
        WHEN 'A' THEN 1
        WHEN 'B' THEN 2
        ELSE 3
      END,
      span_start ASC,
      id ASC
    `,
    [sessionId],
  );

  return statementsResult.rows.map(mapStatementRow);
}

export const analysisModel = {
  async getAnalysisBySessionId({ sessionId, userId }) {
    const { session } = await getSessionAndParticipant({ sessionId, userId });
    const statements = await getStatementsBySessionId(sessionId);

    return {
      session: mapSessionRow(session),
      statements,
    };
  },

  async getAnalysisStatusBySessionId({ sessionId, userId }) {
    const { session, participant } = await getSessionAndParticipant({ sessionId, userId });

    return {
      sessionId: session.id,
      mode: session.mode,
      status: session.status,
      relationshipType: session.relationship_type,
      participantRole: participant.role,
      updatedAt: session.updated_at,
    };
  },

  async getDualResultsBySessionId({ sessionId, userId }) {
    const { session } = await getSessionAndParticipant({ sessionId, userId });

    if (session.mode !== "DUAL") {
      throw new Error("INVALID_SESSION_MODE");
    }

    const statements = await getStatementsBySessionId(sessionId);
    const statementsBySpeaker = {
      A: statements.filter((statement) => statement.speaker === "A"),
      B: statements.filter((statement) => statement.speaker === "B"),
    };

    const alignedPairsResult = await db.query(
      `
      SELECT
        ap.id,
        ap.similarity,
        ap.pair_type,
        a.id AS a_statement_id,
        a.text AS a_text,
        a.label AS a_label,
        a.confidence AS a_confidence,
        a.span_start AS a_span_start,
        a.span_end AS a_span_end,
        b.id AS b_statement_id,
        b.text AS b_text,
        b.label AS b_label,
        b.confidence AS b_confidence,
        b.span_start AS b_span_start,
        b.span_end AS b_span_end
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
      pairTypeDisplayName: PAIR_TYPE_DISPLAY_NAMES[row.pair_type] || row.pair_type,
      aStatement: {
        id: row.a_statement_id,
        text: row.a_text,
        label: row.a_label,
        confidence: row.a_confidence,
        spanStart: row.a_span_start,
        spanEnd: row.a_span_end,
      },
      bStatement: {
        id: row.b_statement_id,
        text: row.b_text,
        label: row.b_label,
        confidence: row.b_confidence,
        spanStart: row.b_span_start,
        spanEnd: row.b_span_end,
      },
    }));

    const commonGroundPairs = alignedPairs.filter((pair) =>
      COMMON_GROUND_PAIR_TYPES.has(pair.pairType),
    );

    const tensionsResult = await db.query(
      `
      SELECT
        t.id,
        t.type,
        t.rationale,
        t.created_at,
        te.statement_id,
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
      ORDER BY t.created_at ASC, t.id ASC, te.statement_id ASC
      `,
      [sessionId],
    );

    const tensionsById = new Map();

    for (const row of tensionsResult.rows) {
      if (!tensionsById.has(row.id)) {
        tensionsById.set(row.id, {
          id: row.id,
          type: row.type,
          displayName: TENSION_DISPLAY_NAMES[row.type] || row.type,
          rationale: row.rationale,
          createdAt: row.created_at,
          evidence: [],
        });
      }

      if (row.statement_id) {
        tensionsById.get(row.id).evidence.push({
          statementId: row.statement_id,
          speaker: row.speaker,
          text: row.text,
          label: row.label,
          confidence: row.confidence,
          spanStart: row.span_start,
          spanEnd: row.span_end,
        });
      }
    }

    const tensions = Array.from(tensionsById.values());

    return {
      session: mapSessionRow(session),
      statements: statementsBySpeaker,
      alignedPairs,
      commonGroundPairs,
      tensions,
      summary: {
        aStatementCount: statementsBySpeaker.A.length,
        bStatementCount: statementsBySpeaker.B.length,
        alignedPairCount: alignedPairs.length,
        commonGroundPairCount: commonGroundPairs.length,
        tensionCount: tensions.length,
      },
    };
  },

  async getSingleResultsBySessionId({ sessionId, userId }) {
    const { session } = await getSessionAndParticipant({ sessionId, userId });

    if (session.mode !== "SINGLE") {
      throw new Error("INVALID_SESSION_MODE");
    }

    const inputResult = await db.query(
      `
      SELECT id, speaker, raw_text, submitted_at
      FROM input_texts
      WHERE session_id = $1
      ORDER BY submitted_at ASC
      LIMIT 1
      `,
      [sessionId],
    );

    const statements = await getStatementsBySessionId(sessionId);
    const selfStatements = statements.filter(
      (statement) => statement.speaker === "SELF" || statement.speaker === "A",
    );

    const labelCounts = selfStatements.reduce((counts, statement) => {
      counts[statement.label] = (counts[statement.label] || 0) + 1;
      return counts;
    }, {});

    return {
      session: mapSessionRow(session),
      input: mapInputRow(inputResult.rows[0]),
      statements: selfStatements,
      summary: {
        statementCount: selfStatements.length,
        labelCounts,
      },
    };
  },
};
