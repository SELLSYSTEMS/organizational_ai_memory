import fs from 'node:fs/promises';
import path from 'node:path';
import { stitch } from '@google/stitch-sdk';

const outputRoot = path.resolve(process.argv[2] || 'artifacts/design/stitch');

const screens = [
  {
    key: 'home-demo',
    device: 'DESKTOP',
    prompt: `
Create a desktop product screen for Organizational AI Memory, a
provenance-first organizational continuity product. Use an architecture-brief
and case-study-ledger direction: near-white canvas, ink typography, graphite
rules, restrained teal for current facts, amber for observations, blue for
summaries, plum for reflections, and red for superseded facts. No gradients,
glow, purple AI styling, fake metrics, stock imagery, chat bubbles, nested
cards, or decorative dashboard filler.

Header: Organizational AI Memory; Home, Demo, Method, Evidence; Run the public
demo; Inspect the evidence. Main title: Organizational AI Memory. Supporting
copy: A provenance-first memory layer that turns conversation history into
traceable observations, current facts, summaries, and reflections.

Integrate the usable public query directly into the first screen. Heading:
Query the public memory. Scope: Public demo only. Query: What is the current
budget and deadline, and what changed? Action: Retrieve memory. Show a ledger
result with current budget 4500 USD per month, previous budget 3000 USD per
month marked Superseded, current deadline August 29, 2026, previous deadline
August 15, 2026 marked Superseded, and expandable fact to observation to source
turn provenance. All UI text must remain code-native and implementation-ready.
    `,
  },
  {
    key: 'method',
    device: 'DESKTOP',
    prompt: `
Create the Method route for the same Organizational AI Memory visual system.
Title: How organizational memory is formed. Show one full-width readable
sequence: Source context -> Memory formation -> Canonical store -> Temporal
truth -> Retrieval -> Sourced result. Use exact objects Thread, Turn,
Observation, Fact, Summary, Reflection, Source reference. Postgres is labeled
source of truth. Semantic retrieval is labeled optional acceleration. Include
a real current-versus-superseded fact timeline and a safety band separating
public_demo + public_safe from internal_demo + isolated. Use open columns,
rules, ledgers, and accessible text, not cards or infrastructure theater. No
gradients, fake metrics, cloud diagrams, AI motifs, or invented capabilities.
    `,
  },
  {
    key: 'evidence',
    device: 'DESKTOP',
    prompt: `
Create the Evidence route for the same Organizational AI Memory visual system.
Title: Inspect the memory behind the result. Scope: Public demo only. Add
filters Thread, Turns, Observations, Facts, Summary, Reflection with Facts
selected. Main area is a precise facts ledger with columns Predicate, Value,
Status, Valid from, Confidence, Source. A selected budget fact opens a side
inspector titled Provenance path with Fact, Observation, and Source turn steps,
including the excerpt Budget is 4500 USD per month after the security
review. Show current and superseded values in an Earlier truth remains
inspectable timeline. Near-white, ink, graphite rules, semantic accent colors,
system sans and mono IDs. No generic dashboard, charts, side navigation,
gradients, nested cards, fake metrics, or decorative AI art.
    `,
  },
];

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed for ${destination}: ${response.status}`);
  }
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

await fs.mkdir(outputRoot, { recursive: true });
const project = await stitch.createProject(`Organizational AI Memory ${new Date().toISOString().slice(0, 10)}`);
const manifest = {
  projectId: project.projectId,
  createdAt: new Date().toISOString(),
  screens: [],
};

for (const spec of screens) {
  const screen = await project.generate(spec.prompt.trim(), spec.device);
  const [htmlUrl, imageUrl] = await Promise.all([screen.getHtml(), screen.getImage()]);
  const htmlPath = path.join(outputRoot, `${spec.key}.html`);
  const imagePath = path.join(outputRoot, `${spec.key}.png`);
  await Promise.all([download(htmlUrl, htmlPath), download(imageUrl, imagePath)]);
  manifest.screens.push({
    key: spec.key,
    screenId: screen.screenId,
    deviceType: spec.device,
    htmlPath,
    imagePath,
  });
}

await fs.writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest));
