import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createApiApp } from './backend/app';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env only in local Node development
if (process.env.NETLIFY !== 'true') {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
}

const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = createApiApp();

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Gestão SST] Servidor local ativo em http://0.0.0.0:${PORT}`);
    console.log(
      '[Gestão SST] Agendamento diário configurado via Netlify Scheduled Function (netlify/functions/daily-notifications.ts).'
    );
  });
}

startServer().catch((err) => {
  console.error('[FATAL] Erro ao iniciar servidor:', err);
});
