import app, { setupApp } from '../server/index';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ensure the app is initialized before handling requests
  await setupApp();
  // Express handles the request and sends the response
  return app(req as any, res as any);
}
