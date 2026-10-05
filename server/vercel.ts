// Ponto de entrada das funções serverless na Vercel (Build Output API, launcher Node.js).
// Cada rota /api/<nome> é uma função; todas compartilham este código.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApi } from './api.ts';

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://localhost');
  return handleApi(req, res, u);
}
