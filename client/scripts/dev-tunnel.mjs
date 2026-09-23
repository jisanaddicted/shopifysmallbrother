// Starts Vite with VITE_API_URL / VITE_SOCKET_URL pointed at your Cloudflare
// tunnel URL, so the dev server on this PC talks to the tunneled backend and
// the phone (opening the tunnel URL) gets a working site.
//
// Usage:
//   1. expose-backend.bat            (prints https://xxx.trycloudflare.com)
//   2. npm --prefix client run dev:tunnel
//      -> paste the tunnel URL when asked (or set TUNNEL_URL env var)
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const preset = (process.env.TUNNEL_URL || '').trim();

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

let tunnel = preset;
if (!tunnel) {
  tunnel = (await ask('Paste the cloudflared tunnel URL (https://xxx.trycloudflare.com): ')).trim();
}
if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(tunnel)) {
  console.error(`That does not look like a quick-tunnel URL: "${tunnel}"`);
  process.exit(1);
}

const env = {
  ...process.env,
  VITE_API_URL: `${tunnel}/api`,
  VITE_SOCKET_URL: tunnel,
};

console.log(`[dev:tunnel] API    -> ${env.VITE_API_URL}`);
console.log(`[dev:tunnel] socket -> ${env.VITE_SOCKET_URL}`);
console.log('[dev:tunnel] starting Vite on :5173 (host 0.0.0.0, tunnel hosts allowed)...');

const vite = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', '5173'], {
  env,
  stdio: 'inherit',
  shell: true,
});
vite.on('exit', (code) => process.exit(code ?? 1));
