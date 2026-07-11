\set ON_ERROR_STOP on

-- Compatibility check only. Policy assignments, explicit denials, immutable
-- template triggers, RLS, and runtime grants are authoritative in
-- identity_data_plane_v1.sql so a clean install has one atomic migration.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-policy-plane:v1'));

DO $check$
BEGIN
    IF to_regclass('identity.policy_assignments') IS NULL
       OR to_regclass('identity.explicit_permission_denials') IS NULL THEN
        RAISE EXCEPTION
            'identity_data_plane_v1.sql must be applied before the policy compatibility check';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'identity.policy_templates'::regclass
          AND tgname = 'policy_template_immutability_trigger'
          AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'identity.policy_template_rules'::regclass
          AND tgname = 'policy_rule_immutability_trigger'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'identity policy immutability triggers are missing';
    END IF;
    IF NOT (
        SELECT relrowsecurity AND relforcerowsecurity
        FROM pg_class
        WHERE oid = 'identity.policy_assignments'::regclass
    ) OR NOT (
        SELECT relrowsecurity AND relforcerowsecurity
        FROM pg_class
        WHERE oid = 'identity.explicit_permission_denials'::regclass
    ) THEN
        RAISE EXCEPTION 'identity policy tables must use forced row-level security';
    END IF;
END
$check$;

COMMIT;
