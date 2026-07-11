import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VISUAL_CONFIRMATION = 'REVIEWED_ALL_FINAL_VIDEO_SCENES';
const options = new Set(process.argv.slice(2));
const allowedOptions = new Set(['--check', '--write-reviewed-report']);
if ([...options].some((option) => !allowedOptions.has(option))
    || (options.has('--check') && options.has('--write-reviewed-report'))) {
  throw new Error('Use exactly one of --check or --write-reviewed-report.');
}
const writeReviewedReport = options.has('--write-reviewed-report');
if (writeReviewedReport
    && process.env.OAM_FINAL_VIDEO_VISUAL_REVIEW_CONFIRM !== VISUAL_CONFIRMATION) {
  throw new Error(`Set OAM_FINAL_VIDEO_VISUAL_REVIEW_CONFIRM=${VISUAL_CONFIRMATION} after visual review.`);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const finalRoot = path.join(
  repositoryRoot,
  'artifacts',
  'submission',
  'media',
  'final-judge-video',
);
const ffmpeg = process.env.OAM_FFMPEG_PATH || '/usr/bin/ffmpeg';
const ffprobe = process.env.OAM_FFPROBE_PATH || '/usr/bin/ffprobe';
const relative = (absolutePath) => path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');

const expectedAssets = [
  'prompt:website_handoff_brief_v1',
  'workflow:portfolio_site_delivery_v1',
  'decision:source_first_before_generation_v1',
];
const requiredSourceTurns = ['st-002', 'st-009', 'st-001'];
const allowedSourceTurns = [...requiredSourceTurns, 'st-007'];
const videoContracts = [
  {
    id: 'full-judge-demo',
    video: 'organizational-ai-memory-p5-judge-demo.mp4',
    captions: 'organizational-ai-memory-p5-judge-demo.vtt',
    expectedDuration: 177,
    silenceMinimumStart: 174,
    visualSamples: [2, 12, 22, 30, 36, 43, 50, 57, 63, 68, 72, 79, 83, 85, 91, 99, 105, 110, 114, 118, 121, 124, 131, 145, 154, 164, 172],
  },
  {
    id: 'live-pitch-demo',
    video: 'organizational-ai-memory-live-pitch-demo.mp4',
    captions: 'organizational-ai-memory-live-pitch-demo.vtt',
    expectedDuration: 55.5,
    silenceMinimumStart: 48.8,
    visualSamples: [1, 5, 9, 12, 16, 20, 23, 25, 29, 34, 38, 42, 46, 50, 53],
  },
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function run(command, args, { stderr = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}).\n${result.stderr || result.stdout}`);
  }
  return stderr ? result.stderr : result.stdout;
}

function probe(filePath) {
  return JSON.parse(run(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-show_chapters',
    '-of', 'json',
    filePath,
  ]));
}

function parseVtt(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  if (!text.startsWith('WEBVTT\n')) throw new Error(`${relative(filePath)} is not WebVTT.`);
  const cuePattern = /(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})\n([^\n]+(?:\n(?!\n)[^\n]+)?)/gu;
  const cues = [...text.matchAll(cuePattern)].map((match) => {
    const time = (offset) => (
      Number(match[offset]) * 3600
      + Number(match[offset + 1]) * 60
      + Number(match[offset + 2])
      + Number(match[offset + 3]) / 1000
    );
    const lines = match[9].split('\n');
    return { start: time(1), end: time(5), lines };
  });
  if (!cues.length) throw new Error(`${relative(filePath)} contains no cues.`);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (cue.end <= cue.start) throw new Error(`${relative(filePath)} has an empty cue.`);
    if (index > 0 && cue.start < cues[index - 1].end) {
      throw new Error(`${relative(filePath)} has overlapping cues.`);
    }
    if (cue.lines.length > 2 || cue.lines.some((line) => line.length > 42)) {
      throw new Error(`${relative(filePath)} exceeds the two-line, 42-character caption limit.`);
    }
  }
  return {
    cue_count: cues.length,
    first_cue_seconds: cues[0].start,
    last_cue_seconds: cues.at(-1).end,
    max_lines: Math.max(...cues.map((cue) => cue.lines.length)),
    max_line_length: Math.max(...cues.flatMap((cue) => cue.lines.map((line) => line.length))),
  };
}

function parseLoudness(filePath) {
  const stderr = run(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i', filePath,
    '-map', '0:a:0',
    '-af', 'loudnorm=I=-16:TP=-1:LRA=7:print_format=json',
    '-f', 'null',
    '-',
  ], { stderr: true });
  const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/u);
  if (!match) throw new Error(`No loudness result for ${relative(filePath)}.`);
  const result = JSON.parse(match[0]);
  const integrated = Number(result.input_i);
  const peak = Number(result.input_tp);
  if (Math.abs(integrated - (-16)) > 0.5 || peak > -1) {
    throw new Error(`${relative(filePath)} fails loudness: ${integrated} LUFS, ${peak} dBTP.`);
  }
  return { integrated_lufs: integrated, true_peak_dbtp: peak, loudness_range_lu: Number(result.input_lra) };
}

function parseSilence(filePath, minimumStart) {
  const stderr = run(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i', filePath,
    '-map', '0:a:0',
    '-af', 'silencedetect=noise=-45dB:d=0.8',
    '-f', 'null',
    '-',
  ], { stderr: true });
  const starts = [...stderr.matchAll(/silence_start: ([0-9.]+)/gu)].map((match) => Number(match[1]));
  const ends = [...stderr.matchAll(/silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/gu)]
    .map((match) => ({ end: Number(match[1]), duration: Number(match[2]) }));
  if (starts.length !== 1 || ends.length !== 1 || starts[0] < minimumStart) {
    throw new Error(`${relative(filePath)} has unexpected silence intervals.`);
  }
  return { start_seconds: starts[0], end_seconds: ends[0].end, duration_seconds: ends[0].duration, expected_trailing_hold: true };
}

function blackIntervals(filePath) {
  const stderr = run(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i', filePath,
    '-map', '0:v:0',
    '-vf', 'blackdetect=d=0.5:pix_th=0.10',
    '-an',
    '-f', 'null',
    '-',
  ], { stderr: true });
  const intervals = [...stderr.matchAll(/black_start:([0-9.]+) black_end:([0-9.]+) black_duration:([0-9.]+)/gu)]
    .map((match) => ({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) }));
  if (intervals.length) throw new Error(`${relative(filePath)} contains black intervals.`);
  return intervals;
}

function validateMetadata(mediaProbe, filePath) {
  if ((mediaProbe.chapters || []).length) throw new Error(`${relative(filePath)} contains chapters.`);
  const allowedFormatTags = new Set(['major_brand', 'minor_version', 'compatible_brands', 'encoder']);
  const allowedStreamTags = new Set(['language', 'handler_name', 'vendor_id', 'encoder']);
  const formatTags = Object.keys(mediaProbe.format?.tags || {});
  const streamTags = mediaProbe.streams.flatMap((stream) => Object.keys(stream.tags || {}));
  if (formatTags.some((tag) => !allowedFormatTags.has(tag))
      || streamTags.some((tag) => !allowedStreamTags.has(tag))) {
    throw new Error(`${relative(filePath)} contains unexpected metadata tags.`);
  }
  return { format_tags: formatTags, stream_tags: [...new Set(streamTags)] };
}

function validateVideo(contract, buildReport) {
  const filePath = path.join(finalRoot, contract.video);
  const captionPath = path.join(finalRoot, contract.captions);
  const mediaProbe = probe(filePath);
  const video = mediaProbe.streams.filter((stream) => stream.codec_type === 'video');
  const audio = mediaProbe.streams.filter((stream) => stream.codec_type === 'audio');
  if (video.length !== 1 || audio.length !== 1) throw new Error(`${contract.video} must have one video and one audio stream.`);
  if (video[0].codec_name !== 'h264' || video[0].profile !== 'High'
      || video[0].width !== 1920 || video[0].height !== 1080
      || video[0].pix_fmt !== 'yuv420p' || video[0].r_frame_rate !== '30/1') {
    throw new Error(`${contract.video} fails the H.264 video contract.`);
  }
  if (audio[0].codec_name !== 'aac' || audio[0].profile !== 'LC'
      || audio[0].sample_rate !== '48000' || audio[0].channels !== 2) {
    throw new Error(`${contract.video} fails the AAC audio contract.`);
  }
  const duration = Number(mediaProbe.format.duration);
  if (Math.abs(duration - contract.expectedDuration) > 0.05) {
    throw new Error(`${contract.video} has unexpected duration ${duration}.`);
  }
  if (Math.abs(Number(video[0].duration) - contract.expectedDuration) > 0.05
      || Number(video[0].nb_frames) !== Math.round(contract.expectedDuration * 30)
      || Math.abs(Number(audio[0].duration) - contract.expectedDuration) > 0.05) {
    throw new Error(`${contract.video} streams do not cover the complete output duration.`);
  }
  const build = buildReport.builds.find((item) => item.id === contract.id);
  if (!build || build.output.sha256 !== sha256(filePath) || build.output.bytes !== fs.statSync(filePath).size) {
    throw new Error(`${contract.video} does not match the build report.`);
  }
  if (build.captions?.path !== relative(captionPath)
      || build.captions?.sha256 !== sha256(captionPath)
      || build.captions?.bytes !== fs.statSync(captionPath).size) {
    throw new Error(`${contract.captions} does not match the build report.`);
  }
  const bytes = fs.readFileSync(filePath);
  const moov = bytes.indexOf(Buffer.from('moov'));
  const mdat = bytes.indexOf(Buffer.from('mdat'));
  if (moov < 0 || mdat < 0 || moov > mdat) throw new Error(`${contract.video} is not faststart optimized.`);

  run(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-i', filePath, '-map', '0:v:0', '-f', 'null', '-']);
  run(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-i', filePath, '-map', '0:a:0', '-f', 'null', '-']);
  const captions = parseVtt(captionPath);
  if (captions.last_cue_seconds > duration) throw new Error(`${contract.captions} exceeds its video.`);

  return {
    id: contract.id,
    video: { path: relative(filePath), bytes: bytes.length, sha256: sha256(filePath), duration_seconds: duration },
    captions: {
      path: relative(captionPath),
      bytes: fs.statSync(captionPath).size,
      sha256: sha256(captionPath),
      ...captions,
    },
    streams: {
      video: { codec: video[0].codec_name, profile: video[0].profile, width: video[0].width, height: video[0].height, pixel_format: video[0].pix_fmt, frame_rate: video[0].r_frame_rate, duration_seconds: Number(video[0].duration), frame_count: Number(video[0].nb_frames) },
      audio: { codec: audio[0].codec_name, profile: audio[0].profile, sample_rate: Number(audio[0].sample_rate), channels: audio[0].channels, duration_seconds: Number(audio[0].duration) },
    },
    faststart: true,
    full_video_decode: 'PASS',
    full_audio_decode: 'PASS',
    loudness: parseLoudness(filePath),
    silence: parseSilence(filePath, contract.silenceMinimumStart),
    black_intervals: blackIntervals(filePath),
    metadata: validateMetadata(mediaProbe, filePath),
    visual_review: {
      status: 'PASS',
      method: 'Full-resolution samples inspected from every declared scene; captions inspected both over UI and during the silent proof hold.',
      sample_times_seconds: contract.visualSamples,
    },
  };
}

const captureReportPath = path.join(finalRoot, 'sources', 'public-interaction-capture-report.json');
const captureReport = JSON.parse(fs.readFileSync(captureReportPath, 'utf8'));
const captureGeneratorPath = path.join(repositoryRoot, 'scripts', 'evaluation', 'capture_final_judge_video_sources.mjs');
if (!captureReport.passed || captureReport.assist_attempts !== 1
    || !['generated', 'fallback'].includes(captureReport.assist?.status)
    || captureReport.assist?.model !== 'gpt-5.3-codex-spark') {
  throw new Error('Final public source capture failed its assist contract.');
}
if (captureReport.schema_version !== 2
    || captureReport.generator?.path !== relative(captureGeneratorPath)
    || captureReport.generator?.sha256 !== sha256(captureGeneratorPath)
    || captureReport.browser_security?.root !== false
    || captureReport.browser_security?.chrome_sandbox !== 'enabled') {
  throw new Error('Final source capture is not bound to the current sandboxed capture generator.');
}
if (!Array.isArray(captureReport.screenshots) || captureReport.screenshots.length !== 6) {
  throw new Error('Final source capture must bind all six screenshots.');
}
for (const artifact of [...captureReport.screenshots, captureReport.video]) {
  const artifactPath = path.join(finalRoot, 'sources', artifact?.path || '');
  if (!artifact?.path || path.basename(artifact.path) !== artifact.path
      || artifact.sha256 !== sha256(artifactPath)
      || artifact.bytes !== fs.statSync(artifactPath).size) {
    throw new Error(`Final source artifact does not match its capture report: ${artifact?.path || 'missing path'}.`);
  }
}
for (const key of expectedAssets) {
  if (!captureReport.assist.selected_asset_keys.includes(key)
      || !captureReport.assist.cited_asset_keys.includes(key)) {
    throw new Error(`Final source capture is missing selected/cited asset ${key}.`);
  }
}
if (captureReport.assist.selected_asset_keys.length !== expectedAssets.length
    || captureReport.assist.cited_asset_keys.length !== expectedAssets.length
    || !requiredSourceTurns.every((turn) => captureReport.assist.cited_source_turn_ids.includes(turn))
    || !captureReport.assist.cited_source_turn_ids.every((turn) => allowedSourceTurns.includes(turn))) {
  throw new Error('Final source capture has invalid citation containment.');
}
if (!Array.isArray(captureReport.assist.steps)
    || captureReport.assist.steps.length !== captureReport.assist.plan_step_count
    || !captureReport.assist.per_step_citation_containment) {
  throw new Error('Final source capture does not prove per-step citation containment.');
}
if (captureReport.unexpected_console_messages.length || captureReport.page_errors.length
    || captureReport.failed_requests.length) {
  throw new Error('Final source capture contains unexpected browser errors.');
}

const voiceReportPath = path.join(finalRoot, 'voice-generation-report.json');
const voiceReportText = fs.readFileSync(voiceReportPath, 'utf8');
const voiceReport = JSON.parse(voiceReportText);
if (voiceReport.provider !== 'ElevenLabs' || voiceReport.voice_id !== 'HsgAn6u75ZbG3h23K3dR'
    || voiceReport.model_id !== 'eleven_multilingual_v2' || voiceReport.generated.length !== 2
    || /(?:xi-api-key|AQ\.[A-Za-z0-9_-]{20,}|\/root\/)/u.test(voiceReportText)) {
  throw new Error('Voice-generation report fails its public-safe contract.');
}
for (const item of voiceReport.generated) {
  for (const artifact of [item.audio, item.alignment, item.captions]) {
    const artifactPath = path.join(finalRoot, artifact.path);
    if (artifact.sha256 !== sha256(artifactPath) || artifact.bytes !== fs.statSync(artifactPath).size) {
      throw new Error(`${artifact.path} does not match the voice-generation report.`);
    }
  }
}

const buildReportPath = path.join(finalRoot, 'final-video-build-report.json');
const buildReport = JSON.parse(fs.readFileSync(buildReportPath, 'utf8'));
if (buildReport.builds.length !== 2 || buildReport.disclosure !== 'Synthetic public-safe demo data') {
  throw new Error('Final video build report fails its release contract.');
}
for (const build of buildReport.builds) {
  for (const scene of build.scenes) {
    if (path.isAbsolute(scene.source)) throw new Error('Build report contains an absolute scene path.');
    const scenePath = path.join(repositoryRoot, scene.source);
    if (scene.source_sha256 !== sha256(scenePath)) throw new Error(`Scene hash mismatch: ${scene.source}`);
  }
}

const legacyManifestPath = path.join(repositoryRoot, 'artifacts', 'submission', 'media', 'release-media-manifest.json');
const identityProofPath = path.join(repositoryRoot, 'artifacts', 'evaluation', 'identity-plane-proof', 'report.json');
const browserReportPath = path.join(repositoryRoot, 'artifacts', 'qa', 'browser', 'report.json');
const physicalProofPath = path.join(repositoryRoot, 'artifacts', 'evaluation', 'personal-agent-runtime-proof-sanitized.json');
const handoffPath = path.join(repositoryRoot, 'handoff', 'FINAL_HACKATHON_MVP_HANDOFF_2026-07-10.md');
const legacyManifest = JSON.parse(fs.readFileSync(legacyManifestPath, 'utf8'));
const identityProof = JSON.parse(fs.readFileSync(identityProofPath, 'utf8'));
const browserReport = JSON.parse(fs.readFileSync(browserReportPath, 'utf8'));
const physicalProof = JSON.parse(fs.readFileSync(physicalProofPath, 'utf8'));
const handoff = fs.readFileSync(handoffPath, 'utf8');
if (identityProof.overall_status !== 'PASS' || identityProof.counts?.pass !== 22
    || identityProof.counts?.fail !== 0 || identityProof.source_commit !== legacyManifest.release.deployed_code_commit
    || identityProof.source_sha256 !== legacyManifest.release.deployed_source_sha256
    || !browserReport.passed || browserReport.checks?.length !== 35 || browserReport.failures?.length !== 0
    || !physicalProof.passed || physicalProof.boundary_checks?.length !== 7
    || physicalProof.boundary_checks.some((check) => !check.passed)
    || !/API\/security suite pass\/total \| 275\/275 PASS/u.test(handoff)
    || !/Real PostgreSQL integration pass\/total \| 5\/5 PASS/u.test(handoff)) {
  throw new Error('Published release-control evidence does not support the headline counts.');
}

const deployedCommit = legacyManifest.release.deployed_code_commit;
const validatorPath = 'app/lib/structured-capability-plan.mjs';
const validatorTestPath = 'test/api/structured-capability-plan.test.mjs';
const validatorSource = run('git', ['show', `${deployedCommit}:${validatorPath}`]);
const validatorTestSource = run('git', ['show', `${deployedCommit}:${validatorTestPath}`]);
if (!validatorSource.includes('const allowedSourceTurns = new Set(')
    || !validatorSource.includes('if (!allowedSourceTurns.has(sourceTurnId))')
    || !validatorTestSource.includes("crossStepSource.steps[0].source_turn_ids = ['st-002']")) {
  throw new Error('Deployed structured-plan evidence does not prove per-asset citation containment.');
}
const textSha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const results = videoContracts.map((contract) => validateVideo(contract, buildReport));
const posterPath = path.join(finalRoot, 'organizational-ai-memory-p5-judge-demo-poster.png');
const posterProbe = probe(posterPath).streams.find((stream) => stream.codec_type === 'video');
if (posterProbe?.codec_name !== 'png' || posterProbe.width !== 1920 || posterProbe.height !== 1080) {
  throw new Error('Final poster fails the 1920x1080 PNG contract.');
}
if (buildReport.poster?.path !== relative(posterPath)
    || buildReport.poster?.sha256 !== sha256(posterPath)
    || buildReport.poster?.bytes !== fs.statSync(posterPath).size) {
  throw new Error('Final poster does not match the build report.');
}

const reportPath = path.join(finalRoot, 'final-video-qa-report.json');
const report = {
  schema_version: 1,
  verified_at: new Date().toISOString(),
  source_capture: {
    path: relative(captureReportPath),
    passed: true,
    assist_attempts: captureReport.assist_attempts,
    assist: captureReport.assist,
    expected_public_boundary_denials: captureReport.expected_public_boundary_denials,
  },
  voice_generation: {
    path: relative(voiceReportPath),
    provider: voiceReport.provider,
    voice_id: voiceReport.voice_id,
    model_id: voiceReport.model_id,
    generated_count: voiceReport.generated.length,
    public_safe: true,
  },
  release_control_evidence: {
    deployed_code_commit: deployedCommit,
    deployed_source_sha256: legacyManifest.release.deployed_source_sha256,
    api_security: { passed: 275, total: 275, source: relative(handoffPath), source_sha256: sha256(handoffPath) },
    postgres_integration: { passed: 5, total: 5, freshness: 'recorded contract evidence; not a fresh live-database run', source: relative(handoffPath), source_sha256: sha256(handoffPath) },
    identity: { passed: 22, total: 22, source: relative(identityProofPath), source_sha256: sha256(identityProofPath) },
    browser: { passed: 35, total: 35, source: relative(browserReportPath), source_sha256: sha256(browserReportPath) },
    physical_agent_boundaries: { passed: 7, total: 7, source: relative(physicalProofPath), source_sha256: sha256(physicalProofPath) },
  },
  citation_validation_evidence: {
    source_commit: deployedCommit,
    validator_path: validatorPath,
    validator_sha256: textSha256(validatorSource),
    validator_test_path: validatorTestPath,
    validator_test_sha256: textSha256(validatorTestSource),
    per_asset_source_turn_containment: true,
  },
  builds: results,
  poster: { path: relative(posterPath), bytes: fs.statSync(posterPath).size, sha256: sha256(posterPath), width: 1920, height: 1080 },
  visual_review_confirmation: VISUAL_CONFIRMATION,
  passed: true,
};
if (writeReviewedReport) {
  const temporaryReport = `${reportPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryReport, `${JSON.stringify(report, null, 2)}\n`);
    fs.renameSync(temporaryReport, reportPath);
  } finally {
    fs.rmSync(temporaryReport, { force: true });
  }
} else {
  const reviewed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!reviewed.passed || reviewed.visual_review_confirmation !== VISUAL_CONFIRMATION) {
    throw new Error('Existing QA report has no completed visual-review attestation.');
  }
  for (const result of results) {
    const prior = reviewed.builds.find((build) => build.id === result.id);
    if (!prior || prior.video.sha256 !== result.video.sha256
        || prior.video.bytes !== result.video.bytes
        || prior.video.duration_seconds !== result.video.duration_seconds
        || prior.captions?.sha256 !== result.captions.sha256
        || prior.captions?.bytes !== result.captions.bytes) {
      throw new Error(`Reviewed QA report does not match current ${result.id} media.`);
    }
  }
  if (reviewed.poster?.sha256 !== report.poster.sha256
      || reviewed.poster?.bytes !== report.poster.bytes
      || reviewed.poster?.width !== report.poster.width
      || reviewed.poster?.height !== report.poster.height) {
    throw new Error('Reviewed QA report does not match the current poster.');
  }
}
console.log(JSON.stringify({
  report: relative(reportPath),
  mode: writeReviewedReport ? 'write-reviewed-report' : 'structural-ci-verification',
  videos: results.length,
  passed: true,
}, null, 2));
