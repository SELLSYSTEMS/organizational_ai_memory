\set ON_ERROR_STOP on

-- Public-safe Build Week identity and policy seed. Apply after
-- identity_data_plane_v1.sql. No bearer secret is stored here.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('organizational-ai-memory:identity-demo-seed:v1'));

SET LOCAL ROLE oam_security_owner;

INSERT INTO identity.departments (department_key, display_name, status, metadata)
VALUES (
    'digital_delivery',
    'Digital Delivery',
    'active',
    '{"purpose":"public-safe Build Week proof"}'::jsonb
)
ON CONFLICT (department_key) DO NOTHING;

INSERT INTO identity.principals (
    principal_key,
    principal_kind,
    display_name,
    external_issuer,
    external_subject,
    status,
    metadata
)
VALUES
    (
        'human:ai_architect',
        'human',
        'AI Architect',
        'urn:oam:operator-seed',
        'ai-architect',
        'active',
        '{"seeded_role":"architect"}'::jsonb
    ),
    (
        'human:capability_reviewer',
        'human',
        'Capability Reviewer',
        'urn:oam:operator-seed',
        'capability-reviewer',
        'active',
        '{"seeded_role":"reviewer"}'::jsonb
    ),
    (
        'service:governed_ingestion',
        'service',
        'Governed Ingestion Service',
        NULL,
        NULL,
        'active',
        '{"execution_boundary":"operator_broker"}'::jsonb
    )
ON CONFLICT (principal_key) DO NOTHING;

INSERT INTO identity.department_memberships (
    principal_id,
    department_id,
    membership_role,
    status,
    approved_by_principal_id
)
SELECT
    principal.id,
    department.id,
    seeded.membership_role,
    'active',
    architect.id
FROM (VALUES
    ('human:ai_architect', 'architect'),
    ('human:capability_reviewer', 'reviewer'),
    ('service:governed_ingestion', 'member')
) AS seeded(principal_key, membership_role)
JOIN identity.principals principal ON principal.principal_key = seeded.principal_key
JOIN identity.departments department ON department.department_key = 'digital_delivery'
JOIN identity.principals architect ON architect.principal_key = 'human:ai_architect'
ON CONFLICT (principal_id, department_id, membership_role) DO NOTHING;

INSERT INTO identity.policy_templates (
    template_key,
    version,
    title,
    description,
    status,
    created_by_principal_id
)
SELECT
    seeded.template_key,
    1,
    seeded.title,
    seeded.description,
    'draft',
    architect.id
FROM (VALUES
    (
        'member',
        'Department member',
        'Logical human access for department memory, quarantine submission, and linked-agent requests.'
    ),
    (
        'reviewer',
        'Independent capability reviewer',
        'Human-only review and proof authority without architect promotion or provisioning confirmation.'
    ),
    (
        'architect',
        'AI Architect',
        'Human-only confirmation, suspension, draft promotion, and audit authority.'
    ),
    (
        'memory_reuse_agent',
        'Memory reuse agent',
        'Broker-only agent access to one approved capability task with sponsor intersection.'
    ),
    (
        'governed_ingestion',
        'Governed ingestion service',
        'Service-only candidate extraction from immutable quarantine content.'
    )
) AS seeded(template_key, title, description)
JOIN identity.principals architect ON architect.principal_key = 'human:ai_architect'
ON CONFLICT (template_key, version) DO NOTHING;

WITH seeded_rules(template_key, principal_kind, membership_role, permission_key, effect, sort_order) AS (
    VALUES
        ('member', 'human', 'member', 'memory.public.read', 'allow', 10),
        ('member', 'human', 'member', 'memory.department.read', 'allow', 20),
        ('member', 'human', 'member', 'quarantine.submit', 'allow', 30),
        ('member', 'human', 'member', 'provisioning.queue', 'allow', 40),
        ('member', 'human', 'member', 'audit.append', 'allow', 50),
        ('member', 'human', 'member', 'memory.canonical.write', 'deny', 900),

        ('reviewer', 'human', 'reviewer', 'memory.public.read', 'allow', 10),
        ('reviewer', 'human', 'reviewer', 'memory.department.read', 'allow', 20),
        ('reviewer', 'human', 'reviewer', 'quarantine.submit', 'allow', 30),
        ('reviewer', 'human', 'reviewer', 'candidate.review', 'allow', 40),
        ('reviewer', 'human', 'reviewer', 'proof.record', 'allow', 50),
        ('reviewer', 'human', 'reviewer', 'audit.append', 'allow', 60),
        ('reviewer', 'human', 'reviewer', 'memory.canonical.write', 'deny', 900),

        ('architect', 'human', 'architect', 'memory.public.read', 'allow', 10),
        ('architect', 'human', 'architect', 'memory.department.read', 'allow', 20),
        ('architect', 'human', 'architect', 'quarantine.submit', 'allow', 30),
        ('architect', 'human', 'architect', 'candidate.review', 'allow', 40),
        ('architect', 'human', 'architect', 'candidate.create', 'allow', 45),
        ('architect', 'human', 'architect', 'candidate.promote_as_draft', 'allow', 50),
        ('architect', 'human', 'architect', 'provisioning.queue', 'allow', 60),
        ('architect', 'human', 'architect', 'provisioning.confirm', 'allow', 70),
        ('architect', 'human', 'architect', 'proof.record', 'allow', 80),
        ('architect', 'human', 'architect', 'principal.suspend', 'allow', 90),
        ('architect', 'human', 'architect', 'audit.append', 'allow', 100),
        ('architect', 'human', 'architect', 'audit.read', 'allow', 110),
        ('architect', 'human', 'architect', 'memory.canonical.write', 'deny', 900),

        ('memory_reuse_agent', 'agent', 'member', 'memory.public.read', 'allow', 10),
        ('memory_reuse_agent', 'agent', 'member', 'memory.department.read', 'allow', 20),
        ('memory_reuse_agent', 'agent', 'member', 'quarantine.submit', 'allow', 30),
        ('memory_reuse_agent', 'agent', 'member', 'candidate.create', 'allow', 40),
        ('memory_reuse_agent', 'agent', 'member', 'audit.append', 'allow', 50),
        ('memory_reuse_agent', 'agent', 'member', 'memory.canonical.write', 'deny', 900),

        ('governed_ingestion', 'service', 'member', 'memory.public.read', 'allow', 10),
        ('governed_ingestion', 'service', 'member', 'memory.department.read', 'allow', 20),
        ('governed_ingestion', 'service', 'member', 'candidate.create', 'allow', 30),
        ('governed_ingestion', 'service', 'member', 'proof.record', 'allow', 40),
        ('governed_ingestion', 'service', 'member', 'audit.append', 'allow', 50),
        ('governed_ingestion', 'service', 'member', 'memory.canonical.write', 'deny', 900)
)
INSERT INTO identity.policy_template_rules (
    template_id,
    principal_kind,
    membership_role,
    permission_key,
    effect,
    conditions,
    sort_order
)
SELECT
    template.id,
    seeded_rules.principal_kind,
    seeded_rules.membership_role,
    seeded_rules.permission_key,
    seeded_rules.effect,
    '{}'::jsonb,
    seeded_rules.sort_order
FROM seeded_rules
JOIN identity.policy_templates template
  ON template.template_key = seeded_rules.template_key
 AND template.version = 1
 AND template.status = 'draft'
ON CONFLICT (template_id, principal_kind, membership_role, permission_key) DO NOTHING;

UPDATE identity.policy_templates
SET status = 'active', activated_at = now()
WHERE version = 1
  AND status = 'draft'
  AND template_key IN ('member', 'reviewer', 'architect', 'memory_reuse_agent', 'governed_ingestion');

-- Seeding is an installer-owned operation. Runtime operators require a
-- database-bound human context and must not be impersonated by this script.

INSERT INTO identity.policy_assignments (
    assignment_key,
    assignment_scope,
    principal_id,
    department_id,
    template_id,
    status,
    assigned_by_principal_id,
    reason
)
SELECT
    seeded.assignment_key,
    'principal',
    principal.id,
    department.id,
    template.id,
    'active',
    architect.id,
    'Build Week public-safe demo role assignment'
FROM (VALUES
    ('assignment:10000000-0000-4000-8000-000000000001', 'human:ai_architect', 'architect'),
    ('assignment:10000000-0000-4000-8000-000000000002', 'human:capability_reviewer', 'reviewer'),
    ('assignment:10000000-0000-4000-8000-000000000003', 'service:governed_ingestion', 'governed_ingestion')
) AS seeded(assignment_key, principal_key, template_key)
JOIN identity.principals principal ON principal.principal_key = seeded.principal_key
JOIN identity.departments department ON department.department_key = 'digital_delivery'
JOIN identity.policy_templates template
  ON template.template_key = seeded.template_key
 AND template.version = 1
 AND template.status = 'active'
JOIN identity.principals architect ON architect.principal_key = 'human:ai_architect'
ON CONFLICT (assignment_scope, principal_id, department_id, template_id) DO NOTHING;

INSERT INTO identity.runtime_bindings (
    principal_id,
    binding_kind,
    binding_value,
    access_mode,
    status,
    metadata
)
SELECT
    principal.id,
    'broker_client',
    'broker:governed-ingestion',
    'brokered',
    'active',
    '{"broker":"operator_ingestion_boundary"}'::jsonb
FROM identity.principals principal
WHERE principal.principal_key = 'service:governed_ingestion'
ON CONFLICT DO NOTHING;

DO $verify$
DECLARE
    active_template_count integer;
    active_assignment_count integer;
    active_principal_count integer;
BEGIN
    SELECT count(*) INTO active_template_count
    FROM identity.policy_templates
    WHERE version = 1
      AND status = 'active'
      AND template_key IN ('member', 'reviewer', 'architect', 'memory_reuse_agent', 'governed_ingestion');
    SELECT count(*) INTO active_assignment_count
    FROM identity.policy_assignments assignment
    JOIN identity.departments department ON department.id = assignment.department_id
    WHERE department.department_key = 'digital_delivery'
      AND assignment.status = 'active';
    SELECT count(*) INTO active_principal_count
    FROM identity.principals
    WHERE status = 'active'
      AND principal_key IN (
          'human:ai_architect',
          'human:capability_reviewer',
          'service:governed_ingestion'
      );
    IF active_template_count <> 5
       OR active_assignment_count < 3
       OR active_principal_count <> 3 THEN
        RAISE EXCEPTION 'identity demo seed verification failed';
    END IF;
END
$verify$;

RESET ROLE;

COMMIT;
