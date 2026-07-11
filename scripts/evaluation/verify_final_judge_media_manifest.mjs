import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const manifestPath = path.join(
  repositoryRoot,
  'artifacts',
  'submission',
  'media',
  'final-judge-video',
  'final-judge-media-manifest.json',
);
const ffprobe = process.env.OAM_FFPROBE_PATH || '/usr/bin/ffprobe';
execFileSync(process.execPath, [
  path.join(scriptDirectory, 'verify_final_judge_videos.mjs'),
  '--check',
], {
  cwd: repositoryRoot,
  stdio: 'inherit',
  env: { ...process.env, OAM_FINAL_VIDEO_VISUAL_REVIEW_CONFIRM: '' },
});
const expectedBinaryPaths = new Set([
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-full-narration.mp3',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-live-demo-narration.mp3',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-live-pitch-demo.mp4',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo-poster.png',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.mp4',
  'artifacts/submission/media/final-judge-video/sources/01-home-1920x1080.png',
  'artifacts/submission/media/final-judge-video/sources/02-search-results-1920x1080.png',
  'artifacts/submission/media/final-judge-video/sources/03-asset-inspector-provenance-1920x1080.png',
  'artifacts/submission/media/final-judge-video/sources/04-asset-source-path-1920x1080.png',
  'artifacts/submission/media/final-judge-video/sources/05-assist-result-1920x1080.png',
  'artifacts/submission/media/final-judge-video/sources/06-analytics-access-proof-1920x1080.png',
  'artifacts/submission/media/final-judge-video/sources/public-capability-interaction.webm',
]);
const expectedTextPaths = new Set([
  'artifacts/submission/media/final-judge-video/FINAL_VIDEO_TRANSCRIPTS.md',
  'artifacts/submission/media/final-judge-video/final-video-build-report.json',
  'artifacts/submission/media/final-judge-video/final-video-qa-report.json',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-full-narration-alignment.json',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-full-narration.txt',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-full-narration.vtt',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-live-demo-narration-alignment.json',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-live-demo-narration.txt',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-live-demo-narration.vtt',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-live-pitch-demo.vtt',
  'artifacts/submission/media/final-judge-video/organizational-ai-memory-p5-judge-demo.vtt',
  'artifacts/submission/media/final-judge-video/sources/public-interaction-capture-report.json',
  'artifacts/submission/media/final-judge-video/voice-generation-report.json',
]);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((item) => expected.has(item));
}

function probe(filePath) {
  return JSON.parse(execFileSync(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    filePath,
  ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

function verifyArtifact(entry, { binary }) {
  if (!entry || typeof entry.path !== 'string' || path.isAbsolute(entry.path)
      || entry.path.includes('..') || !/^[0-9a-f]{64}$/u.test(entry.sha256)) {
    throw new Error('Manifest contains an invalid artifact entry.');
  }
  const filePath = path.join(repositoryRoot, entry.path);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes || sha256(filePath) !== entry.sha256) {
    throw new Error(`Manifest mismatch: ${entry.path}`);
  }
  if (stat.size >= 100 * 1024 * 1024) throw new Error(`GitHub artifact is too large: ${entry.path}`);
  const bytes = fs.readFileSync(filePath);
  if (!binary) {
    if (bytes.includes(0)) throw new Error(`Text artifact contains NUL bytes: ${entry.path}`);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  return filePath;
}

const manifestText = fs.readFileSync(manifestPath, 'utf8');
if (/\/(?:root|home|tmp)\//u.test(manifestText)) throw new Error('Manifest contains an absolute host path.');
const manifest = JSON.parse(manifestText);
if (manifest.schema_version !== 1) throw new Error('Unsupported final judge media manifest schema.');

const binaryPaths = new Set(manifest.artifacts?.binary?.map((entry) => entry.path) || []);
const textPaths = new Set(manifest.artifacts?.text?.map((entry) => entry.path) || []);
if (!sameSet(binaryPaths, expectedBinaryPaths) || !sameSet(textPaths, expectedTextPaths)) {
  throw new Error('Final judge media manifest has an unexpected artifact set.');
}

for (const entry of manifest.artifacts.binary) {
  const filePath = verifyArtifact(entry, { binary: true });
  const media = probe(filePath);
  const video = media.streams.filter((stream) => stream.codec_type === 'video');
  const audio = media.streams.filter((stream) => stream.codec_type === 'audio');
  if (entry.path.endsWith('.png')) {
    if (video.length !== 1 || audio.length || video[0].codec_name !== 'png'
        || video[0].width !== 1920 || video[0].height !== 1080) {
      throw new Error(`PNG contract failed: ${entry.path}`);
    }
  } else if (entry.path.endsWith('.mp3')) {
    if (video.length || audio.length !== 1 || audio[0].codec_name !== 'mp3'
        || audio[0].sample_rate !== '44100' || audio[0].channels !== 1) {
      throw new Error(`MP3 contract failed: ${entry.path}`);
    }
  } else if (entry.path.endsWith('.webm')) {
    if (video.length !== 1 || audio.length || video[0].codec_name !== 'vp8'
        || video[0].width !== 1920 || video[0].height !== 1080
        || video[0].pix_fmt !== 'yuv420p' || video[0].r_frame_rate !== '25/1') {
      throw new Error(`WebM contract failed: ${entry.path}`);
    }
  } else if (entry.path.endsWith('.mp4')) {
    if (video.length !== 1 || audio.length !== 1 || video[0].codec_name !== 'h264'
        || video[0].profile !== 'High' || video[0].width !== 1920 || video[0].height !== 1080
        || video[0].pix_fmt !== 'yuv420p' || video[0].r_frame_rate !== '30/1'
        || audio[0].codec_name !== 'aac' || audio[0].profile !== 'LC'
        || audio[0].sample_rate !== '48000' || audio[0].channels !== 2) {
      throw new Error(`MP4 contract failed: ${entry.path}`);
    }
    const duration = Number(media.format.duration);
    const expected = entry.path.includes('live-pitch') ? 55.5 : 177;
    if (Math.abs(duration - expected) > 0.05) throw new Error(`MP4 duration failed: ${entry.path}`);
    if (Math.abs(Number(video[0].duration) - expected) > 0.05
        || Number(video[0].nb_frames) !== Math.round(expected * 30)
        || Math.abs(Number(audio[0].duration) - expected) > 0.05) {
      throw new Error(`MP4 stream coverage failed: ${entry.path}`);
    }
  } else {
    throw new Error(`Unknown binary artifact type: ${entry.path}`);
  }
}
for (const entry of manifest.artifacts.text) verifyArtifact(entry, { binary: false });

const legacyPath = verifyArtifact(manifest.legacy_release_binding.manifest, { binary: false });
if (manifest.legacy_release_binding.manifest.sha256 !== sha256(legacyPath)
    || manifest.legacy_release_binding.legacy_artifact_count !== 31
    || !/^[0-9a-f]{40}$/u.test(manifest.legacy_release_binding.deployed_code_commit)
    || !/^[0-9a-f]{64}$/u.test(manifest.legacy_release_binding.deployed_source_sha256)) {
  throw new Error('Legacy release binding is invalid.');
}
const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
if (legacy.release.deployed_code_commit !== manifest.legacy_release_binding.deployed_code_commit
    || legacy.release.deployed_source_sha256 !== manifest.legacy_release_binding.deployed_source_sha256) {
  throw new Error('Legacy release binding does not match the closed legacy manifest.');
}

const capture = JSON.parse(fs.readFileSync(
  verifyArtifact(manifest.source_capture.report, { binary: false }),
  'utf8',
));
const voice = JSON.parse(fs.readFileSync(
  verifyArtifact(manifest.voice_generation.report, { binary: false }),
  'utf8',
));
const build = JSON.parse(fs.readFileSync(
  verifyArtifact(manifest.video_build.report, { binary: false }),
  'utf8',
));
const qa = JSON.parse(fs.readFileSync(
  verifyArtifact(manifest.qa.report, { binary: false }),
  'utf8',
));
if (!capture.passed || capture.assist_attempts !== 1 || capture.assist.model !== 'gpt-5.3-codex-spark'
    || capture.schema_version !== 2 || capture.browser_security?.root !== false
    || capture.browser_security?.chrome_sandbox !== 'enabled'
    || capture.assist?.per_step_citation_containment !== true
    || voice.provider !== 'ElevenLabs' || voice.voice_id !== 'HsgAn6u75ZbG3h23K3dR'
    || voice.model_id !== 'eleven_multilingual_v2' || build.builds.length !== 2
    || !qa.passed || qa.visual_review_confirmation !== 'REVIEWED_ALL_FINAL_VIDEO_SCENES') {
  throw new Error('Final source, voice, build, or QA report binding failed.');
}

const controlArtifacts = Object.values(manifest.control_evidence?.artifacts || {});
if (controlArtifacts.length !== 4) throw new Error('Final control-evidence artifact set is incomplete.');
for (const entry of controlArtifacts) verifyArtifact(entry, { binary: false });
const controls = qa.release_control_evidence;
if (JSON.stringify(manifest.control_evidence.summary) !== JSON.stringify(controls)
    || controls.deployed_code_commit !== manifest.legacy_release_binding.deployed_code_commit
    || controls.deployed_source_sha256 !== manifest.legacy_release_binding.deployed_source_sha256
    || controls.api_security?.passed !== 275 || controls.api_security?.total !== 275
    || controls.postgres_integration?.passed !== 5 || controls.postgres_integration?.total !== 5
    || controls.identity?.passed !== 22 || controls.identity?.total !== 22
    || controls.browser?.passed !== 35 || controls.browser?.total !== 35
    || controls.physical_agent_boundaries?.passed !== 7
    || controls.physical_agent_boundaries?.total !== 7) {
  throw new Error('Final headline control counts are not bound to QA evidence.');
}
const citation = manifest.control_evidence.citation_validation;
if (JSON.stringify(citation) !== JSON.stringify(qa.citation_validation_evidence)
    || citation.source_commit !== manifest.legacy_release_binding.deployed_code_commit
    || !citation.per_asset_source_turn_containment) {
  throw new Error('Final citation-validation binding is invalid.');
}
for (const [sourcePath, expectedHash] of [
  [citation.validator_path, citation.validator_sha256],
  [citation.validator_test_path, citation.validator_test_sha256],
]) {
  const source = execFileSync('git', ['show', `${citation.source_commit}:${sourcePath}`], {
    cwd: repositoryRoot,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (crypto.createHash('sha256').update(source).digest('hex') !== expectedHash) {
    throw new Error(`Citation-validation source binding failed: ${sourcePath}`);
  }
}

if (!Object.values(manifest.release_safety).every((value) => value === true)) {
  throw new Error('Final media release-safety attestation is incomplete.');
}

console.log(JSON.stringify({
  schema_version: manifest.schema_version,
  binary_artifacts: binaryPaths.size,
  text_artifacts: textPaths.size,
  legacy_artifacts_preserved: manifest.legacy_release_binding.legacy_artifact_count,
  final_videos: 2,
  passed: true,
}, null, 2));
