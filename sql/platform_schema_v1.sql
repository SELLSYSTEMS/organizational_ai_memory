CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS telegram;
CREATE SCHEMA IF NOT EXISTS judge;
CREATE SCHEMA IF NOT EXISTS content;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS core.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_key text NOT NULL UNIQUE,
    display_name text NOT NULL,
    platform text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.targets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_key text NOT NULL UNIQUE,
    platform text NOT NULL,
    target_type text NOT NULL,
    external_id text NOT NULL,
    handle text,
    title text NOT NULL,
    language_code text,
    brand_key text NOT NULL,
    is_primary_brand_surface boolean NOT NULL DEFAULT false,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_key text NOT NULL UNIQUE,
    artifact_type text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    sha256 text,
    source_system text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram.message_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id uuid NOT NULL REFERENCES core.targets(id) ON DELETE CASCADE,
    external_message_id text NOT NULL,
    message_kind text NOT NULL,
    posted_at timestamptz,
    author_label text,
    text_raw text NOT NULL DEFAULT '',
    text_normalized text NOT NULL DEFAULT '',
    has_media boolean NOT NULL DEFAULT false,
    visible_position integer,
    scan_artifact_id uuid REFERENCES core.artifacts(id) ON DELETE SET NULL,
    screenshot_artifact_id uuid REFERENCES core.artifacts(id) ON DELETE SET NULL,
    artifact_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    media_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    captured_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (target_id, external_message_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_message_snapshots_target_msg
    ON telegram.message_snapshots (target_id, external_message_id DESC);

CREATE TABLE IF NOT EXISTS telegram.cleanup_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_key text NOT NULL UNIQUE,
    target_id uuid NOT NULL REFERENCES core.targets(id) ON DELETE CASCADE,
    operator_account_id uuid REFERENCES core.accounts(id) ON DELETE SET NULL,
    mode text NOT NULL,
    web_variant text NOT NULL,
    profile_key text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL,
    summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS telegram.cleanup_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES telegram.cleanup_runs(id) ON DELETE CASCADE,
    target_id uuid NOT NULL REFERENCES core.targets(id) ON DELETE CASCADE,
    external_message_id text NOT NULL,
    snapshot_id uuid REFERENCES telegram.message_snapshots(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    judge_decision_id uuid,
    action_status text NOT NULL,
    notes text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleanup_events_run_time
    ON telegram.cleanup_events (run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_cleanup_events_target_msg
    ON telegram.cleanup_events (target_id, external_message_id);

CREATE TABLE IF NOT EXISTS judge.rule_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_set_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    version integer NOT NULL,
    status text NOT NULL,
    rules_json jsonb NOT NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS judge.decision_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_card_key text NOT NULL UNIQUE,
    target_id uuid REFERENCES core.targets(id) ON DELETE SET NULL,
    target_key text NOT NULL,
    brand_key text NOT NULL,
    external_message_id text,
    platform text NOT NULL,
    language_code text,
    source_kind text NOT NULL,
    action_label text NOT NULL,
    confidence numeric(5,4) NOT NULL,
    summary_text text NOT NULL,
    full_text_excerpt text NOT NULL,
    normalized_text text NOT NULL,
    reasoning_summary text NOT NULL,
    matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
    human_override boolean NOT NULL DEFAULT false,
    is_gold_example boolean NOT NULL DEFAULT false,
    snapshot_artifact_id uuid REFERENCES core.artifacts(id) ON DELETE SET NULL,
    created_from_run_id uuid REFERENCES telegram.cleanup_runs(id) ON DELETE SET NULL,
    message_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    media_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
    artifact_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decision_cards_action_gold
    ON judge.decision_cards (action_label, is_gold_example);

CREATE INDEX IF NOT EXISTS idx_decision_cards_target_msg
    ON judge.decision_cards (target_id, external_message_id);

CREATE INDEX IF NOT EXISTS idx_decision_cards_matched_rules
    ON judge.decision_cards USING gin (matched_rules jsonb_path_ops);

CREATE TABLE IF NOT EXISTS judge.decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_key text NOT NULL UNIQUE,
    target_id uuid NOT NULL REFERENCES core.targets(id) ON DELETE CASCADE,
    snapshot_id uuid NOT NULL REFERENCES telegram.message_snapshots(id) ON DELETE CASCADE,
    rule_set_id uuid REFERENCES judge.rule_sets(id) ON DELETE SET NULL,
    judge_engine text NOT NULL,
    judge_model text NOT NULL,
    prompt_artifact_id uuid REFERENCES core.artifacts(id) ON DELETE SET NULL,
    response_artifact_id uuid REFERENCES core.artifacts(id) ON DELETE SET NULL,
    action_label text NOT NULL,
    confidence numeric(5,4) NOT NULL,
    summary_reason text NOT NULL,
    matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
    retrieval_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    gate_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisions_target_time
    ON judge.decisions (target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decisions_action_confidence
    ON judge.decisions (action_label, confidence DESC);

ALTER TABLE telegram.cleanup_events
    ADD CONSTRAINT fk_cleanup_events_judge_decision
    FOREIGN KEY (judge_decision_id)
    REFERENCES judge.decisions(id)
    ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS judge.overrides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id uuid NOT NULL REFERENCES judge.decisions(id) ON DELETE CASCADE,
    override_action text NOT NULL,
    override_reason text NOT NULL,
    operator_account_id uuid REFERENCES core.accounts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content.style_guides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    style_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    language_code text NOT NULL,
    channel_type text NOT NULL,
    rules_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content.content_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content_card_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    language_code text NOT NULL,
    surface_type text NOT NULL,
    card_type text NOT NULL,
    title text,
    body_text text NOT NULL,
    normalized_text text NOT NULL,
    quality_label text NOT NULL,
    tags jsonb NOT NULL DEFAULT '[]'::jsonb,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_cards_brand_lang_type
    ON content.content_cards (brand_key, language_code, card_type);

CREATE TABLE IF NOT EXISTS content.generation_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_key text NOT NULL UNIQUE,
    target_id uuid REFERENCES core.targets(id) ON DELETE SET NULL,
    job_type text NOT NULL,
    language_code text NOT NULL,
    status text NOT NULL,
    input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    output_artifact_id uuid REFERENCES core.artifacts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS content.generated_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES content.generation_jobs(id) ON DELETE CASCADE,
    candidate_rank integer NOT NULL,
    candidate_type text NOT NULL,
    body_text text NOT NULL,
    score_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    accepted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, candidate_rank)
);

CREATE TABLE IF NOT EXISTS ops.embedding_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_key text NOT NULL UNIQUE,
    source_table text NOT NULL,
    source_record_id uuid NOT NULL,
    embedding_profile text NOT NULL,
    status text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS ops.qdrant_sync_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_name text NOT NULL,
    source_table text NOT NULL,
    source_record_id uuid NOT NULL,
    point_id text NOT NULL,
    embedding_profile text NOT NULL,
    content_hash text NOT NULL,
    last_synced_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (collection_name, source_table, source_record_id, embedding_profile)
);
