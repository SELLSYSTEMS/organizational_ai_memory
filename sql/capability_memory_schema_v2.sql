BEGIN;

ALTER TABLE memory.capability_assets
    ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

ALTER TABLE memory.capability_assets
    DROP CONSTRAINT IF EXISTS capability_assets_search_text_check;

ALTER TABLE memory.capability_assets
    ADD CONSTRAINT capability_assets_search_text_check
        CHECK (char_length(search_text) <= 100000);

CREATE INDEX IF NOT EXISTS idx_capability_assets_search
    ON memory.capability_assets
    USING gin (to_tsvector('simple', search_text));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'capability_assets_pack_id_id_version_key'
          AND conrelid = 'memory.capability_assets'::regclass
    ) THEN
        ALTER TABLE memory.capability_assets
            ADD CONSTRAINT capability_assets_pack_id_id_version_key
            UNIQUE (pack_id, id, version);
    END IF;
END
$$;

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

ALTER TABLE memory.capability_asset_versions
    DROP CONSTRAINT IF EXISTS capability_asset_versions_pack_id_asset_id_version_fkey;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'capability_asset_versions_pack_asset_fkey'
          AND conrelid = 'memory.capability_asset_versions'::regclass
    ) THEN
        ALTER TABLE memory.capability_asset_versions
            ADD CONSTRAINT capability_asset_versions_pack_asset_fkey
            FOREIGN KEY (pack_id, asset_id)
            REFERENCES memory.capability_assets(pack_id, id) ON DELETE CASCADE;
    END IF;
END
$$;

ALTER TABLE memory.capability_tasks
    ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT '';

ALTER TABLE memory.capability_tasks
    DROP CONSTRAINT IF EXISTS capability_tasks_search_text_check;

ALTER TABLE memory.capability_tasks
    ADD CONSTRAINT capability_tasks_search_text_check
        CHECK (char_length(search_text) <= 100000);

CREATE INDEX IF NOT EXISTS idx_capability_tasks_search
    ON memory.capability_tasks
    USING gin (to_tsvector('simple', search_text));

COMMIT;
