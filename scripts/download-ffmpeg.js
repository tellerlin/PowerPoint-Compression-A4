import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FFMPEG_FILES = [
  {
    url: 'https://unpkg.com/@ffmpeg/ffmpeg@0.10.1/dist/ffmpeg.min.js',
    filename: 'ffmpeg.min.js'
  },
  {
    url: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.js',
    filename: 'ffmpeg-core.js'
  },
  {
    url: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.wasm',
    filename: 'ffmpeg-core.wasm'
  },
  {
    url: 'https://unpkg.com/@ffmpeg/core@0.10.0/dist/ffmpeg-core.worker.js',
    filename: 'ffmpeg-core.worker.js'
  }
];

const FFMPEG_DIR = path.join(__dirname, '..', 'static', 'ffmpeg');

// 确保目录存在
if (!fs.existsSync(FFMPEG_DIR)) {
  fs.mkdirSync(FFMPEG_DIR, { recursive: true });
}

// 下载文件
FFMPEG_FILES.forEach(({ url, filename }) => {
  const filePath = path.join(FFMPEG_DIR, filename);
  console.log(`Downloading ${filename}...`);
  
  https.get(url, (response) => {
    const file = fs.createWriteStream(filePath);
    response.pipe(file);
    file.on('finish', () => {
      file.close();
      console.log(`Downloaded ${filename}`);
    });
  }).on('error', (err) => {
    console.error(`Error downloading ${filename}:`, err);
  });
}); 