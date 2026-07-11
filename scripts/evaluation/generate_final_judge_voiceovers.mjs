import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIRMATION = 'GENERATE_FINAL_JUDGE_VOICEOVERS';
if (process.env.OAM_FINAL_VIDEO_VOICE_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set OAM_FINAL_VIDEO_VOICE_CONFIRM=${CONFIRMATION} to generate the final voiceovers.`);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const outputDirectory = path.join(
  repositoryRoot,
  'artifacts',
  'submission',
  'media',
  'final-judge-video',
);
const keyPath = process.env.ELEVENLABS_KEY_FILE || '/root/.env-elevenlabs';
const voiceId = process.env.ELEVENLABS_VOICE_ID || 'HsgAn6u75ZbG3h23K3dR';
const modelId = 'eleven_multilingual_v2';
const outputFormat = 'mp3_44100_128';
const voiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
  speed: 1,
};

const jobs = [
  {
    id: 'full',
    input: 'organizational-ai-memory-full-narration.txt',
    audio: 'organizational-ai-memory-full-narration.mp3',
    alignment: 'organizational-ai-memory-full-narration-alignment.json',
    captions: 'organizational-ai-memory-full-narration.vtt',
  },
  {
    id: 'live-demo',
    input: 'organizational-ai-memory-live-demo-narration.txt',
    audio: 'organizational-ai-memory-live-demo-narration.mp3',
    alignment: 'organizational-ai-memory-live-demo-narration-alignment.json',
    captions: 'organizational-ai-memory-live-demo-narration.vtt',
  },
];
const requestedJobIds = new Set(
  (process.env.OAM_FINAL_VIDEO_VOICE_JOBS || jobs.map((job) => job.id).join(','))
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);
if (!requestedJobIds.size
    || [...requestedJobIds].some((id) => !jobs.some((job) => job.id === id))) {
  throw new Error('OAM_FINAL_VIDEO_VOICE_JOBS contains an unknown or empty job selection.');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function atomicWrite(destination, data) {
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function validateKeyFile(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('ElevenLabs credential must be a regular, non-symlink file.');
  }
  if (stat.uid !== 0 || (stat.mode & 0o077) !== 0) {
    throw new Error('ElevenLabs credential must be owned by root with no group or other permissions.');
  }
}

function formatVttTime(seconds) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function wrapCaption(text, maxLineLength = 42) {
  if (text.length <= maxLineLength) return text;
  const words = text.split(/\s+/u);
  let best = null;
  for (let split = 1; split < words.length; split += 1) {
    const first = words.slice(0, split).join(' ');
    const second = words.slice(split).join(' ');
    if (first.length > maxLineLength || second.length > maxLineLength) continue;
    const score = Math.abs(first.length - second.length);
    if (!best || score < best.score) best = { first, second, score };
  }
  if (!best) throw new Error(`Caption cannot fit in two ${maxLineLength}-character lines: ${text}`);
  return `${best.first}\n${best.second}`;
}

function makeCaptions(alignment) {
  const characters = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (!Array.isArray(characters) || characters.length === 0
      || characters.length !== starts?.length || characters.length !== ends?.length) {
    throw new Error('ElevenLabs returned an invalid normalized character alignment.');
  }

  const text = characters.join('');
  const words = [...text.matchAll(/\S+/gu)].map((match) => ({
    text: match[0],
    startIndex: match.index,
    endIndex: match.index + match[0].length - 1,
  }));
  if (words.length === 0) throw new Error('ElevenLabs alignment contains no words.');

  const cues = [];
  let cursor = 0;
  while (cursor < words.length) {
    let end = cursor;
    let lastSentenceBoundary = null;
    let lastSoftBoundary = null;
    while (end < words.length) {
      const candidate = words.slice(cursor, end + 1).map((word) => word.text).join(' ');
      if (candidate.length > 78 && end > cursor) break;
      if (/[.!?]["')]*$/u.test(words[end].text)) lastSentenceBoundary = end;
      if (/[,;:]["')]*$/u.test(words[end].text)) lastSoftBoundary = end;
      end += 1;
      if (candidate.length >= 55 && lastSentenceBoundary === end - 1) break;
    }

    let finalEnd = Math.max(cursor, end - 1);
    if (lastSentenceBoundary !== null && lastSentenceBoundary >= cursor) {
      finalEnd = lastSentenceBoundary;
    } else if (lastSoftBoundary !== null && lastSoftBoundary >= cursor && finalEnd - lastSoftBoundary <= 3) {
      finalEnd = lastSoftBoundary;
    }

    let cueText;
    let wrappedText;
    while (finalEnd >= cursor) {
      cueText = words.slice(cursor, finalEnd + 1).map((word) => word.text).join(' ');
      try {
        wrappedText = wrapCaption(cueText);
        break;
      } catch (error) {
        if (finalEnd === cursor) throw error;
        finalEnd -= 1;
      }
    }
    const firstWord = words[cursor];
    const lastWord = words[finalEnd];
    const start = Number(starts[firstWord.startIndex]);
    const endTime = Number(ends[lastWord.endIndex]);
    if (!Number.isFinite(start) || !Number.isFinite(endTime) || endTime <= start) {
      throw new Error('ElevenLabs returned non-monotonic caption timestamps.');
    }
    cues.push({ start, end: endTime, text: wrappedText });
    cursor = finalEnd + 1;
  }

  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].start < cues[index - 1].end) {
      cues[index].start = cues[index - 1].end;
    }
    if (cues[index].end <= cues[index].start) {
      throw new Error('Caption normalization produced an empty cue.');
    }
  }

  const body = cues.map((cue, index) => [
    String(index + 1),
    `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}`,
    cue.text,
  ].join('\n')).join('\n\n');
  return {
    vtt: `WEBVTT\n\n${body}\n`,
    cueCount: cues.length,
    durationSeconds: Number(ends.at(-1)),
    maxLines: Math.max(...cues.map((cue) => cue.text.split('\n').length)),
    maxLineLength: Math.max(...cues.flatMap((cue) => cue.text.split('\n').map((line) => line.length))),
  };
}

async function synthesize({ text, apiKey }) {
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`);
  url.searchParams.set('output_format', outputFormat);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({ text, model_id: modelId, voice_settings: voiceSettings }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs synthesis failed with HTTP ${response.status}.`);
  }
  const payload = await response.json();
  if (typeof payload.audio_base64 !== 'string' || !payload.normalized_alignment) {
    throw new Error('ElevenLabs response omitted audio or normalized alignment.');
  }
  return payload;
}

validateKeyFile(keyPath);
const apiKey = fs.readFileSync(keyPath, 'utf8').trim();
if (!apiKey || /\s/u.test(apiKey)) throw new Error('ElevenLabs credential has an invalid format.');
fs.mkdirSync(outputDirectory, { recursive: true });

const reportPath = path.join(outputDirectory, 'voice-generation-report.json');
const generatedById = new Map();
if (requestedJobIds.size < jobs.length && fs.existsSync(reportPath)) {
  const priorReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (priorReport.provider !== 'ElevenLabs' || priorReport.voice_id !== voiceId
      || priorReport.model_id !== modelId || priorReport.output_format !== outputFormat) {
    throw new Error('Existing voice report is incompatible with a partial regeneration.');
  }
  for (const prior of priorReport.generated || []) {
    if (!requestedJobIds.has(prior.id)) generatedById.set(prior.id, prior);
  }
}
for (const job of jobs) {
  if (!requestedJobIds.has(job.id)) continue;
  const inputPath = path.join(outputDirectory, job.input);
  const text = fs.readFileSync(inputPath, 'utf8').trim();
  if (!text) throw new Error(`Narration is empty: ${job.input}`);
  const payload = await synthesize({ text, apiKey });
  const audio = Buffer.from(payload.audio_base64, 'base64');
  if (audio.length < 10_000) throw new Error(`Generated audio is unexpectedly small: ${job.audio}`);
  const captions = makeCaptions(payload.normalized_alignment);

  const alignmentDocument = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source_narration: job.input,
    voice_id: voiceId,
    model_id: modelId,
    output_format: outputFormat,
    normalized_alignment: payload.normalized_alignment,
  };
  const alignmentBytes = Buffer.from(`${JSON.stringify(alignmentDocument, null, 2)}\n`);
  const captionBytes = Buffer.from(captions.vtt);
  atomicWrite(path.join(outputDirectory, job.audio), audio);
  atomicWrite(path.join(outputDirectory, job.alignment), alignmentBytes);
  atomicWrite(path.join(outputDirectory, job.captions), captionBytes);

  generatedById.set(job.id, {
    id: job.id,
    source_narration: job.input,
    word_count: text.split(/\s+/u).length,
    audio: { path: job.audio, bytes: audio.length, sha256: sha256(audio) },
    alignment: { path: job.alignment, bytes: alignmentBytes.length, sha256: sha256(alignmentBytes) },
    captions: {
      path: job.captions,
      bytes: captionBytes.length,
      sha256: sha256(captionBytes),
      cue_count: captions.cueCount,
      aligned_duration_seconds: captions.durationSeconds,
      max_lines: captions.maxLines,
      max_line_length: captions.maxLineLength,
    },
  });
}

const generated = jobs.map((job) => generatedById.get(job.id));
if (generated.some((item) => !item)) {
  throw new Error('Partial voice regeneration could not retain every required job.');
}
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  provider: 'ElevenLabs',
  voice_id: voiceId,
  model_id: modelId,
  output_format: outputFormat,
  voice_settings: voiceSettings,
  generation_scope: [...requestedJobIds],
  credential_source: 'root-owned local file (not copied or logged)',
  generated,
};
atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(path.relative(repositoryRoot, reportPath));
