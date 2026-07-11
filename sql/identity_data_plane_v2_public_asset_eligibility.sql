BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational_ai_memory_identity_data_plane_v2'));

DO $migration$
BEGIN
  IF to_regclass('memory.capability_assets') IS NULL
      OR to_regclass('memory.capability_asset_evidence') IS NULL
      OR to_regclass('memory.capability_asset_relations') IS NULL
      OR to_regclass('memory.capability_task_recommendations') IS NULL
      OR to_regclass('oam_public.capability_packs') IS NULL THEN
    RAISE EXCEPTION 'identity data plane v1 and capability memory must exist before v2';
  END IF;
END
$migration$;

SET ROLE oam_public_view_owner;

CREATE OR REPLACE VIEW oam_public.capability_assets
WITH (security_barrier = true)
AS
SELECT asset.*
FROM memory.capability_assets asset
JOIN oam_public.capability_packs pack ON pack.id = asset.pack_id
WHERE asset.review_status = 'approved'
  AND asset.metadata @> '{"public_demo_eligible":true,"publication_decision":"approved_for_public_demo","source_classification":"public_safe"}'::jsonb;

CREATE OR REPLACE VIEW oam_public.capability_asset_evidence
WITH (security_barrier = true)
AS
SELECT evidence.*
FROM memory.capability_asset_evidence evidence
JOIN oam_public.capability_assets asset
  ON asset.pack_id = evidence.pack_id
 AND asset.id = evidence.asset_id
JOIN oam_public.capability_packs pack ON pack.id = evidence.pack_id
JOIN memory.observations observation ON observation.id = evidence.observation_id
JOIN memory.thread_turns turn ON turn.id = evidence.turn_id
WHERE observation.thread_id = pack.evidence_thread_id
  AND turn.thread_id = pack.evidence_thread_id
  AND observation.turn_id = turn.id
  AND observation.is_active = true
  AND observation.observation_kind = 'capability_source_narrative';

CREATE OR REPLACE VIEW oam_public.capability_asset_relations
WITH (security_barrier = true)
AS
SELECT relation.*
FROM memory.capability_asset_relations relation
JOIN oam_public.capability_assets source_asset
  ON source_asset.pack_id = relation.pack_id
 AND source_asset.id = relation.source_asset_id
JOIN oam_public.capability_assets target_asset
  ON target_asset.pack_id = relation.pack_id
 AND target_asset.id = relation.target_asset_id;

CREATE OR REPLACE VIEW oam_public.capability_task_recommendations
WITH (security_barrier = true)
AS
SELECT recommendation.*
FROM memory.capability_task_recommendations recommendation
JOIN oam_public.capability_tasks task
  ON task.pack_id = recommendation.pack_id
 AND task.id = recommendation.task_id
JOIN oam_public.capability_assets asset
  ON asset.pack_id = recommendation.pack_id
 AND asset.id = recommendation.asset_id;

RESET ROLE;

COMMIT;
