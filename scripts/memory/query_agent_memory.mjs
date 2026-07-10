import path from 'node:path';
import { parseJsonArgFile, repoRoot, writeJson } from './_memory_runtime.mjs';
import { queryAgentMemory } from './_memory_ops.mjs';

const requestPath = process.argv[2];
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'memory', `query_agent_memory_${Date.now()}.json`);

if (!requestPath) {
  console.error('Usage: node scripts/memory/query_agent_memory.mjs <query_request.json> [output.json]');
  process.exit(1);
}

const request = await parseJsonArgFile(requestPath);
const result = await queryAgentMemory(request);
await writeJson(outputPath, result);
console.log(`WROTE=${outputPath}`);
