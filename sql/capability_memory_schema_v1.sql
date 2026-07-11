CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.capability_packs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    evidence_thread_id uuid NOT NULL REFERENCES memory.threads(id) ON DELETE RESTRICT,
    pack_key text NOT NULL UNIQUE,
    brand_key text NOT NULL,
    corpus text NOT NULL,
    source_classification text NOT NULL,
    publication_status text NOT NULL DEFAULT 'active',
    generated_at timestamptz NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (evidence_thread_id),
    CONSTRAINT capability_packs_classification_check
        CHECK (source_classification IN ('public_safe', 'internal', 'restricted')),
    CONSTRAINT capability_packs_status_check
        CHECK (publication_status IN ('active', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_capability_packs_public_scope
    ON memory.capability_packs (
        pack_key,
        brand_key,
        corpus,
        source_classification,
        publication_status
    );

CREATE TABLE IF NOT EXISTS memory.capability_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    asset_key text NOT NULL,
    asset_type text NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    capability_area text NOT NULL,
    problem_solved text NOT NULL,
    why_it_worked text NOT NULL,
    owner_role text NOT NULL,
    consumer_roles text[] NOT NULL DEFAULT ARRAY[]::text[],
    visibility text NOT NULL,
    review_status text NOT NULL,
    version text NOT NULL,
    supersedes_asset_key text,
    superseded_by_asset_key text,
    last_validated_at date NOT NULL,
    risk_note text,
    used_successfully_in text[] NOT NULL DEFAULT ARRAY[]::text[],
    search_text text NOT NULL DEFAULT '',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pack_id, asset_key),
    UNIQUE (pack_id, id),
    UNIQUE (pack_id, id, version),
    CONSTRAINT capability_assets_type_check
        CHECK (asset_type IN ('prompt', 'workflow', 'agent', 'decision_pattern', 'best_practice')),
    CONSTRAINT capability_assets_review_status_check
        CHECK (review_status IN ('draft', 'reviewed', 'approved', 'deprecated')),
    CONSTRAINT capability_assets_consumer_roles_check
        CHECK (cardinality(consumer_roles) BETWEEN 1 AND 32),
    CONSTRAINT capability_assets_usage_refs_check
        CHECK (cardinality(used_successfully_in) <= 64),
    CONSTRAINT capability_assets_search_text_check
        CHECK (char_length(search_text) <= 100000)
);

-- Upgrade an existing v1 table before indexes or v2 readers reference the
-- deterministic search projection.
ALTER TABLE memory.capability_assets
    ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_capability_assets_pack_type
    ON memory.capability_assets (pack_id, asset_type, asset_key);

CREATE INDEX IF NOT EXISTS idx_capability_assets_pack_area
    ON memory.capability_assets (pack_id, capability_area, asset_key);

CREATE INDEX IF NOT EXISTS idx_capability_assets_pack_review
    ON memory.capability_assets (pack_id, review_status, asset_key);

CREATE INDEX IF NOT EXISTS idx_capability_assets_search
    ON memory.capability_assets
    USING gin (to_tsvector('simple', search_text));

CREATE TABLE IF NOT EXISTS memory.capability_asset_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL,
    asset_family_key text NOT NULL,
    version text NOT NULL,
    content_schema_version smallint NOT NULL,
    content_type text NOT NULL DEFAULT 'application/json',
    change_summary text NOT NULL,
    body jsonb NOT NULL,
    body_text text NOT NULL,
    content_sha256 text NOT NULL,
    is_current boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pack_id, asset_family_key, version),
    CONSTRAINT capability_asset_versions_pack_asset_fkey
        FOREIGN KEY (pack_id, asset_id)
        REFERENCES memory.capability_assets(pack_id, id) ON DELETE CASCADE,
    CONSTRAINT capability_asset_versions_family_key_check
        CHECK (asset_family_key ~ '^(prompt|workflow|agent|decision|practice):[a-z0-9][a-z0-9_]*$'),
    CONSTRAINT capability_asset_versions_version_check
        CHECK (version ~ '^\d+\.\d+(\.\d+)?$'),
    CONSTRAINT capability_asset_versions_schema_check
        CHECK (content_schema_version BETWEEN 1 AND 100),
    CONSTRAINT capability_asset_versions_content_type_check
        CHECK (content_type = 'application/json'),
    CONSTRAINT capability_asset_versions_change_summary_check
        CHECK (char_length(change_summary) BETWEEN 1 AND 2000),
    CONSTRAINT capability_asset_versions_body_check
        CHECK (jsonb_typeof(body) = 'object'),
    CONSTRAINT capability_asset_versions_body_text_check
        CHECK (char_length(body_text) BETWEEN 1 AND 100000),
    CONSTRAINT capability_asset_versions_hash_check
        CHECK (content_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_capability_asset_versions_current
    ON memory.capability_asset_versions (pack_id, asset_family_key)
    WHERE is_current = true;

CREATE INDEX IF NOT EXISTS idx_capability_asset_versions_asset
    ON memory.capability_asset_versions (pack_id, asset_id);

CREATE INDEX IF NOT EXISTS idx_capability_asset_versions_search
    ON memory.capability_asset_versions
    USING gin (to_tsvector('simple', body_text));

CREATE TABLE IF NOT EXISTS memory.capability_asset_evidence (
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL,
    observation_id uuid NOT NULL REFERENCES memory.observations(id) ON DELETE RESTRICT,
    turn_id uuid NOT NULL REFERENCES memory.thread_turns(id) ON DELETE RESTRICT,
    evidence_role text NOT NULL DEFAULT 'source_narrative',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (asset_id, observation_id),
    UNIQUE (asset_id, turn_id),
    FOREIGN KEY (pack_id, asset_id)
        REFERENCES memory.capability_assets(pack_id, id) ON DELETE CASCADE,
    CONSTRAINT capability_asset_evidence_role_check
        CHECK (evidence_role IN ('source_narrative', 'corroborating_narrative'))
);

CREATE INDEX IF NOT EXISTS idx_capability_asset_evidence_pack_asset
    ON memory.capability_asset_evidence (pack_id, asset_id);

CREATE TABLE IF NOT EXISTS memory.capability_asset_relations (
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    source_asset_id uuid NOT NULL,
    target_asset_id uuid NOT NULL,
    relation_kind text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source_asset_id, target_asset_id, relation_kind),
    FOREIGN KEY (pack_id, source_asset_id)
        REFERENCES memory.capability_assets(pack_id, id) ON DELETE CASCADE,
    FOREIGN KEY (pack_id, target_asset_id)
        REFERENCES memory.capability_assets(pack_id, id) ON DELETE CASCADE,
    CONSTRAINT capability_asset_relations_kind_check
        CHECK (relation_kind IN ('linked_evidence')),
    CONSTRAINT capability_asset_relations_distinct_check
        CHECK (source_asset_id <> target_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_capability_asset_relations_pack_source
    ON memory.capability_asset_relations (pack_id, source_asset_id);

CREATE TABLE IF NOT EXISTS memory.capability_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    task_key text NOT NULL,
    task_title text NOT NULL,
    reason text NOT NULL,
    sort_order smallint NOT NULL DEFAULT 0,
    search_text text NOT NULL DEFAULT '',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pack_id, task_key),
    UNIQUE (pack_id, id),
    CONSTRAINT capability_tasks_sort_order_check
        CHECK (sort_order BETWEEN 0 AND 32767),
    CONSTRAINT capability_tasks_search_text_check
        CHECK (char_length(search_text) <= 100000)
);

ALTER TABLE memory.capability_tasks
    ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_capability_tasks_pack_order
    ON memory.capability_tasks (pack_id, sort_order, task_key);

CREATE INDEX IF NOT EXISTS idx_capability_tasks_search
    ON memory.capability_tasks
    USING gin (to_tsvector('simple', search_text));

CREATE TABLE IF NOT EXISTS memory.capability_task_recommendations (
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    recommendation_rank smallint NOT NULL,
    recommendation_reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, asset_id),
    UNIQUE (task_id, recommendation_rank),
    FOREIGN KEY (pack_id, task_id)
        REFERENCES memory.capability_tasks(pack_id, id) ON DELETE CASCADE,
    FOREIGN KEY (pack_id, asset_id)
        REFERENCES memory.capability_assets(pack_id, id) ON DELETE CASCADE,
    CONSTRAINT capability_task_recommendations_rank_check
        CHECK (recommendation_rank BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_capability_task_recommendations_pack_task
    ON memory.capability_task_recommendations (pack_id, task_id, recommendation_rank);

CREATE TABLE IF NOT EXISTS memory.capability_analytics_signals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id uuid NOT NULL REFERENCES memory.capability_packs(id) ON DELETE CASCADE,
    signal_type text NOT NULL,
    signal_key text NOT NULL,
    title text,
    signal text NOT NULL,
    asset_keys text[] NOT NULL DEFAULT ARRAY[]::text[],
    sort_order smallint NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pack_id, signal_type, signal_key),
    CONSTRAINT capability_analytics_signals_type_check
        CHECK (signal_type IN ('duplicated_pattern', 'missing_capability')),
    CONSTRAINT capability_analytics_signals_sort_order_check
        CHECK (sort_order BETWEEN 0 AND 32767),
    CONSTRAINT capability_analytics_signals_asset_keys_check
        CHECK (cardinality(asset_keys) <= 100)
);

CREATE INDEX IF NOT EXISTS idx_capability_analytics_signals_pack_type
    ON memory.capability_analytics_signals (pack_id, signal_type, sort_order, signal_key);
