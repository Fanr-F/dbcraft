import { spawn } from 'node:child_process';
import electron from 'electron';

const child = spawn(electron, ['.'], {
  env: { ...process.env, DBCRAFT_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let finished = false;

child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

const timer = setTimeout(() => {
  if (finished) return;
  console.error('[smoke] timed out after 30s');
  child.kill();
  process.exitCode = 1;
}, 30_000);

child.on('error', (error) => {
  console.error('[smoke] failed to launch Electron:', error);
  if (!finished) process.exitCode = 1;
});

child.on('exit', (code) => {
  finished = true;
  clearTimeout(timer);
  if (code !== 0) {
    console.error(`[smoke] Electron exited with code ${code}`);
    process.exitCode = 1;
  }
});
