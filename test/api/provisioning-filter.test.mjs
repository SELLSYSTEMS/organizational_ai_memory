import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentProvisioningJobIds,
  filterProvisioningJobs,
  isOpenProvisioningJob,
} from '../../app/operator-public/provisioning-filter.js';

const jobs = [
  { id: 'open-fixture', principal_id: 'fixture', status: 'queued', requested_at: '2026-07-11T10:00:00Z' },
  { id: 'latest-operational', principal_id: 'operational', status: 'succeeded', requested_at: '2026-07-11T09:00:00Z' },
  { id: 'failed-historical', principal_id: 'fixture', status: 'failed', requested_at: '2026-07-11T08:00:00Z' },
  { id: 'old-operational', principal_id: 'operational', status: 'succeeded', requested_at: '2026-07-11T07:00:00Z' },
  { id: 'succeeded-fixture', principal_id: 'fixture', status: 'succeeded', requested_at: '2026-07-11T06:00:00Z' },
];

test('current provisioning view keeps open work and only the latest terminal job per operational principal', () => {
  assert.equal(isOpenProvisioningJob(jobs[0]), true);
  assert.equal(isOpenProvisioningJob(jobs[1]), false);
  assert.deepEqual(
    [...currentProvisioningJobIds(jobs, ['operational'])],
    ['open-fixture', 'latest-operational'],
  );
  assert.deepEqual(
    filterProvisioningJobs(jobs, ['operational'], 'current').map((job) => job.id),
    ['open-fixture', 'latest-operational'],
  );
});

test('a latest operational failure remains in the default current view', () => {
  const failedLatest = [
    { id: 'failed-latest', principal_id: 'operational', status: 'failed', requested_at: '2026-07-11T11:00:00Z' },
    ...jobs,
  ];
  assert.deepEqual(
    filterProvisioningJobs(failedLatest, ['operational'], 'current').map((job) => job.id),
    ['failed-latest', 'open-fixture'],
  );
});

test('failure and all-history views preserve historical evidence', () => {
  assert.deepEqual(
    filterProvisioningJobs(jobs, ['operational'], 'failed').map((job) => job.id),
    ['failed-historical'],
  );
  assert.deepEqual(filterProvisioningJobs(jobs, ['operational'], 'all'), jobs);
});

test('unknown filter values fail to the bounded current view', () => {
  assert.deepEqual(
    filterProvisioningJobs(jobs, ['operational'], 'unsupported').map((job) => job.id),
    ['open-fixture', 'latest-operational'],
  );
});
