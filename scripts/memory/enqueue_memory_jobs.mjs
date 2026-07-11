import path from 'node:path';
import { repoRoot, writeJson } from './_memory_runtime.mjs';
import { enqueueThreadMemoryJobs } from './_memory_ops.mjs';

const threadKey = process.argv[2];
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'memory', `enqueue_memory_jobs_${Date.now()}.json`);

if (!threadKey) {
  console.error('Usage: node scripts/memory/enqueue_memory_jobs.mjs <thread_key> [output.json]');
  process.exit(1);
}

const result = await enqueueThreadMemoryJobs(threadKey);
await writeJson(outputPath, result);
console.log(`WROTE=${outputPath}`);
