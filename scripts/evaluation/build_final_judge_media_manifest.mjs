import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIRMATION = 'FINAL_JUDGE_MEDIA_VISUALLY_REVIEWED';
if (process.env.OAM_FINAL_MEDIA_MANIFEST_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set OAM_FINAL_MEDIA_MANIFEST_CONFIRM=${CONFIRMATION} after visual review.`);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const finalRoot = path.join(repositoryRoot, 'artifacts', 'submission', 'media', 'final-judge-video');
const legacyManifestPath = path.join(repositoryRoot, 'artifacts', 'submission', 'media', 'release-media-manifest.json');
const outputPath = path.join(finalRoot, 'final-judge-media-manifest.json');
const ffprobe = process.env.OAM_FFPROBE_PATH || '/usr/bin/ffprobe';

const binaryRelativePaths = [
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
];
const textRelativePaths = [
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
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function artifact(relativePath, { probe = false } = {}) {
  if (path.isAbsolute(relativePath) || relativePath.includes('..')) throw new Error(`Unsafe manifest path: ${relativePath}`);
  const absolutePath = path.join(repositoryRoot, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Manifest input is not a regular file: ${relativePath}`);
  const entry = { path: relativePath, bytes: stat.size, sha256: sha256(absolutePath) };
  if (probe) {
    const media = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,sample_rate,channels',
      '-of', 'json',
      absolutePath,
    ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    entry.duration_seconds = media.format?.duration ? Number(media.format.duration) : null;
    entry.streams = media.streams || [];
  }
  return entry;
}

const qaPath = path.join(finalRoot, 'final-video-qa-report.json');
const qa = JSON.parse(fs.readFileSync(qaPath, 'utf8'));
if (!qa.passed || qa.visual_review_confirmation !== 'REVIEWED_ALL_FINAL_VIDEO_SCENES') {
  throw new Error('Final media QA and visual review must pass before manifesting.');
}
const capture = JSON.parse(fs.readFileSync(
  path.join(finalRoot, 'sources', 'public-interaction-capture-report.json'),
  'utf8',
));
const voice = JSON.parse(fs.readFileSync(path.join(finalRoot, 'voice-generation-report.json'), 'utf8'));
const build = JSON.parse(fs.readFileSync(path.join(finalRoot, 'final-video-build-report.json'), 'utf8'));
const legacy = JSON.parse(fs.readFileSync(legacyManifestPath, 'utf8'));

const binaryArtifacts = binaryRelativePaths.map((relativePath) => artifact(relativePath, { probe: true }));
const textArtifacts = textRelativePaths.map((relativePath) => artifact(relativePath));
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  legacy_release_binding: {
    manifest: artifact(path.relative(repositoryRoot, legacyManifestPath).split(path.sep).join('/')),
    deployed_code_commit: legacy.release.deployed_code_commit,
    deployed_source_sha256: legacy.release.deployed_source_sha256,
    legacy_artifact_count: 31,
  },
  source_capture: {
    report: artifact('artifacts/submission/media/final-judge-video/sources/public-interaction-capture-report.json'),
    passed: capture.passed,
    assist_attempts: capture.assist_attempts,
    assist: capture.assist,
    expected_public_boundary_denials: capture.expected_public_boundary_denials,
  },
  voice_generation: {
    report: artifact('artifacts/submission/media/final-judge-video/voice-generation-report.json'),
    provider: voice.provider,
    voice_id: voice.voice_id,
    model_id: voice.model_id,
    output_format: voice.output_format,
    voice_settings: voice.voice_settings,
  },
  video_build: {
    report: artifact('artifacts/submission/media/final-judge-video/final-video-build-report.json'),
    method: build.build_method,
    ffmpeg_version: build.ffmpeg_version,
  },
  qa: {
    report: artifact('artifacts/submission/media/final-judge-video/final-video-qa-report.json'),
    passed: qa.passed,
    visual_review_confirmation: qa.visual_review_confirmation,
  },
  control_evidence: {
    summary: qa.release_control_evidence,
    citation_validation: qa.citation_validation_evidence,
    artifacts: {
      release_handoff: artifact('handoff/FINAL_HACKATHON_MVP_HANDOFF_2026-07-10.md'),
      identity_proof: artifact('artifacts/evaluation/identity-plane-proof/report.json'),
      browser_report: artifact('artifacts/qa/browser/report.json'),
      physical_agent_proof: artifact('artifacts/evaluation/personal-agent-runtime-proof-sanitized.json'),
    },
  },
  artifacts: {
    binary: binaryArtifacts,
    text: textArtifacts,
  },
  release_safety: {
    synthetic_public_safe_disclosure: true,
    captions_burned_in_and_webvtt_included: true,
    input_metadata_not_mapped: true,
    workshop_recording_excluded: true,
    workshop_frames_and_transcript_excluded: true,
    credential_material_excluded: true,
    visual_review_confirmed: true,
  },
};

const temporary = `${outputPath}.tmp-${process.pid}`;
try {
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, outputPath);
} finally {
  fs.rmSync(temporary, { force: true });
}
console.log(JSON.stringify({
  manifest: path.relative(repositoryRoot, outputPath).split(path.sep).join('/'),
  binary_artifacts: binaryArtifacts.length,
  text_artifacts: textArtifacts.length,
  passed: true,
}, null, 2));
