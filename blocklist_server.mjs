import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.JOBRIGHT_BLOCKLIST_PORT || 17373);
const DATA_FILE = process.env.JOBRIGHT_BLOCKLIST_FILE ||
  join(dirname(fileURLToPath(import.meta.url)), 'shared_blocklist.json');
const WINDOWS_ONEDRIVE = process.env.OneDriveConsumer || process.env.OneDrive;
const DEFAULT_DESKTOP_DIR =
  process.platform === 'win32' &&
  WINDOWS_ONEDRIVE &&
  existsSync(join(WINDOWS_ONEDRIVE, 'Desktop'))
    ? join(WINDOWS_ONEDRIVE, 'Desktop')
    : join(homedir(), 'Desktop');
const SCREENSHOT_DIR = process.env.JOBRIGHT_SCREENSHOT_DIR ||
  join(DEFAULT_DESKTOP_DIR, 'SS');

function normalizeCompany(name) {
  return String(name || '').toLowerCase().trim();
}

const BLOCKLIST_COMPANY_MIGRATION_REMOVALS = new Set([
  'airbn',
  'airbnb',
  'braintrust',
  'delta dental of new jersey and connecticut',
  'lyft',
  'mutual of omaha mortgage',
  'zynga',
]);

function normalizeBlocklist(list) {
  return [...new Set((list || [])
    .map(normalizeCompany)
    .filter(company => company && !BLOCKLIST_COMPANY_MIGRATION_REMOVALS.has(company)))].sort();
}

async function readBlocklist() {
  try {
    const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    return normalizeBlocklist(data.blocklist || []);
  } catch {
    return [];
  }
}

async function writeBlocklist(blocklist) {
  const normalized = normalizeBlocklist(blocklist);
  await writeFile(DATA_FILE, `${JSON.stringify({ blocklist: normalized }, null, 2)}\n`);
  return normalized;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function safeFilename(value = '') {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || `JobRight Stuck ${Date.now()}.png`;
}

async function saveScreenshot(body = {}) {
  const match = String(body.dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error('invalid PNG screenshot data');
  const filename = safeFilename(body.filename);
  const finalName = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  await mkdir(SCREENSHOT_DIR, { recursive: true });
  const file = join(SCREENSHOT_DIR, finalName);
  await writeFile(file, Buffer.from(match[1], 'base64'));
  return file;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return sendJson(res, 204, {});

    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true });

    if (url.pathname === '/blocklist' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, blocklist: await readBlocklist() });
    }

    if (url.pathname === '/blocklist/add' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const current = await readBlocklist();
      return sendJson(res, 200, { ok: true, blocklist: await writeBlocklist([...current, body.company]) });
    }

    if (url.pathname === '/blocklist/remove' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const remove = normalizeCompany(body.company);
      const current = await readBlocklist();
      return sendJson(res, 200, { ok: true, blocklist: await writeBlocklist(current.filter(c => c !== remove)) });
    }

    if (url.pathname === '/blocklist/replace' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { ok: true, blocklist: await writeBlocklist(body.blocklist || []) });
    }

    if (url.pathname === '/screenshot' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { ok: true, file: await saveScreenshot(body) });
    }

    return sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`JobRight shared blocklist listening on http://127.0.0.1:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`Screenshot directory: ${SCREENSHOT_DIR}`);
});
