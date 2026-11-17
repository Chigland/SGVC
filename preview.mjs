// Local preview with byte ranges, so MP4 seeking behaves as on GitHub Pages.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8000);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };

http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400); return response.end(); }
  if (pathname === '/') { response.writeHead(302, { Location: '/SGVC/' }); return response.end(); }
  if (!pathname.startsWith('/SGVC/')) { response.writeHead(404); return response.end(); }
  const relative = pathname.slice('/SGVC/'.length) || 'index.html';
  const file = path.resolve(root, relative);
  const allowed = ['index.html', 'style.css', 'app.js'].includes(relative) || relative.startsWith('assets/');
  if (!allowed || !file.startsWith(root + path.sep) || relative.split('/').some(part => part.startsWith('.'))) {
    response.writeHead(404); return response.end();
  }
  let size;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('Not a file');
    size = stat.size;
  } catch { response.writeHead(404); return response.end(); }
  const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  let start = 0, end = size - 1;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), size - 1); }
    else if (range[2]) start = Math.max(0, size - Number(range[2]));
    if ((!range[1] && !range[2]) || start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }); return response.end();
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD' || size === 0) return response.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => response.destroy());
  stream.pipe(response);
  response.on('close', () => stream.destroy());
}).listen(port, '127.0.0.1', () => console.log(`SGVC preview: http://127.0.0.1:${port}/SGVC/`));
