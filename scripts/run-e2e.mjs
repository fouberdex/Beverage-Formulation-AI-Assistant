import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const frontend = path.join(root, 'frontend');
const vite = path.join(frontend, 'node_modules', 'vite', 'bin', 'vite.js');
const playwright = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const server = spawn(process.execPath, [vite, '--mode', 'e2e', '--host', '127.0.0.1', '--port', '4173'], {
  cwd: frontend,
  detached: process.platform !== 'win32',
  stdio: 'ignore',
});

function stopServer() {
  if (!server.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`E2E server exited with code ${server.exitCode}`);
    try {
      const response = await fetch('http://127.0.0.1:4173');
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for the E2E server');
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopServer(); process.exit(1); });

let exitCode = 1;
try {
  await waitForServer();
  const tests = spawn(process.execPath, [playwright, 'test', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
  exitCode = await new Promise(resolve => tests.once('exit', code => resolve(code ?? 1)));
} finally {
  stopServer();
}
process.exit(exitCode);
