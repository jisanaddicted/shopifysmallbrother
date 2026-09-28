// Screenshot a page through the DevTools protocol, because a headless Edge
// screenshot taken any other way clips and mis-measures. Emulation is set
// explicitly so what is captured is the size asked for.
//
//   node scripts/shot.mjs <url> <out.png> [width] [height] [fullPage]
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, out, w = '1280', h = '900', full = 'false'] = process.argv.slice(2);
const PORT = 9222 + Math.floor(Math.random() * 400);

// The browser is not on PATH, so look it up rather than assuming `msedge` works.
const EDGE_CANDIDATES = [
  process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
].filter(Boolean);

const edgeExe = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edgeExe) {
  console.error('No Edge found. Looked in:\n  ' + EDGE_CANDIDATES.join('\n  '));
  process.exit(1);
}

const edge = spawn(edgeExe, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--user-data-dir=' + process.env.TEMP + `\\cdp-${PORT}`,
  'about:blank',
], { stdio: 'ignore' });

const cleanup = () => { try { edge.kill(); } catch {} };
process.on('exit', cleanup);

async function targets() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(300);
  }
  throw new Error('Edge did not expose a debugging target');
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

await new Promise((resolve) => ws.addEventListener('open', resolve));

await send('Emulation.setDeviceMetricsOverride', {
  width: Number(w),
  height: Number(h),
  deviceScaleFactor: 1,
  mobile: Number(w) < 700,
});
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

// Collected and printed at the end: a blank screenshot is useless on its own,
// and the console is the only place that says why the page is empty.
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'exception');
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(`${msg.params.entry.text} ${msg.params.entry.url || ''}`.trim());
  }
});

// An optional JWT, so a signed-in page (the merchant's product form) can be
// captured. It is set on the ORIGIN first and only then navigates to the target,
// because localStorage is per-origin and the app reads the token while booting -
// a token written after the app has mounted would be ignored.
const tokenFile = process.env.SHOT_TOKEN_FILE;
if (tokenFile && existsSync(tokenFile)) {
  // The app restores a session from THREE localStorage keys, not just the JWT -
  // saveSession() writes `da.token` AND `da.user`, and the dashboard layout
  // reads the store list from `da.stores`. Setting only the token leaves
  // ProtectedRoute bouncing straight back to the login page.
  const session = JSON.parse(readFileSync(tokenFile, 'utf8'));
  await send('Page.navigate', { url: new URL(url).origin });
  await sleep(1500);
  const set = await send('Runtime.evaluate', {
    expression: `(() => {
      localStorage.setItem('da.token', ${JSON.stringify(session.token)});
      localStorage.setItem('da.user', ${JSON.stringify(JSON.stringify(session.user))});
      ${session.stores ? `localStorage.setItem('da.stores', ${JSON.stringify(JSON.stringify(session.stores))});` : ''}
      return localStorage.getItem('da.token') ? 'session set' : 'FAILED';
    })()`,
    returnByValue: true,
  });
  console.log(`  auth: ${set.result?.value}`);
}

await send('Page.navigate', { url });
// The Vite dev server compiles modules on first request, so the first paint of
// any route is slower than a production build. 9s is comfortably past it.
await sleep(9000);

// Optional interaction, passed as `click:<text>`. Needed to prove the picker's
// REACTIVE behaviour - picking a size greying out a colour that is not made in
// it - which a single static screenshot cannot show.
// `scroll:<selector>` scrolls an element into view, for the merchant form where
// the matrix sits well below the fold.
// argv: [node, script, url, out, width, height, fullPage, click, scroll]
const clickArg = process.argv[7];
const scrollArg = process.argv[8];
if (clickArg) {
  const wanted = clickArg.replace(/^click:/, '');
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => {
      const nodes = [...document.querySelectorAll('button')];
      const byText = nodes.find(n => n.textContent.trim() === ${JSON.stringify(wanted)});
      const target = byText || document.querySelector(${JSON.stringify(wanted)});
      if (!target) return 'NOT FOUND';
      target.click();
      return 'clicked "' + (target.textContent || '').trim() + '"';
    })()`,
    returnByValue: true,
  });
  await sleep(1500);
  console.log(`  click ${wanted}: ${clicked.result?.value}`);
}
// Scrolling happens AFTER the click on purpose: clicking "Edit" swaps the form
// in, so the matrix only exists afterwards. Scrolling first would find nothing.
if (scrollArg) {
  const sel = scrollArg.replace(/^scroll:/, '');
  const moved = await send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 'NOT FOUND';
      el.scrollIntoView({ block: 'center' });
      return 'scrolled to ' + ${JSON.stringify(sel)};
    })()`,
    returnByValue: true,
  });
  await sleep(800);
  console.log(`  ${moved.result?.value}`);
}

if (full === 'true') {
  const { cssContentSize } = await send('Page.getLayoutMetrics');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(w),
    height: Math.ceil(cssContentSize.height),
    deviceScaleFactor: 1,
    mobile: Number(w) < 700,
  });
  await sleep(900);
}

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));

// Horizontal overflow is the check that matters most for a responsive change.
const overflow = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth})',
  returnByValue: true,
});

// A blank screenshot is ambiguous - this says whether React actually mounted
// and how much text is on screen, which separates "still compiling" from
// "rendered an empty page" from "crashed".
const body = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    text: (document.body.innerText || '').replace(/\\s+/g,' ').trim().slice(0,160),
    rootChildren: (document.getElementById('root')||{}).childElementCount || 0
  })`,
  returnByValue: true,
});

console.log(`${out} saved. overflow: ${overflow.result?.value}`);
console.log(`  body: ${body.result?.value}`);
if (consoleErrors.length) {
  console.log('console errors:');
  for (const e of [...new Set(consoleErrors)].slice(0, 8)) console.log(`  - ${e}`);
}
cleanup();
process.exit(0);
