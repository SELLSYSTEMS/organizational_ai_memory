import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  deriveRuntimeBinding,
  publicPlanProjection,
  validateProvisioningPlan,
} from './provisioner-contract.mjs';
import { PERMISSIONS } from './effective-permissions.mjs';
import { wrapOperatorService } from './operator-db-context.mjs';

const OPERATION_JOB_TYPES = Object.freeze({
  provision_agent: 'linux_identity',
  resume_agent: 'runtime_binding',
  verify_agent: 'runtime_binding',
});
const STORAGE_KEY = /^[a-f0-9]{2}\/[a-f0-9]{64}$/;

export class OperatorServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'OperatorServiceError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status) {
  throw new OperatorServiceError(code, message, status);
}

function tokenSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeErrorCode(error) {
  const value = String(error?.code || error?.message || 'provisioning_failed');
  return /^[a-z][a-z0-9_]{2,99}$/.test(value) ? value : 'provisioning_failed';
}

function publicProvisionerResult(result) {
  const record = result?.record || {};
  return {
    replayed: Boolean(result?.replayed),
    record: {
      schema_version: record.schema_version,
      plan_id: record.plan_id,
      plan_hash: record.plan_hash,
      operation: record.operation,
      principal_key: record.principal_key,
      profile_key: record.profile_key,
      policy_hash: record.policy_hash,
      binding: record.binding,
      status: record.status,
      started_at: record.started_at,
      completed_at: record.completed_at,
      error_code: record.error_code || null,
      proof: record.proof || null,
      suspension: record.suspension || null,
      verified: record.verified === true,
      service_inactive: record.service_inactive === true,
      unit_disabled: record.unit_disabled === true,
      processes_absent: record.processes_absent === true,
      account_locked: record.account_locked === true,
      broker_group_removed: record.broker_group_removed === true,
      credentials_absent: record.credentials_absent === true,
    },
  };
}

function isEnforcedSuspensionRecord(record) {
  return record?.status === 'succeeded'
    && record.suspension === 'enforced'
    && record.verified === true
    && record.service_inactive === true
    && record.unit_disabled === true
    && record.processes_absent === true
    && record.account_locked === true
    && record.broker_group_removed === true
    && record.credentials_absent === true;
}

function validateTextDocument(content) {
  const bytes = Buffer.from(content, 'utf8');
  const roundTrip = bytes.toString('utf8');
  if (roundTrip !== content || content.includes('\u0000')) {
    fail('invalid_text_content', 'Upload content must be valid UTF-8 text.');
  }
  if (/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(content)) {
    fail('invalid_text_content', 'Upload content contains unsupported control characters.');
  }
  return bytes;
}

async function readSealedUpload(quarantineRoot, upload, ownerUid) {
  const expectedStorageKey = `${upload.sha256.slice(0, 2)}/${upload.sha256}`;
  if (!STORAGE_KEY.test(upload.storage_key) || upload.storage_key !== expectedStorageKey) {
    fail('sealed_upload_integrity_failed', 'Upload storage does not match its recorded SHA-256.', 409);
  }
  const root = path.resolve(quarantineRoot);
  const target = path.resolve(root, upload.storage_key);
  if (!target.startsWith(`${root}${path.sep}`)) {
    fail('sealed_upload_integrity_failed', 'Upload storage path is outside quarantine.', 409);
  }
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== ownerUid || (stat.mode & 0o777) !== 0o440
        || stat.size !== Number(upload.size_bytes)) {
      fail('sealed_upload_integrity_failed', 'Upload file ownership, mode, link count, or size is invalid.', 409);
    }
    const bytes = await handle.readFile();
    const actualSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actualSha256 !== upload.sha256) {
      fail('sealed_upload_integrity_failed', 'Upload bytes no longer match the recorded SHA-256.', 409);
    }
    const content = bytes.toString('utf8');
    validateTextDocument(content);
    return content;
  } catch (error) {
    if (error instanceof OperatorServiceError) throw error;
    fail('sealed_upload_unavailable', 'The sealed upload could not be opened for extraction.', 409);
  } finally {
    await handle?.close().catch(() => {});
  }
}

function uploadEvidence(content, upload) {
  const excerpt = content.trim().slice(0, 2_000);
  if (!excerpt) fail('sealed_upload_integrity_failed', 'The sealed upload contains no reviewable text.', 409);
  return [{
    evidence_kind: 'upload_text',
    evidence_ref: `sha256:${upload.sha256}`,
    excerpt,
  }];
}

export function createOperatorService({
  identityPlane,
  repository,
  provisionerClient,
  quarantineRoot = '/var/lib/organizational-ai-memory-quarantine',
  ingestionPrincipalKey = 'service:governed_ingestion',
  now = () => new Date(),
  randomUUID = crypto.randomUUID,
  pendingCredentialTtlMs = 30 * 60_000,
  workspaceCredentialTtlMs = 7 * 24 * 60 * 60_000,
  quarantineOwnerUid = 0,
} = {}) {
  if (!identityPlane || !repository || !provisionerClient) {
    throw new TypeError('Identity plane, operator repository, and provisioner client are required.');
  }
  if (!Number.isSafeInteger(quarantineOwnerUid) || quarantineOwnerUid < 0) {
    throw new TypeError('Quarantine owner UID must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(workspaceCredentialTtlMs)
      || workspaceCredentialTtlMs < 60 * 60_000
      || workspaceCredentialTtlMs > 30 * 24 * 60 * 60_000) {
    throw new TypeError('Workspace credential TTL must be between one hour and 30 days.');
  }
  const pendingCredentials = new Map();

  function prunePending() {
    const current = now().valueOf();
    for (const [key, value] of pendingCredentials) {
      if (value.expiresAt <= current) pendingCredentials.delete(key);
    }
  }

  async function requireAccess(actor, permission) {
    const access = await identityPlane.computeEffectiveAccess({
      principalId: actor.principal_id,
      departmentId: actor.department_id,
    });
    if (!access.can(permission)) {
      const assignmentMissing = access.runtime_findings
        .some((finding) => finding.code === 'policy_assignment_missing');
      fail(
        assignmentMissing ? 'policy_assignment_missing' : 'permission_denied',
        assignmentMissing
          ? 'An active policy assignment is required.'
          : `Permission ${permission} is required.`,
        403,
      );
    }
    return access;
  }

  const service = {
    async state(actor) {
      await requireAccess(actor, PERMISSIONS.DEPARTMENT_MEMORY_READ);
      return {
        actor,
        department: {
          id: actor.department_id,
          department_key: actor.department_key,
          display_name: actor.department_name,
        },
        ...(await repository.listState(actor.department_id)),
      };
    },

    async effectiveAccess(actor, principalId, departmentId = actor.department_id) {
      if (departmentId !== actor.department_id) {
        fail('department_scope_denied', 'Session does not authorize this department.', 403);
      }
      await requireAccess(actor, PERMISSIONS.DEPARTMENT_MEMORY_READ);
      const access = await identityPlane.computeEffectiveAccess({ principalId, departmentId });
      return {
        principal_id: access.principal_id,
        evaluated_at: access.evaluated_at,
        permissions: access.permissions,
        explicit_denials: access.explicit_denials,
        runtime_findings: access.runtime_findings,
        policy_assignment_ids: access.policy_assignment_ids,
        policy_template_ids: access.policy_template_ids,
        sponsor_principal_id: access.sponsor_principal_id,
        decisions: access.decisions,
      };
    },

    async onboardEmployee(actor, input) {
      await requireAccess(actor, PERMISSIONS.PROVISIONING_CONFIRM);
      await requireAccess(actor, PERMISSIONS.PROVISIONING_QUEUE);
      const workspaceToken = tokenSecret();
      const humanPrincipalKey = `human:${randomUUID()}`;
      const agentPrincipalKey = `agent:${randomUUID()}`;
      const workspaceExpiresAt = new Date(now().valueOf() + workspaceCredentialTtlMs).toISOString();
      const bundle = await identityPlane.onboardEmployeeBundle({
        humanPrincipalKey,
        displayName: input.display_name,
        workEmail: input.work_email,
        jobTitle: input.job_title,
        agentPrincipalKey,
        agentDisplayName: input.agent_display_name,
        workspaceTokenSha256: tokenHash(workspaceToken),
        workspaceExpiresAt,
      });
      return {
        employee: bundle.employee || bundle.human,
        personal_agent: bundle.personal_agent || bundle.agent,
        pair: bundle.pair,
        workspace: bundle.workspace,
        profile: bundle.profile,
        workspace_access: {
          token: workspaceToken,
          expires_at: workspaceExpiresAt,
          one_time_display: true,
          secret_persisted: false,
        },
      };
    },

    async createHuman(actor, input) {
      await requireAccess(actor, PERMISSIONS.PROVISIONING_CONFIRM);
      return identityPlane.createHuman({
        principalKey: input.principal_key,
        displayName: input.display_name,
        externalIssuer: input.external_issuer,
        externalSubject: input.external_subject,
        departmentId: actor.department_id,
        membershipRole: input.membership_role,
        requestedByPrincipalId: actor.principal_id,
      });
    },

    async createAgent(actor, input) {
      await requireAccess(actor, PERMISSIONS.PROVISIONING_QUEUE);
      const policy = await repository.activeAgentPolicy();
      const token = tokenSecret();
      const principalKey = `agent:${randomUUID()}`;
      const agent = await identityPlane.createLinkedAgentCredentialDraft({
        principalKey,
        displayName: input.display_name,
        ownerPrincipalId: actor.principal_id,
        requestedByPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
        tokenSha256: tokenHash(token),
        policyTemplateKey: policy.template_key,
        policyTemplateVersion: policy.version,
        policyHash: policy.policy_hash,
        metadata: { linked_from: 'architect_console' },
      });
      // The first draft digest proves no raw secret is persisted. Provisioning
      // rotates it and retains the plaintext only in this bounded process map.
      return {
        ...agent,
        broker_credential: {
          id: agent.broker_credential.id,
          policy_template_id: agent.broker_credential.policy_template_id,
          status: agent.broker_credential.status,
          issued_at: agent.broker_credential.issued_at,
          secret_persisted: false,
        },
      };
    },

    async queueProvisioning(actor, input) {
      prunePending();
      await requireAccess(actor, PERMISSIONS.PROVISIONING_QUEUE);
      const operation = input.operation;
      const jobType = OPERATION_JOB_TYPES[operation];
      if (!jobType) fail('invalid_provisioning_operation', 'Provisioning operation is unsupported.');
      const policy = await repository.activeAgentPolicy();
      const context = await repository.provisioningContext({
        principalId: input.principal_id,
        actorPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
      });
      if (operation === 'resume_agent' && context.is_personal_agent) {
        fail(
          'personal_agent_resume_requires_workspace_reissue',
          'Personal Memory Agent resume is unavailable until a new workspace credential can be issued explicitly.',
          409,
        );
      }
      const token = operation === 'provision_agent' || operation === 'resume_agent'
        ? tokenSecret()
        : null;
      if (!token && context.policy_hash !== policy.policy_hash) {
        fail('policy_changed', 'Agent credential does not match the active policy.', 409);
      }
      if (operation === 'provision_agent' && (
        context.status !== 'draft'
        || context.credential_status !== 'draft'
        || context.capability_grant_status !== 'draft'
      )) {
        fail('provisioning_conflict', 'Only a draft agent can be provisioned.', 409);
      }
      if (operation === 'resume_agent' && (
        context.status !== 'suspended'
        || context.credential_status !== 'suspended'
        || context.capability_grant_status !== 'suspended'
      )) {
        fail('provisioning_conflict', 'Only a fully suspended agent can be resumed.', 409);
      }
      if (operation === 'verify_agent' && (
        context.status !== 'active'
        || context.credential_status !== 'active'
        || context.capability_grant_status !== 'active'
      )) {
        fail('verification_conflict', 'Only an active agent can be verified.', 409);
      }
      const planId = randomUUID();
      const basePlan = {
        operation,
        plan_id: planId,
        principal_key: context.principal_key,
        profile_key: 'memory-reuse-agent-v1',
        policy_hash: policy.policy_hash,
      };
      const fullPlan = token ? { ...basePlan, broker_token: token } : basePlan;
      const validated = validateProvisioningPlan(fullPlan);
      const publicPlan = publicPlanProjection(validated.plan);
      const job = token
        ? await repository.queueProvisioningWithCredential({
          principalId: input.principal_id,
          actorPrincipalId: actor.principal_id,
          departmentId: actor.department_id,
          policy,
          tokenSha256: tokenHash(token),
          operation,
          jobType,
          plan: publicPlan,
          idempotencyKey: planId,
        })
        : await identityPlane.queueProvisioningPlan({
          principalId: input.principal_id,
          jobType,
          requestedByPrincipalId: actor.principal_id,
          departmentId: actor.department_id,
          plan: publicPlan,
          idempotencyKey: planId,
        });
      pendingCredentials.set(job.id, {
        fullPlan: validated.plan,
        principalId: input.principal_id,
        departmentId: actor.department_id,
        expiresAt: now().valueOf() + pendingCredentialTtlMs,
      });
      return job;
    },

    async confirmProvisioning(actor, jobId, input) {
      await requireAccess(actor, PERMISSIONS.PROVISIONING_CONFIRM);
      prunePending();
      const pending = pendingCredentials.get(jobId);
      if (!pending) {
        fail(
          'provisioning_secret_unavailable',
          'The in-memory provisioning credential expired; queue a new plan.',
          409,
        );
      }
      if (pending.departmentId !== actor.department_id) {
        fail('department_scope_denied', 'Provisioning plan belongs to another department.', 403);
      }
      const confirmed = await identityPlane.confirmProvisioningPlan({
        jobId,
        expectedRevision: input.expected_revision,
        confirmedByPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
      });
      try {
        if (pending.fullPlan.operation === 'verify_agent') {
          await repository.stageVerification({
            jobId,
            principalId: pending.principalId,
            departmentId: pending.departmentId,
            planId: pending.fullPlan.plan_id,
          });
        } else {
          await repository.stageProvisioning({
            jobId,
            principalId: pending.principalId,
            departmentId: pending.departmentId,
            planId: pending.fullPlan.plan_id,
          });
        }
        const result = await provisionerClient.execute(pending.fullPlan);
        const record = result.record;
        if (record.status !== 'succeeded') {
          const error = new Error(safeErrorCode(record.error_code || 'provisioning_failed'));
          error.status = 422;
          throw error;
        }
        const expectedBinding = deriveRuntimeBinding(pending.fullPlan.principal_key);
        if (JSON.stringify(record.binding) !== JSON.stringify(expectedBinding)) {
          const error = new Error('binding_contract_mismatch');
          error.status = 502;
          throw error;
        }
        const completed = await repository.completeProvisioning({
          jobId,
          principalId: pending.principalId,
          departmentId: pending.departmentId,
          binding: expectedBinding,
          proof: record.proof,
          actorPrincipalId: actor.principal_id,
        });
        pendingCredentials.delete(jobId);
        return { confirmed, completed, provisioner: publicProvisionerResult(result) };
      } catch (error) {
        const code = safeErrorCode(error);
        let hostSuspended = false;
        try {
          const suspensionPlan = validateProvisioningPlan({
            operation: 'suspend_agent',
            plan_id: randomUUID(),
            principal_key: pending.fullPlan.principal_key,
            profile_key: pending.fullPlan.profile_key,
            policy_hash: pending.fullPlan.policy_hash,
          }).plan;
          const suspension = await provisionerClient.execute(suspensionPlan);
          hostSuspended = isEnforcedSuspensionRecord(suspension?.record);
        } catch {
          hostSuspended = false;
        }
        await repository.failProvisioning({
          jobId,
          principalId: pending.principalId,
          departmentId: pending.departmentId,
          actorPrincipalId: actor.principal_id,
          errorCode: code,
        });
        pendingCredentials.delete(jobId);
        if (!hostSuspended) {
          fail(
            'suspension_enforcement_failed',
            'Provisioning became uncertain and host revocation could not be proven.',
            502,
          );
        }
        fail(code, 'Provisioning failed and the staged identity was suspended.', error?.status || 502);
      }
    },

    async recordProof(actor, input) {
      await requireAccess(actor, PERMISSIONS.PROOF_RECORD);
      return identityPlane.recordProofRun({
        proofKey: input.proof_key,
        targetKind: input.target_kind,
        targetKey: input.target_key,
        status: input.status,
        commands: input.commands,
        evidence: input.evidence,
        recordedByPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
      });
    },

    async suspendPrincipal(actor, principalId, input) {
      await requireAccess(actor, PERMISSIONS.PRINCIPAL_SUSPEND);
      const personalPair = await repository.personalPairForPrincipal({
        principalId,
        departmentId: actor.department_id,
      });
      const runtimePrincipalId = personalPair?.human_principal_id === principalId
        ? personalPair.agent_principal_id
        : principalId;
      const context = await repository.provisioningContext({
        principalId: runtimePrincipalId,
        actorPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
      });
      const linkedAgentAlreadySuspended = personalPair?.human_principal_id === principalId
        && personalPair.agent_status === 'suspended';
      const suspendedAgent = linkedAgentAlreadySuspended
        ? {
            id: personalPair.agent_principal_id,
            principal_key: personalPair.agent_principal_key,
            principal_kind: 'agent',
            status: 'suspended',
            suspended_at: personalPair.agent_suspended_at || null,
            already_suspended: true,
          }
        : await identityPlane.suspendPrincipal({
            principalId: runtimePrincipalId,
            suspendedByPrincipalId: actor.principal_id,
            departmentId: actor.department_id,
            reason: input.reason,
          });
      const suspended = runtimePrincipalId === principalId
        ? suspendedAgent
        : await identityPlane.suspendPrincipal({
          principalId,
          suspendedByPrincipalId: actor.principal_id,
          departmentId: actor.department_id,
          reason: input.reason,
        });
      const plan = validateProvisioningPlan({
        operation: 'suspend_agent',
        plan_id: randomUUID(),
        principal_key: context.principal_key,
        profile_key: 'memory-reuse-agent-v1',
        policy_hash: context.policy_hash,
      }).plan;
      try {
        const result = await provisionerClient.execute(plan);
        if (!isEnforcedSuspensionRecord(result.record)) {
          fail('suspension_enforcement_failed', 'Identity was denied but host suspension failed.', 502);
        }
        return {
          principal: suspended,
          personal_agent: personalPair ? suspendedAgent : null,
          enforcement: publicProvisionerResult(result),
        };
      } catch (error) {
        if (error instanceof OperatorServiceError) throw error;
        fail('suspension_enforcement_failed', 'Identity was denied but host suspension failed.', 502);
      }
    },

    async createUpload(actor, input) {
      await requireAccess(actor, PERMISSIONS.QUARANTINE_SUBMIT);
      const ingestion = await repository.resolveIngestionService({
        principalKey: ingestionPrincipalKey,
        departmentId: actor.department_id,
      });
      const bytes = validateTextDocument(input.content);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
      const targetPath = path.join(quarantineRoot, storageKey);
      await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      let createdFile = false;
      try {
        await fs.writeFile(targetPath, bytes, { mode: 0o600, flag: 'wx' });
        createdFile = true;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      let upload;
      try {
        upload = await identityPlane.createQuarantinedUpload({
          uploadKey: `upload:${randomUUID()}`,
          submittedByPrincipalId: actor.principal_id,
          departmentId: actor.department_id,
          originalName: input.original_name,
          storageKey,
          sha256,
          sizeBytes: bytes.length,
          declaredMime: input.media_type,
          metadata: { source: 'architect_console' },
        });
      } catch (error) {
        if (createdFile) await fs.rm(targetPath, { force: true }).catch(() => {});
        throw error;
      }
      let seal;
      try {
        seal = await provisionerClient.seal({ storage_key: storageKey, sha256 });
        if (seal.status !== 'sealed' || seal.sha256 !== sha256 || seal.storage_key !== storageKey
            || seal.owner_enforced !== true || seal.read_only_mode !== '0440') {
          throw new Error('quarantine_seal_contract_mismatch');
        }
      } catch (error) {
        const code = safeErrorCode(error);
        await repository.markUploadQuarantined({
          uploadId: upload.id,
          departmentId: actor.department_id,
          reason: code,
        }).catch(() => {});
        fail('quarantine_seal_failed', 'Upload remains quarantined because sealing failed.', 502);
      }
      return repository.markUploadReady({
        uploadId: upload.id,
        departmentId: actor.department_id,
        sha256,
        scannerPrincipalId: ingestion.principal_id,
        seal: {
          status: seal.status,
          storage_key: seal.storage_key,
          sha256: seal.sha256,
          size_bytes: seal.size_bytes,
          owner_enforced: seal.owner_enforced,
          read_only_mode: seal.read_only_mode,
          sealed_at: seal.sealed_at,
        },
        validation: {
          validator: 'bounded_utf8_text_v1',
          passed: true,
          byte_count: bytes.length,
          media_type: input.media_type,
        },
      });
    },

    async createCandidate(actor, uploadId, input) {
      await requireAccess(actor, PERMISSIONS.QUARANTINE_SUBMIT);
      const upload = await repository.readyUpload({
        uploadId,
        departmentId: actor.department_id,
      });
      const content = await readSealedUpload(quarantineRoot, upload, quarantineOwnerUid);
      const ingestion = await repository.resolveIngestionService({
        principalKey: ingestionPrincipalKey,
        departmentId: actor.department_id,
      });
      const candidate = await identityPlane.createCandidate({
        candidateKey: `candidate:${randomUUID()}`,
        uploadId,
        producedByPrincipalId: ingestion.principal_id,
        submittedByPrincipalId: upload.submitted_by_principal_id,
        departmentId: actor.department_id,
        sourceUploadSha256: upload.sha256,
        candidateType: input.candidate_type,
        title: input.title,
        candidatePayload: input.payload,
        evidence: uploadEvidence(content, upload),
      });
      await identityPlane.appendAudit({
        eventType: 'operator.candidate_created_from_sealed_upload',
        actorPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
        resourceType: 'candidate',
        resourceKey: candidate.candidate_key,
        outcome: 'recorded',
        payload: {
          ingestion_principal_id: ingestion.principal_id,
          submitted_by_principal_id: upload.submitted_by_principal_id,
          upload_id: uploadId,
          source_upload_sha256: upload.sha256,
        },
      });
      return candidate;
    },

    async candidates(actor) {
      await requireAccess(actor, PERMISSIONS.CANDIDATE_REVIEW);
      return { items: await repository.listCandidates(actor.department_id) };
    },

    async reviewCandidate(actor, candidateId, input) {
      await requireAccess(actor, PERMISSIONS.CANDIDATE_REVIEW);
      return identityPlane.reviewCandidate({
        candidateId,
        reviewerPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
        action: input.action,
        reason: input.reason,
        expectedRevision: input.expected_revision,
      });
    },

    async promoteCandidate(actor, candidateId, input) {
      await requireAccess(actor, PERMISSIONS.CANDIDATE_PROMOTE_AS_DRAFT);
      return identityPlane.promoteCandidateAsDraft({
        candidateId,
        architectPrincipalId: actor.principal_id,
        departmentId: actor.department_id,
        expectedRevision: input.expected_revision,
      });
    },

    async audit(actor, filters) {
      await requireAccess(actor, PERMISSIONS.AUDIT_READ);
      return {
        items: await identityPlane.listAudit({
          departmentId: actor.department_id,
          resourceType: filters.resource_type,
          resourceKey: filters.resource_key,
          actorPrincipalId: filters.actor_principal_id,
          limit: filters.limit,
        }),
      };
    },
  };
  return Object.freeze(wrapOperatorService(service));
}
