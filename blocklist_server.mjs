import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.JOBRIGHT_BLOCKLIST_PORT || 17373);
const DATA_FILE = process.env.JOBRIGHT_BLOCKLIST_FILE ||
  join(dirname(fileURLToPath(import.meta.url)), 'shared_blocklist.json');

function normalizeCompany(name) {
  return String(name || '').toLowerCase().trim();
}

function normalizeBlocklist(list) {
  return [...new Set((list || []).map(normalizeCompany).filter(Boolean))].sort();
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

    return sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`JobRight shared blocklist listening on http://127.0.0.1:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
