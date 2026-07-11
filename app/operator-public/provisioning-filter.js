const OPEN_PROVISIONING_STATUSES = new Set(['queued', 'confirmed', 'running']);

function requestedAt(job) {
  const value = Date.parse(job?.requested_at || '');
  return Number.isFinite(value) ? value : 0;
}

function isNewerJob(candidate, current) {
  const candidateTime = requestedAt(candidate);
  const currentTime = requestedAt(current);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return String(candidate?.id || '').localeCompare(String(current?.id || '')) > 0;
}

export function isOpenProvisioningJob(job = {}) {
  return OPEN_PROVISIONING_STATUSES.has(job.status);
}

export function currentProvisioningJobIds(jobs = [], operationalPrincipalIds = []) {
  const operational = new Set(operationalPrincipalIds);
  const current = new Set();
  const latestByPrincipal = new Map();

  for (const job of jobs) {
    if (isOpenProvisioningJob(job)) current.add(job.id);
    if (!operational.has(job.principal_id)) continue;
    const latest = latestByPrincipal.get(job.principal_id);
    if (!latest || isNewerJob(job, latest)) latestByPrincipal.set(job.principal_id, job);
  }

  for (const job of latestByPrincipal.values()) current.add(job.id);
  return current;
}

export function filterProvisioningJobs(
  jobs = [],
  operationalPrincipalIds = [],
  filter = 'current',
) {
  if (filter === 'all') return [...jobs];
  if (filter === 'failed') return jobs.filter((job) => job.status === 'failed');
  const currentIds = currentProvisioningJobIds(jobs, operationalPrincipalIds);
  return jobs.filter((job) => currentIds.has(job.id));
}
