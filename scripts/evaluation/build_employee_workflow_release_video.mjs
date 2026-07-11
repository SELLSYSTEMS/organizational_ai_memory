import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONFIRMATION = 'BUILD_EMPLOYEE_WORKFLOW_RELEASE_VIDEO';
if (process.env.OAM_RELEASE_VIDEO_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set OAM_RELEASE_VIDEO_CONFIRM=${CONFIRMATION} to replace the release MP4.`);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const mediaRoot = path.join(repositoryRoot, 'artifacts', 'submission', 'media');
const inputVideo = path.resolve(process.argv[2]
  || path.join(mediaRoot, 'organizational-ai-memory-employee-workflow.webm'));
const proofImage = path.resolve(process.argv[3]
  || path.join(mediaRoot, 'screenshots', 'employee-workflow', '20-physical-agent-runtime-proof.png'));
const outputVideo = path.resolve(process.argv[4]
  || path.join(mediaRoot, 'organizational-ai-memory-employee-workflow.mp4'));
const temporaryOutput = `${outputVideo}.tmp-${process.pid}.mp4`;

for (const input of [inputVideo, proofImage]) {
  if (!fs.statSync(input).isFile()) throw new Error(`Required media input is not a file: ${input}`);
}

const filter = [
  '[0:v]fps=25,scale=1440:1000:force_original_aspect_ratio=decrease,pad=1440:1000:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,setpts=PTS-STARTPTS[browser]',
  '[1:v]fps=25,scale=1440:1000:force_original_aspect_ratio=decrease,pad=1440:1000:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,trim=duration=8,setpts=PTS-STARTPTS[proof]',
  '[browser][proof]concat=n=2:v=1:a=0[release]',
].join(';');

try {
  execFileSync(process.env.OAM_FFMPEG_PATH || '/usr/bin/ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', inputVideo,
    '-loop', '1',
    '-framerate', '25',
    '-t', '8',
    '-i', proofImage,
    '-filter_complex', filter,
    '-map', '[release]',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    temporaryOutput,
  ], { stdio: 'inherit' });
  fs.renameSync(temporaryOutput, outputVideo);
  console.log(path.relative(repositoryRoot, outputVideo));
} finally {
  fs.rmSync(temporaryOutput, { force: true });
}
