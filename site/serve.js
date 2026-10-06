/* Tiny static server for the Zuno One marketing site. Run: node site/serve.js */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  let file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(file) && !path.extname(file)) file += '.html';   // /pricing -> /pricing.html
  fs.readFile(file, (err, buf) => {
    if (err) {
      const nf = path.join(ROOT, '404.html');
      if (fs.existsSync(nf)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(nf)); }
      res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 — ' + rel);
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Zuno One site → http://localhost:${PORT}`));
