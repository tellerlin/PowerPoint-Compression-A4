import { createServer } from 'http';
import { readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5173;
const BUILD_DIR = join(__dirname, '..', '.svelte-kit', 'output', 'client');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

const server = createServer((req, res) => {
  // 添加安全头
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cross-Origin-Isolation', 'require-corp');

  let filePath = join(BUILD_DIR, req.url === '/' ? '/index.html' : req.url);
  const extname = String(path.extname(filePath)).toLowerCase();
  let contentType = MIME_TYPES[extname] || 'application/octet-stream';

  try {
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      filePath = join(filePath, 'index.html');
      contentType = 'text/html';
    }

    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 如果文件不存在，返回 index.html
      const content = readFileSync(join(BUILD_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content, 'utf-8');
    } else {
      res.writeHead(500);
      res.end(`Server Error: ${error.code}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
}); 