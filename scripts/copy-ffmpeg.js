import { copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const sourceDir = join(rootDir, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const targetDir = join(rootDir, 'static', 'ffmpeg');

const filesToCopy = [
    'ffmpeg-core.js',
    'ffmpeg-core.wasm'
];

async function copyFiles() {
    try {
        // Create target directory if it doesn't exist
        await mkdir(targetDir, { recursive: true });

        // Copy each file
        for (const file of filesToCopy) {
            const sourcePath = join(sourceDir, file);
            const targetPath = join(targetDir, file);
            await copyFile(sourcePath, targetPath);
            console.log(`Copied ${file} successfully`);
        }
    } catch (error) {
        console.error('Error copying files:', error);
        process.exit(1);
    }
}

copyFiles(); 