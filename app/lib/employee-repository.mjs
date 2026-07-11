const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HUMAN_KEY = /^human:[a-z0-9][a-z0-9_.-]{1,118}$/;
const AGENT_KEY = /^agent:[a-z0-9][a-z0-9_.-]{1,118}$/;
const DEPARTMENT_KEY = /^[a-z][a-z0-9_]{1,79}$/;

export class EmployeeRepositoryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'EmployeeRepositoryError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new EmployeeRepositoryError(code, message, status);
}

function requirePool(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }
}

function document(result) {
  const value = result?.rows?.[0]?.data;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(
      'employee_service_unavailable',
      'The employee workspace is temporarily unavailable.',
      503,
    );
  }
  return value;
}

function actor(row) {
  if (!row
      || !UUID.test(row.principal_id || '')
      || !HUMAN_KEY.test(row.principal_key || '')
      || !UUID.test(row.department_id || '')
      || !DEPARTMENT_KEY.test(row.department_key || '')
      || !UUID.test(row.agent_id || '')
      || !AGENT_KEY.test(row.agent_key || '')) {
    fail('authentication_failed', 'Authentication failed.', 401);
  }
  return Object.freeze({
    principal_id: row.principal_id,
    principal_key: row.principal_key,
    display_name: row.display_name,
    membership_role: row.membership_role,
    department_id: row.department_id,
    department_key: row.department_key,
    department_name: row.department_name,
    agent_id: row.agent_id,
    agent_key: row.agent_key,
    agent_display_name: row.agent_display_name,
  });
}

export function createEmployeeRepository(pool) {
  requirePool(pool);

  return Object.freeze({
    async readiness() {
      const result = await pool.query(
        `/* employee:readiness */
         WITH required(signature) AS (
           VALUES
             ('identity.resolve_employee_workspace_token(text)'),
             ('identity.establish_employee_context(text)'),
             ('identity.current_employee_principal_id()'),
             ('identity.current_employee_department_id()'),
             ('identity.current_employee_agent_id()'),
             ('personal.employee_workspace()'),
             ('personal.update_employee_profile(bigint,text,text,jsonb,text,jsonb,text)'),
             ('personal.share_employee_profile(bigint)'),
             ('personal.unshare_employee_profile(bigint)'),
             ('personal.create_employee_memory(text,text,text,text,text,jsonb,text[],text)'),
             ('personal.update_employee_memory(uuid,bigint,text,text,text,text,text,jsonb,text[],text)'),
             ('personal.share_employee_memory(uuid,bigint)'),
             ('personal.unshare_employee_memory(uuid,bigint)'),
             ('personal.employee_agent_context(text,integer)')
         ), resolved AS (
           SELECT to_regprocedure(signature) AS function_oid FROM required
         )
         SELECT count(function_oid) = 14
            AND bool_and(coalesce(
              has_function_privilege(current_user, function_oid, 'EXECUTE'), false
            )) AS ready
         FROM resolved`,
      );
      return result.rows[0]?.ready === true;
    },

    async resolveWorkspaceToken(tokenSha256) {
      if (!SHA256.test(tokenSha256 || '')) fail('authentication_failed', 'Authentication failed.', 401);
      const result = await pool.query(
        `/* employee:resolve-workspace-token */
         SELECT * FROM identity.resolve_employee_workspace_token($1::text)`,
        [tokenSha256],
      );
      return actor(result.rows[0]);
    },

    async currentContext() {
      const result = await pool.query(
        `/* employee:current-context */
         SELECT identity.current_employee_principal_id() AS principal_id,
                identity.current_employee_department_id() AS department_id,
                identity.current_employee_agent_id() AS agent_id`,
      );
      const row = result.rows[0];
      if (!row
          || !UUID.test(row.principal_id || '')
          || !UUID.test(row.department_id || '')
          || !UUID.test(row.agent_id || '')) {
        fail('authentication_failed', 'Authentication is required.', 401);
      }
      return Object.freeze({
        principal_id: row.principal_id,
        department_id: row.department_id,
        agent_id: row.agent_id,
      });
    },

    async workspace() {
      return document(await pool.query(
        `/* employee:workspace */
         SELECT personal.employee_workspace() AS data`,
      ));
    },

    async updateProfile(input) {
      return document(await pool.query(
        `/* employee:update-profile */
         SELECT personal.update_employee_profile(
           $1::bigint, $2::text, $3::text, $4::jsonb, $5::text, $6::jsonb, $7::text
         ) AS data`,
        [
          input.expected_revision,
          input.job_title,
          input.role_summary,
          JSON.stringify(input.expertise),
          input.working_style,
          JSON.stringify(input.current_goals),
          input.boundaries,
        ],
      ));
    },

    async shareProfile(expectedRevision) {
      return document(await pool.query(
        `/* employee:share-profile */
         SELECT personal.share_employee_profile($1::bigint) AS data`,
        [expectedRevision],
      ));
    },

    async unshareProfile(expectedRevision) {
      return document(await pool.query(
        `/* employee:unshare-profile */
         SELECT personal.unshare_employee_profile($1::bigint) AS data`,
        [expectedRevision],
      ));
    },

    async createMemory(input) {
      return document(await pool.query(
        `/* employee:create-memory */
         SELECT personal.create_employee_memory(
           $1::text, $2::text, $3::text, $4::text, $5::text, $6::jsonb, $7::text[], $8::text
         ) AS data`,
        [
          input.type,
          input.title,
          input.content,
          input.context,
          input.why_it_worked,
          JSON.stringify(input.evidence),
          input.tags,
          input.sensitivity,
        ],
      ));
    },

    async updateMemory(memoryId, input) {
      return document(await pool.query(
        `/* employee:update-memory */
         SELECT personal.update_employee_memory(
           $1::uuid, $2::bigint, $3::text, $4::text, $5::text, $6::text,
           $7::text, $8::jsonb, $9::text[], $10::text
         ) AS data`,
        [
          memoryId,
          input.expected_revision,
          input.type,
          input.title,
          input.content,
          input.context,
          input.why_it_worked,
          JSON.stringify(input.evidence),
          input.tags,
          input.sensitivity,
        ],
      ));
    },

    async shareMemory(memoryId, expectedRevision) {
      return document(await pool.query(
        `/* employee:share-memory */
         SELECT personal.share_employee_memory($1::uuid, $2::bigint) AS data`,
        [memoryId, expectedRevision],
      ));
    },

    async unshareMemory(memoryId, expectedRevision) {
      return document(await pool.query(
        `/* employee:unshare-memory */
         SELECT personal.unshare_employee_memory($1::uuid, $2::bigint) AS data`,
        [memoryId, expectedRevision],
      ));
    },

    async agentContext(query, limit = 10) {
      return document(await pool.query(
        `/* employee:agent-context */
         SELECT personal.employee_agent_context($1::text, $2::integer) AS data`,
        [query, limit],
      ));
    },
  });
}
