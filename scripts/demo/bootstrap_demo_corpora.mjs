import path from 'node:path';
import { parseJsonArgFile, repoRoot } from '../memory/_memory_runtime.mjs';
import {
  enqueueThreadMemoryJobs,
  importThreadBundlePg,
  runMemoryJob,
} from '../memory/_memory_ops.mjs';

const seedPaths = [
  path.join(repoRoot, 'config', 'demo', 'public_demo_seed.json'),
  path.join(repoRoot, 'config', 'demo', 'internal_demo_seed.json'),
];

const result = {
  vector_sync: 'skipped_by_design',
  imports: [],
  jobs: [],
};

for (const seedPath of seedPaths) {
  const bundle = await parseJsonArgFile(seedPath);
  const imported = await importThreadBundlePg(bundle);
  const enqueued = await enqueueThreadMemoryJobs(bundle.thread.thread_key, 'demo_bootstrap');
  result.imports.push({ seed_path: seedPath, imported, enqueued });
}

for (;;) {
  const job = await runMemoryJob('--next');
  if (!job.processed) break;
  result.jobs.push(job);
}

console.log(JSON.stringify(result, null, 2));
