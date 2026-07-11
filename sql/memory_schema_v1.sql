CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.threads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    scope_kind text NOT NULL,
    scope_key text,
    source_system text NOT NULL,
    external_thread_ref text,
    title text,
    language_code text,
    status text NOT NULL DEFAULT 'active',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_threads_brand_scope
    ON memory.threads (brand_key, scope_kind, scope_key);

CREATE TABLE IF NOT EXISTS memory.thread_turns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    source_turn_id text NOT NULL,
    actor_role text NOT NULL,
    actor_key text,
    turn_kind text NOT NULL DEFAULT 'message',
    sent_at timestamptz,
    text_raw text NOT NULL DEFAULT '',
    text_normalized text NOT NULL DEFAULT '',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    artifact_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (thread_id, source_turn_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_thread_turns_thread_sent
    ON memory.thread_turns (thread_id, sent_at, created_at);

CREATE INDEX IF NOT EXISTS idx_memory_thread_turns_actor
    ON memory.thread_turns (thread_id, actor_role, actor_key);

CREATE TABLE IF NOT EXISTS memory.thread_checkpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkpoint_key text NOT NULL UNIQUE,
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    latest_turn_id uuid REFERENCES memory.thread_turns(id) ON DELETE SET NULL,
    checkpoint_type text NOT NULL DEFAULT 'running_window',
    window_turn_count integer NOT NULL DEFAULT 0,
    state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_thread_checkpoints_thread_created
    ON memory.thread_checkpoints (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory.thread_summaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_key text NOT NULL UNIQUE,
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    summary_scope text NOT NULL,
    summary_text text NOT NULL,
    turn_count integer NOT NULL DEFAULT 0,
    source_turn_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    quality_label text NOT NULL DEFAULT 'draft',
    review_status text NOT NULL DEFAULT 'auto_curated',
    is_active boolean NOT NULL DEFAULT true,
    summary_hash text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_thread_summaries_thread_scope
    ON memory.thread_summaries (thread_id, summary_scope, is_active);

CREATE TABLE IF NOT EXISTS memory.jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_key text NOT NULL UNIQUE,
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    requested_by text,
    input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_memory_jobs_thread_status
    ON memory.jobs (thread_id, status, created_at);

CREATE TABLE IF NOT EXISTS memory.observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    observation_key text NOT NULL UNIQUE,
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    turn_id uuid REFERENCES memory.thread_turns(id) ON DELETE SET NULL,
    observation_kind text NOT NULL,
    subject_key text,
    actor_key text,
    observed_at timestamptz NOT NULL,
    salience numeric(5,4) NOT NULL DEFAULT 0.5000,
    confidence numeric(5,4) NOT NULL DEFAULT 0.5000,
    observation_text text NOT NULL,
    source_turn_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    review_status text NOT NULL DEFAULT 'auto_curated',
    is_active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_observations_thread_kind
    ON memory.observations (thread_id, observation_kind, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_observations_subject
    ON memory.observations (subject_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS memory.facts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fact_key text NOT NULL UNIQUE,
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    subject_key text NOT NULL,
    predicate text NOT NULL,
    object_value text NOT NULL,
    object_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    confidence numeric(5,4) NOT NULL DEFAULT 0.5000,
    provenance_kind text NOT NULL DEFAULT 'observation_derived',
    source_turn_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_observation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    review_status text NOT NULL DEFAULT 'auto_curated',
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    superseded_by_fact_id uuid REFERENCES memory.facts(id) ON DELETE SET NULL,
    is_current boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_thread_subject_predicate
    ON memory.facts (thread_id, subject_key, predicate, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_facts_current
    ON memory.facts (thread_id, is_current, valid_to);

CREATE TABLE IF NOT EXISTS memory.entities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    entity_type text NOT NULL,
    display_label text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_entities_brand_type
    ON memory.entities (brand_key, entity_type);

CREATE TABLE IF NOT EXISTS memory.entity_relations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    relation_key text NOT NULL UNIQUE,
    thread_id uuid REFERENCES memory.threads(id) ON DELETE CASCADE,
    subject_entity_id uuid NOT NULL REFERENCES memory.entities(id) ON DELETE CASCADE,
    predicate text NOT NULL,
    object_entity_id uuid REFERENCES memory.entities(id) ON DELETE SET NULL,
    object_value text,
    fact_id uuid REFERENCES memory.facts(id) ON DELETE SET NULL,
    confidence numeric(5,4) NOT NULL DEFAULT 0.5000,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_entity_relations_thread_predicate
    ON memory.entity_relations (thread_id, predicate, created_at DESC);

CREATE TABLE IF NOT EXISTS memory.fact_supersessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    previous_fact_id uuid NOT NULL REFERENCES memory.facts(id) ON DELETE CASCADE,
    new_fact_id uuid NOT NULL REFERENCES memory.facts(id) ON DELETE CASCADE,
    reason text NOT NULL,
    source_job_id uuid REFERENCES memory.jobs(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (previous_fact_id, new_fact_id)
);

CREATE TABLE IF NOT EXISTS memory.reflections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reflection_key text NOT NULL UNIQUE,
    thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE CASCADE,
    reflection_scope text NOT NULL,
    reflection_text text NOT NULL,
    supporting_observation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    supporting_fact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    confidence numeric(5,4) NOT NULL DEFAULT 0.5000,
    review_status text NOT NULL DEFAULT 'auto_curated',
    is_active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_reflections_thread_scope
    ON memory.reflections (thread_id, reflection_scope, is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory.procedural_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    thread_id uuid REFERENCES memory.threads(id) ON DELETE SET NULL,
    rule_scope text NOT NULL,
    rule_text text NOT NULL,
    source_reflection_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    review_status text NOT NULL DEFAULT 'draft',
    is_active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_procedural_rules_scope
    ON memory.procedural_rules (brand_key, rule_scope, is_active);

CREATE TABLE IF NOT EXISTS memory.retrieval_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid REFERENCES memory.threads(id) ON DELETE SET NULL,
    query_key text,
    query_text text NOT NULL,
    requested_memory_types jsonb NOT NULL DEFAULT '[]'::jsonb,
    retrieved_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory.write_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id uuid REFERENCES memory.threads(id) ON DELETE SET NULL,
    job_id uuid REFERENCES memory.jobs(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    record_type text NOT NULL,
    record_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_write_events_thread_time
    ON memory.write_events (thread_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory.eval_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    eval_key text NOT NULL UNIQUE,
    thread_id uuid REFERENCES memory.threads(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'pending',
    input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    output_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE OR REPLACE VIEW memory.current_facts AS
SELECT
    f.*
FROM memory.facts f
WHERE f.is_current = true
  AND f.valid_to IS NULL;

CREATE OR REPLACE VIEW memory.agent_memory_source_records AS
SELECT
    'memory.observations'::text AS source_table,
    o.id AS source_record_id,
    o.observation_key AS record_key,
    t.thread_key,
    t.brand_key,
    t.scope_kind,
    t.scope_key AS resource_key,
    t.language_code,
    COALESCE(o.subject_key, t.scope_key, t.thread_key) AS subject_key,
    'observation'::text AS memory_kind,
    o.review_status,
    NULL::timestamptz AS valid_from,
    NULL::timestamptz AS valid_to,
    o.observation_text AS text_body,
    o.metadata || jsonb_build_object(
        'observation_kind', o.observation_kind,
        'actor_key', o.actor_key,
        'confidence', o.confidence,
        'salience', o.salience,
        'source_turn_ids', o.source_turn_ids
    ) AS payload,
    o.created_at
FROM memory.observations o
JOIN memory.threads t ON t.id = o.thread_id
WHERE o.is_active = true

UNION ALL

SELECT
    'memory.facts'::text AS source_table,
    f.id AS source_record_id,
    f.fact_key AS record_key,
    t.thread_key,
    t.brand_key,
    t.scope_kind,
    t.scope_key AS resource_key,
    t.language_code,
    f.subject_key,
    'fact'::text AS memory_kind,
    f.review_status,
    f.valid_from,
    f.valid_to,
    concat(f.predicate, ': ', f.object_value) AS text_body,
    f.metadata || jsonb_build_object(
        'predicate', f.predicate,
        'object_value', f.object_value,
        'object_payload', f.object_payload,
        'confidence', f.confidence,
        'is_current', f.is_current,
        'source_turn_ids', f.source_turn_ids,
        'source_observation_ids', f.source_observation_ids
    ) AS payload,
    f.created_at
FROM memory.facts f
JOIN memory.threads t ON t.id = f.thread_id

UNION ALL

SELECT
    'memory.reflections'::text AS source_table,
    r.id AS source_record_id,
    r.reflection_key AS record_key,
    t.thread_key,
    t.brand_key,
    t.scope_kind,
    t.scope_key AS resource_key,
    t.language_code,
    COALESCE(t.scope_key, t.thread_key) AS subject_key,
    'reflection'::text AS memory_kind,
    r.review_status,
    NULL::timestamptz AS valid_from,
    NULL::timestamptz AS valid_to,
    r.reflection_text AS text_body,
    r.metadata || jsonb_build_object(
        'reflection_scope', r.reflection_scope,
        'confidence', r.confidence,
        'supporting_observation_ids', r.supporting_observation_ids,
        'supporting_fact_ids', r.supporting_fact_ids
    ) AS payload,
    r.created_at
FROM memory.reflections r
JOIN memory.threads t ON t.id = r.thread_id
WHERE r.is_active = true;
