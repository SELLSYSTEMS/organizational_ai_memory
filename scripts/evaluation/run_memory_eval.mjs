import path from 'node:path';
import { parseJsonArgFile, repoRoot, writeJson } from '../memory/_memory_runtime.mjs';
import { runMemoryEval } from '../memory/_memory_ops.mjs';

const datasetPath = process.argv[2];
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'evaluation', `memory_eval_${Date.now()}.json`);

if (!datasetPath) {
  console.error('Usage: node scripts/evaluation/run_memory_eval.mjs <memory_eval_dataset.json> [output.json]');
  process.exit(1);
}

const dataset = await parseJsonArgFile(datasetPath);
const result = await runMemoryEval(dataset);
await writeJson(outputPath, result);
console.log(`WROTE=${outputPath}`);
