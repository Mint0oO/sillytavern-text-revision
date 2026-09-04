import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (name === '/' ? '/dev/harness.html' : name));
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || name.includes('/.')) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store'); res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(8788, '127.0.0.1', () => console.log('Preview http://127.0.0.1:8788'));
