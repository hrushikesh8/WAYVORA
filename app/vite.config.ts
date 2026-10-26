import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'test-export-sink',
      configureServer(server) {
        server.middlewares.use('/api/test-fixture-video', (_req, res) => {
          const filePath = path.resolve(process.cwd(), 'test-artifacts/real_valid_action.mp4');
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', stat.size);
            fs.createReadStream(filePath).pipe(res);
          } else {
            res.statusCode = 404;
            res.end('Fixture not found');
          }
        });
        server.middlewares.use('/api/save-test-export', (req, res) => {
          if (req.method === 'POST') {
            const rawFilename = (req.headers['x-filename'] as string) || 'exported_test_video.mp4';
            const filename = path.basename(rawFilename).replace(/[^a-zA-Z0-9._-]/g, '_') || 'exported_test_video.mp4';
            const targetDir = path.resolve(process.cwd(), 'test-artifacts');
            fs.mkdirSync(targetDir, { recursive: true });
            const filePath = path.join(targetDir, filename);
            const fileStream = fs.createWriteStream(filePath);
            req.pipe(fileStream);
            fileStream.on('finish', () => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, path: filePath, size: fs.statSync(filePath).size }));
            });
            return;
          }
          res.statusCode = 404;
          res.end();
        });
      },
    },
  ],
})
