import path from 'node:path';
import { parseJsonArgFile, repoRoot, writeJson } from './_memory_runtime.mjs';
import { enqueueThreadMemoryJobs, importThreadBundlePg, runMemoryJob, syncAgentMemory } from './_memory_ops.mjs';

const bundlePath = process.argv[2];
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'memory', `thread_memory_pipeline_${Date.now()}.json`);

if (!bundlePath) {
  console.error('Usage: node scripts/memory/run_thread_memory_pipeline.mjs <thread_bundle.json> [output.json]');
  process.exit(1);
}

const bundle = await parseJsonArgFile(bundlePath);
const importResult = await importThreadBundlePg(bundle);
const enqueueResult = await enqueueThreadMemoryJobs(bundle.thread.thread_key);
const jobRuns = [];

for (;;) {
  const run = await runMemoryJob('--next');
  if (!run.processed) break;
  jobRuns.push(run);
}

const syncResult = await syncAgentMemory({ threadKey: bundle.thread.thread_key });
const result = {
  source_bundle: bundlePath,
  import_result: importResult,
  enqueue_result: enqueueResult,
  job_runs: jobRuns,
  sync_result: syncResult,
};

await writeJson(outputPath, result);
console.log(`WROTE=${outputPath}`);
