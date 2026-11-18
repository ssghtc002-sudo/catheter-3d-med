/**
 * Medical Catheter Render Runner (/home/antigravity/catheter-3d-med/render/render_frames.mjs)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFastRender } from './fastRenderer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const args = new Set(process.argv.slice(2));
const qaMode = args.has('--qa-only');
const batchArg = [...args].find((a) => a.startsWith('--batch-size='));
const framesArg = [...args].find((a) => a.startsWith('--frames='));
const latencyArg = [...args].find((a) => a.startsWith('--latency='));
const batchSize = batchArg ? Number(batchArg.split('=')[1]) : 150;
const maxFrames = framesArg ? Number(framesArg.split('=')[1]) : null;
const latencyMode = latencyArg ? latencyArg.split('=')[1] : 'realtime';

await runFastRender({
  projectRoot: PROJECT_ROOT,
  mp4Filename: 'catheter_how_it_works.mp4',
  qaMode,
  workers: 1,
  batchSize,
  maxFrames,
  latencyMode,
  qaTimes: [1.5, 4.2, 7.6, 12.6, 15.0, 17.8, 20.2, 23.6, 27.6, 29.5],
});
