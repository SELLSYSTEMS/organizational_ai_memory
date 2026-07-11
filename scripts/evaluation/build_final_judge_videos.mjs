import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIRMATION = 'BUILD_FINAL_JUDGE_VIDEOS';
if (process.env.OAM_FINAL_VIDEO_BUILD_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set OAM_FINAL_VIDEO_BUILD_CONFIRM=${CONFIRMATION} to replace the final judge videos.`);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const mediaRoot = path.join(repositoryRoot, 'artifacts', 'submission', 'media');
const finalRoot = path.join(mediaRoot, 'final-judge-video');
const sourceRoot = path.join(finalRoot, 'sources');
const employeeRoot = path.join(mediaRoot, 'screenshots', 'employee-workflow');
const publicScreenshotRoot = path.join(repositoryRoot, 'artifacts', 'submission', 'screenshots');
const ffmpeg = process.env.OAM_FFMPEG_PATH || '/usr/bin/ffmpeg';
const ffprobe = process.env.OAM_FFPROBE_PATH || '/usr/bin/ffprobe';
const font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const temporaryRoot = fs.mkdtempSync(path.join(finalRoot, '.build-'));

const relative = (absolutePath) => path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
const source = (filename) => path.join(sourceRoot, filename);
const employee = (filename) => path.join(employeeRoot, filename);
const publicScreenshot = (filename) => path.join(publicScreenshotRoot, filename);

const fullScenes = [
  { duration: 10, type: 'image', source: source('01-home-1920x1080.png'), label: 'P5 · ORGANIZATIONAL CAPABILITY' },
  { duration: 9.9, type: 'video', source: source('public-capability-interaction.webm'), start: 0, label: 'PUBLIC CAPABILITY' },
  { duration: 5.8, type: 'video', source: source('public-capability-interaction.webm'), start: 3.8, label: 'DETERMINISTIC SEARCH' },
  { duration: 8.1, type: 'image', source: source('02-search-results-1920x1080.png'), label: 'THREE APPROVED RECORDS' },
  { duration: 4.8, type: 'image', source: source('03-asset-inspector-provenance-1920x1080.png'), label: 'TYPED · VERSIONED · REVIEWED' },
  { duration: 9, type: 'image', source: source('04-asset-source-path-1920x1080.png'), framing: 'provenance', label: 'ASSET → OBSERVATION → SOURCE TURN' },
  { duration: 9, type: 'video', source: source('public-capability-interaction.webm'), start: 13.9, label: 'ONE SPARK REQUEST' },
  { duration: 8.9, type: 'image', source: source('05-assist-result-1920x1080.png'), label: 'BOUNDED SPARK ADAPTATION' },
  { duration: 1.8, type: 'image', source: employee('01-onboard-employee.png'), label: 'SYNTHETIC EMPLOYEE' },
  { duration: 1.8, type: 'image', source: employee('05-physical-provisioning-succeeded.png'), label: 'GOVERNED PROVISIONING' },
  { duration: 1.8, type: 'image', source: employee('06-active-pair-and-runtime-identity.png'), label: 'ONE HUMAN · ONE AGENT' },
  { duration: 10.1, type: 'image', source: employee('11-capture-private-experience.png'), label: 'OWNER ONLY' },
  { duration: 3.3, type: 'image', source: employee('12-private-memory-excluded.png'), label: 'NO CONSENT · NO MATCH' },
  { duration: 2.3, type: 'image', source: employee('13-revision-bound-memory-consent.png'), label: 'CURRENT-REVISION CONSENT' },
  { duration: 9.7, type: 'image', source: employee('14-grounded-reuse-with-citation.png'), label: 'EMPLOYEE PREVIEW' },
  { duration: 5.8, type: 'image', source: employee('06-active-pair-and-runtime-identity.png'), label: 'DISTINCT RUNTIME IDENTITY' },
  { duration: 6.2, type: 'image', source: employee('20-physical-agent-runtime-proof.png'), label: 'PHYSICAL AGENT PROOF' },
  { duration: 3.6, type: 'image', source: employee('15-edit-resets-agent-access.png'), label: 'EDIT RESETS ACCESS' },
  { duration: 4, type: 'image', source: employee('16-edited-version-excluded.png'), label: 'FAIL CLOSED' },
  { duration: 3.6, type: 'image', source: employee('17-current-version-reconsented.png'), label: 'NEW REVISION · NEW HASH' },
  { duration: 3.6, type: 'image', source: publicScreenshot('07-architect-console-four-plane-1440.png'), label: 'INDEPENDENT REVIEW LANE' },
  { duration: 2.8, type: 'image', source: publicScreenshot('08-architect-effective-access-1440.png'), label: 'CANONICAL WRITE DENIED' },
  { duration: 14, type: 'image', source: source('06-analytics-access-proof-1920x1080.png'), framing: 'analytics', label: 'INVENTORY · DUPLICATION · GAPS' },
  {
    duration: 10.7,
    type: 'image',
    source: employee('20-physical-agent-runtime-proof.png'),
    label: 'BUILD-BOUND EXECUTION PROOF',
  },
  { duration: 8.1, type: 'image', source: publicScreenshot('05-method-architecture-1440.png'), label: 'RECORDED POSTGRES CONTRACT EVIDENCE' },
  {
    duration: 10,
    type: 'image',
    source: source('06-analytics-access-proof-1920x1080.png'),
    framing: 'analytics',
    label: 'PROPOSED ENTERPRISE PILOT',
  },
  {
    duration: 8.3,
    type: 'image',
    source: source('01-home-1920x1080.png'),
    label: 'ORGANIZATIONAL AI MEMORY',
  },
];

const liveScenes = [
  { duration: 3.5, type: 'image', source: source('01-home-1920x1080.png'), label: 'USER GOAL' },
  { duration: 7.46, type: 'video', source: source('public-capability-interaction.webm'), start: 3.8, label: 'DETERMINISTIC SEARCH' },
  { duration: 3.71, type: 'image', source: source('04-asset-source-path-1920x1080.png'), framing: 'provenance', label: 'SOURCE LINEAGE' },
  { duration: 7.67, type: 'video', source: source('public-capability-interaction.webm'), start: 13.9, label: 'SPARK · BOUNDED ADAPTATION' },
  { duration: 1.89, type: 'image', source: employee('11-capture-private-experience.png'), label: 'OWNER ONLY' },
  { duration: 1.89, type: 'image', source: employee('13-revision-bound-memory-consent.png'), label: 'REVISION CONSENT' },
  { duration: 2.38, type: 'image', source: employee('14-grounded-reuse-with-citation.png'), label: 'EMPLOYEE PREVIEW · SHA-256 CITATION' },
  { duration: 8.28, type: 'image', source: employee('20-physical-agent-runtime-proof.png'), label: 'PHYSICAL AGENT PROOF' },
  { duration: 2.2, type: 'image', source: employee('15-edit-resets-agent-access.png'), label: 'EDIT RESETS ACCESS' },
  { duration: 2.2, type: 'image', source: employee('16-edited-version-excluded.png'), label: 'FAIL CLOSED' },
  { duration: 3.26, type: 'image', source: source('05-assist-result-1920x1080.png'), label: 'DETERMINISTIC AUTHORITY' },
  { duration: 2, type: 'image', source: employee('17-current-version-reconsented.png'), label: 'EXACT REVISION ONLY' },
  { duration: 2.72, type: 'image', source: source('01-home-1920x1080.png'), label: 'DURABLE CAPABILITY' },
  {
    duration: 6.34,
    type: 'image',
    source: source('06-analytics-access-proof-1920x1080.png'),
    framing: 'analytics',
    label: 'MEMORABLE PROOF',
    callout: '275 API/security · 22 identity · 35 browser · 7 boundary checks',
  },
];

const builds = [
  {
    id: 'full-judge-demo',
    scenes: fullScenes,
    audio: path.join(finalRoot, 'organizational-ai-memory-full-narration.mp3'),
    sourceCaptions: path.join(finalRoot, 'organizational-ai-memory-full-narration.vtt'),
    outputCaptions: path.join(finalRoot, 'organizational-ai-memory-p5-judge-demo.vtt'),
    output: path.join(finalRoot, 'organizational-ai-memory-p5-judge-demo.mp4'),
  },
  {
    id: 'live-pitch-demo',
    scenes: liveScenes,
    audio: path.join(finalRoot, 'organizational-ai-memory-live-demo-narration.mp3'),
    sourceCaptions: path.join(finalRoot, 'organizational-ai-memory-live-demo-narration.vtt'),
    outputCaptions: path.join(finalRoot, 'organizational-ai-memory-live-pitch-demo.vtt'),
    output: path.join(finalRoot, 'organizational-ai-memory-live-pitch-demo.mp4'),
  },
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function atomicCopy(sourcePath, destinationPath) {
  const temporary = `${destinationPath}.tmp-${process.pid}`;
  try {
    fs.copyFileSync(sourcePath, temporary);
    fs.renameSync(temporary, destinationPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function atomicWrite(destinationPath, content) {
  const temporary = `${destinationPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, destinationPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function filterPath(filePath) {
  return filePath.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function escapeDrawtext(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll('%', '\\%');
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: options.stdio,
  });
}

function probe(filePath) {
  return JSON.parse(run(ffprobe, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    filePath,
  ]));
}

function measureLoudness(audioPath) {
  const result = spawnSync(ffmpeg, [
    '-hide_banner',
    '-nostats',
    '-i', audioPath,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7:dual_mono=true:print_format=json',
    '-f', 'null',
    '-',
  ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Loudness analysis failed for ${relative(audioPath)}.\n${result.stderr}`);
  const match = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/u);
  if (!match) throw new Error(`Loudness analysis returned no JSON for ${relative(audioPath)}.`);
  return JSON.parse(match[0]);
}

function framingFilter(scene) {
  if (scene.framing === 'provenance') {
    return 'crop=960:900:900:80,scale=1152:1080,pad=1920:1080:384:0:color=0xf3f4f1,setsar=1';
  }
  if (scene.framing === 'analytics') {
    return 'crop=700:900:1220:80,scale=840:1080,pad=1920:1080:540:0:color=0xf3f4f1,setsar=1';
  }
  const dimensions = probe(scene.source).streams.find((stream) => stream.codec_type === 'video');
  if (dimensions?.width === 1920 && dimensions?.height === 1080) {
    return 'scale=1920:1080:flags=lanczos,setsar=1';
  }
  return 'scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xe8ebed,setsar=1';
}

function overlayFilter(scene) {
  const labelWidth = Math.min(720, Math.max(230, scene.label.length * 12 + 42));
  const filters = [
    'drawbox=x=38:y=28:w=390:h=42:color=0x111827@0.88:t=fill',
    `drawtext=fontfile=${font}:text='SYNTHETIC PUBLIC-SAFE DEMO DATA':x=55:y=40:fontsize=16:fontcolor=white`,
    `drawbox=x=iw-${labelWidth + 38}:y=28:w=${labelWidth}:h=42:color=0x006b5f@0.94:t=fill`,
    `drawtext=fontfile=${font}:text='${escapeDrawtext(scene.label)}':x=w-${labelWidth + 18}:y=39:fontsize=17:fontcolor=white`,
  ];
  if (scene.callout) {
    filters.push(
      'drawbox=x=120:y=785:w=1680:h=92:color=0x111827@0.88:t=fill',
      `drawtext=fontfile=${font}:text='${escapeDrawtext(scene.callout)}':x=(w-text_w)/2:y=818:fontsize=27:fontcolor=white`,
    );
  }
  return filters.join(',');
}

function buildVideo(build) {
  const expectedDuration = Number(build.scenes.reduce((sum, scene) => sum + scene.duration, 0).toFixed(3));
  const loudness = measureLoudness(build.audio);
  atomicCopy(build.sourceCaptions, build.outputCaptions);

  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const scene of build.scenes) {
    if (scene.type === 'image') {
      args.push('-loop', '1', '-framerate', '30', '-t', String(scene.duration), '-i', scene.source);
    } else {
      args.push('-ss', String(scene.start || 0), '-t', String(scene.duration), '-i', scene.source);
    }
  }
  const audioIndex = build.scenes.length;
  args.push('-i', build.audio);

  const sceneFilters = build.scenes.map((scene, index) => (
    `[${index}:v]${framingFilter(scene)},fps=30,${overlayFilter(scene)},trim=duration=${scene.duration},setpts=PTS-STARTPTS[v${index}]`
  ));
  const concatInputs = build.scenes.map((_, index) => `[v${index}]`).join('');
  const subtitles = `subtitles=filename='${filterPath(build.outputCaptions)}':force_style='FontName=DejaVu Sans,FontSize=12,PrimaryColour=&H00FFFFFF,OutlineColour=&H00271811,BackColour=&HC0271811,BorderStyle=3,Outline=1,Shadow=0,MarginV=30,Alignment=2'`;
  const audioFilter = [
    'loudnorm=I=-16:TP=-1.5:LRA=7:dual_mono=true',
    `measured_I=${loudness.input_i}`,
    `measured_LRA=${loudness.input_lra}`,
    `measured_TP=${loudness.input_tp}`,
    `measured_thresh=${loudness.input_thresh}`,
    `offset=${loudness.target_offset}`,
    'linear=true:print_format=summary',
  ].join(':');
  const filter = [
    ...sceneFilters,
    `${concatInputs}concat=n=${build.scenes.length}:v=1:a=0[visual]`,
    `[visual]${subtitles}[vout]`,
    `[${audioIndex}:a]${audioFilter},pan=stereo|c0=c0|c1=c0,aresample=48000,apad=whole_dur=${expectedDuration}[aout]`,
  ].join(';');
  const temporaryOutput = path.join(temporaryRoot, `${build.id}.mp4`);
  args.push(
    '-filter_complex', filter,
    '-map', '[vout]',
    '-map', '[aout]',
    '-t', String(expectedDuration),
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-profile:v', 'high',
    '-level:v', '4.1',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    '-map_chapters', '-1',
    temporaryOutput,
  );
  run(ffmpeg, args, { stdio: 'inherit', encoding: null });
  fs.renameSync(temporaryOutput, build.output);

  const outputProbe = probe(build.output);
  const outputDuration = Number(outputProbe.format.duration);
  if (Math.abs(outputDuration - expectedDuration) > 0.08) {
    throw new Error(`${build.id} duration ${outputDuration} differs from scene duration ${expectedDuration}.`);
  }
  const outputVideoStream = outputProbe.streams.find((stream) => stream.codec_type === 'video');
  const outputAudioStream = outputProbe.streams.find((stream) => stream.codec_type === 'audio');
  if (Math.abs(Number(outputVideoStream?.duration) - expectedDuration) > 0.05
      || Number(outputVideoStream?.nb_frames) !== Math.round(expectedDuration * 30)
      || Math.abs(Number(outputAudioStream?.duration) - expectedDuration) > 0.05) {
    throw new Error(`${build.id} streams do not cover the complete ${expectedDuration}-second output.`);
  }
  return {
    id: build.id,
    expected_duration_seconds: expectedDuration,
    narration: {
      path: relative(build.audio),
      bytes: fs.statSync(build.audio).size,
      sha256: sha256(build.audio),
      loudness_analysis: loudness,
    },
    captions: {
      path: relative(build.outputCaptions),
      bytes: fs.statSync(build.outputCaptions).size,
      sha256: sha256(build.outputCaptions),
    },
    scenes: build.scenes.map((scene, index) => {
      const start = build.scenes.slice(0, index).reduce((sum, item) => sum + item.duration, 0);
      return {
        sequence: index + 1,
        start_seconds: Number(start.toFixed(3)),
        end_seconds: Number((start + scene.duration).toFixed(3)),
        source: relative(scene.source),
        source_sha256: sha256(scene.source),
        source_start_seconds: scene.type === 'video' ? scene.start || 0 : null,
        framing: scene.framing || 'fit',
        label: scene.label,
        callout: scene.callout || null,
      };
    }),
    output: {
      path: relative(build.output),
      bytes: fs.statSync(build.output).size,
      sha256: sha256(build.output),
      duration_seconds: outputDuration,
      streams: outputProbe.streams.map((stream) => ({
        codec_type: stream.codec_type,
        codec_name: stream.codec_name,
        profile: stream.profile,
        width: stream.width,
        height: stream.height,
        pix_fmt: stream.pix_fmt,
        sample_rate: stream.sample_rate,
        channels: stream.channels,
        avg_frame_rate: stream.avg_frame_rate,
        duration: stream.duration,
        nb_frames: stream.nb_frames,
      })),
    },
  };
}

for (const build of builds) {
  for (const filePath of [build.audio, build.sourceCaptions, ...build.scenes.map((scene) => scene.source)]) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Required input is not a regular file: ${filePath}`);
  }
  for (const scene of build.scenes.filter((item) => item.type === 'video')) {
    const sourceDuration = Number(probe(scene.source).format.duration);
    if ((scene.start || 0) + scene.duration > sourceDuration + 0.02) {
      throw new Error(`Scene ${scene.label} exceeds source duration ${sourceDuration}.`);
    }
  }
}
if (!fs.statSync(font).isFile()) throw new Error(`Required font is missing: ${font}`);

const results = [];
try {
  for (const build of builds) results.push(buildVideo(build));

  const posterPath = path.join(finalRoot, 'organizational-ai-memory-p5-judge-demo-poster.png');
  const temporaryPoster = path.join(temporaryRoot, 'poster.png');
  run(ffmpeg, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', '2',
    '-i', path.join(finalRoot, 'organizational-ai-memory-p5-judge-demo.mp4'),
    '-frames:v', '1',
    '-map_metadata', '-1',
    temporaryPoster,
  ], { stdio: 'inherit', encoding: null });
  fs.renameSync(temporaryPoster, posterPath);

  const transcriptPath = path.join(finalRoot, 'FINAL_VIDEO_TRANSCRIPTS.md');
  const fullNarration = fs.readFileSync(path.join(finalRoot, 'organizational-ai-memory-full-narration.txt'), 'utf8').trim();
  const liveNarration = fs.readFileSync(path.join(finalRoot, 'organizational-ai-memory-live-demo-narration.txt'), 'utf8').trim();
  atomicWrite(transcriptPath, `# Final Video Transcripts\n\nAll people, identities, and organizational records shown in these videos are synthetic public-safe demo data.\n\n## Live Pitch Demo\n\n${liveNarration}\n\n## Full P5 Judge Demo\n\n${fullNarration}\n`);

  const reportPath = path.join(finalRoot, 'final-video-build-report.json');
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    build_method: 'Deterministic FFmpeg scene assembly with straight cuts and burned-in WebVTT captions.',
    ffmpeg_version: run(ffmpeg, ['-version']).split('\n')[0],
    source_capture_report: relative(path.join(sourceRoot, 'public-interaction-capture-report.json')),
    voice_generation_report: relative(path.join(finalRoot, 'voice-generation-report.json')),
    disclosure: 'Synthetic public-safe demo data',
    metadata_policy: 'Input metadata is not mapped into final media.',
    builds: results,
    poster: {
      path: relative(posterPath),
      bytes: fs.statSync(posterPath).size,
      sha256: sha256(posterPath),
      width: 1920,
      height: 1080,
    },
    transcript: {
      path: relative(transcriptPath),
      bytes: fs.statSync(transcriptPath).size,
      sha256: sha256(transcriptPath),
    },
  };
  atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(reportPath);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
