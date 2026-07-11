import path from 'node:path';
import { repoRoot, writeJson } from './_memory_runtime.mjs';
import { syncAgentMemory } from './_memory_ops.mjs';

const threadKey = process.argv[2] && process.argv[2] !== '--all' ? process.argv[2] : null;
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'memory', `sync_agent_memory_${Date.now()}.json`);

const result = await syncAgentMemory({ threadKey });
await writeJson(outputPath, result);
console.log(`WROTE=${outputPath}`);
