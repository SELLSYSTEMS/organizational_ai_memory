import path from 'node:path';
import { repoRoot, writeJson } from './_memory_runtime.mjs';
import { runMemoryJob } from './_memory_ops.mjs';

const selection = process.argv[2] || '--next';
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'memory', `run_memory_job_${Date.now()}.json`);

const result = await runMemoryJob(selection);
await writeJson(outputPath, result);
console.log(`WROTE=${outputPath}`);
