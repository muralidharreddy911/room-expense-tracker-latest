import app, { setupApp } from '../server/index';
import type { VercelRequest, VercelResponse } from '@vercel/node';

let isInitialized = false;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isInitialized) {
    await setupApp();
    isInitialized = true;
  }
  return app(req as any, res as any);
}
