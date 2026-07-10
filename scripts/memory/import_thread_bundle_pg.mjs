import path from 'node:path';
import { parseJsonArgFile, repoRoot, writeJson } from './_memory_runtime.mjs';
import { importThreadBundlePg } from './_memory_ops.mjs';

const bundlePath = process.argv[2];
const outputPath = process.argv[3] || path.join(repoRoot, 'artifacts', 'memory', `import_thread_bundle_${Date.now()}.json`);

if (!bundlePath) {
  console.error('Usage: node scripts/memory/import_thread_bundle_pg.mjs <thread_bundle.json> [output.json]');
  process.exit(1);
}

const bundle = await parseJsonArgFile(bundlePath);
const result = await importThreadBundlePg(bundle);
await writeJson(outputPath, {
  source_bundle: bundlePath,
  ...result,
});
console.log(`WROTE=${outputPath}`);
