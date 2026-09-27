import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { files, source, output } from './files.mjs';

const directory = process.argv.includes('--dist') ? output : source;
const allowed = new Set(files.filter(file => !file.split('/').some(part => part.startsWith('_'))));
const port = Number(process.env.PORT || 4191);
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8'
};
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return;
  }
  let path;
  try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1); }
  catch { response.writeHead(400); response.end('Bad request'); return; }
  if (!path || path.endsWith('/')) path += 'index.html';
  else if (!allowed.has(path) && allowed.has(path + '/index.html')) {
    response.writeHead(302, { Location: `/${path}/` }); response.end(); return;
  } else if (!allowed.has(path) && allowed.has(path + '.html')) path += '.html';
  if (!allowed.has(path)) { response.writeHead(404); response.end('Not found'); return; }
  const file = resolve(directory, path);
  try {
    const { size } = await stat(file);
    const headers = { 'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Length': size, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff' };
    const match = request.method === 'GET' && /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
    let range;
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = !match[1] || !match[2] ? size - 1 : Math.min(Number(match[2]), size - 1);
      if (start >= size || end < start) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return;
      }
      range = { start, end };
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = end - start + 1;
    }
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file, range);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch { response.writeHead(404); response.end('Run npm run build before previewing dist/.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Moreyield: http://127.0.0.1:${port}/`));
