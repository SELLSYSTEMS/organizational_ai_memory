import { publicScopeSqlParameters } from './config.mjs';

const ELIGIBLE_THREAD_CTE = `
  SELECT
    id,
    thread_key,
    brand_key,
    scope_kind,
    scope_key,
    source_system,
    title,
    language_code,
    metadata,
    created_at,
    updated_at
  FROM memory.threads
  WHERE brand_key = $1
    AND thread_key = $2
    AND metadata @> jsonb_build_object('corpus', $3::text, 'visibility', $4::text)
    AND status = $5
`;

const READINESS_SQL = `
  SELECT EXISTS (
    ${ELIGIBLE_THREAD_CTE}
  ) AS public_corpus_available
`;

const THREAD_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    id,
    thread_key,
    brand_key,
    scope_kind,
    scope_key,
    source_system,
    title,
    language_code,
    metadata->>'description' AS description,
    metadata->>'review_status' AS review_status,
    metadata->>'source_classification' AS source_classification,
    created_at,
    updated_at
  FROM eligible_thread
  LIMIT 1
`;

const TURNS_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    tt.id,
    tt.source_turn_id,
    tt.actor_role,
    tt.actor_key,
    tt.turn_kind,
    tt.sent_at,
    left(tt.text_raw, 1000) AS text
  FROM memory.thread_turns tt
  JOIN eligible_thread t ON t.id = tt.thread_id
  ORDER BY COALESCE(tt.sent_at, tt.created_at), tt.created_at, tt.source_turn_id
  LIMIT 200
`;

const OBSERVATIONS_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    o.id,
    o.observation_key,
    o.observation_kind,
    o.subject_key,
    o.actor_key,
    o.observed_at,
    o.salience,
    o.confidence,
    left(o.observation_text, 1200) AS observation_text,
    o.source_turn_ids,
    o.review_status,
    o.created_at,
    o.updated_at
  FROM memory.observations o
  JOIN eligible_thread t ON t.id = o.thread_id
  WHERE o.is_active = true
  ORDER BY o.observed_at DESC, o.observation_key
  LIMIT 200
`;

const FACTS_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    f.id,
    f.fact_key,
    f.subject_key,
    f.predicate,
    left(f.object_value, 1200) AS object_value,
    f.object_payload,
    f.confidence,
    f.provenance_kind,
    f.source_turn_ids,
    f.source_observation_ids,
    f.review_status,
    f.valid_from,
    f.valid_to,
    f.superseded_by_fact_id,
    f.is_current,
    f.created_at,
    f.updated_at
  FROM memory.facts f
  JOIN eligible_thread t ON t.id = f.thread_id
  ORDER BY f.predicate, f.valid_from DESC, f.fact_key
  LIMIT 100
`;

const SUPERSESSIONS_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    fs.previous_fact_id,
    fs.new_fact_id,
    left(fs.reason, 500) AS reason,
    fs.created_at
  FROM memory.fact_supersessions fs
  JOIN memory.facts previous_fact ON previous_fact.id = fs.previous_fact_id
  JOIN memory.facts new_fact ON new_fact.id = fs.new_fact_id
  JOIN eligible_thread t
    ON t.id = previous_fact.thread_id
   AND t.id = new_fact.thread_id
  ORDER BY fs.created_at, fs.id
  LIMIT 100
`;

const SUMMARIES_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    s.id,
    s.summary_key,
    s.summary_scope,
    left(s.summary_text, 4000) AS summary_text,
    s.turn_count,
    s.source_turn_ids,
    s.quality_label,
    s.review_status,
    s.created_at,
    s.updated_at
  FROM memory.thread_summaries s
  JOIN eligible_thread t ON t.id = s.thread_id
  WHERE s.is_active = true
  ORDER BY s.updated_at DESC, s.summary_key
  LIMIT 5
`;

const REFLECTIONS_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  SELECT
    r.id,
    r.reflection_key,
    r.reflection_scope,
    left(r.reflection_text, 4000) AS reflection_text,
    r.supporting_observation_ids,
    r.supporting_fact_ids,
    r.confidence,
    r.review_status,
    r.created_at,
    r.updated_at
  FROM memory.reflections r
  JOIN eligible_thread t ON t.id = r.thread_id
  WHERE r.is_active = true
  ORDER BY r.updated_at DESC, r.reflection_key
  LIMIT 5
`;

const RECORD_RETRIEVAL_SQL = `
  WITH eligible_thread AS (${ELIGIBLE_THREAD_CTE})
  INSERT INTO memory.retrieval_events (
    thread_id,
    query_key,
    query_text,
    requested_memory_types,
    retrieved_payload,
    metadata
  )
  SELECT
    id,
    NULL,
    $6,
    $7::jsonb,
    $8::jsonb,
    $9::jsonb
  FROM eligible_thread
`;

function rows(result) {
  return Array.isArray(result?.rows) ? result.rows : [];
}

export function createPublicMemoryRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL pool with a query method is required.');
  }

  return {
    async readiness() {
      const result = await pool.query(READINESS_SQL, publicScopeSqlParameters());
      return Boolean(result.rows[0]?.public_corpus_available);
    },

    async readSnapshot() {
      const parameters = publicScopeSqlParameters();
      const threadResult = await pool.query(THREAD_SQL, parameters);
      const thread = threadResult.rows[0];
      if (!thread) return null;

      const [turns, observations, facts, supersessions, summaries, reflections] =
        await Promise.all([
          pool.query(TURNS_SQL, parameters),
          pool.query(OBSERVATIONS_SQL, parameters),
          pool.query(FACTS_SQL, parameters),
          pool.query(SUPERSESSIONS_SQL, parameters),
          pool.query(SUMMARIES_SQL, parameters),
          pool.query(REFLECTIONS_SQL, parameters),
        ]);

      return {
        thread,
        turns: rows(turns),
        observations: rows(observations),
        facts: rows(facts),
        supersessions: rows(supersessions),
        summaries: rows(summaries),
        reflections: rows(reflections),
      };
    },

    async recordRetrieval(queryText, retrievalSummary) {
      await pool.query(RECORD_RETRIEVAL_SQL, [
        ...publicScopeSqlParameters(),
        queryText,
        JSON.stringify(['facts', 'observations', 'summaries', 'reflections', 'provenance']),
        JSON.stringify(retrievalSummary),
        JSON.stringify({
          surface: 'public_api',
          retrieval_strategy: 'postgres_deterministic_lexical',
          semantic_status: 'unavailable',
        }),
      ]);
    },
  };
}
