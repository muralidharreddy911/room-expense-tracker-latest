import app, { setupApp } from '../server/index';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Call it synchronously outside the handler so the cold start is instantaneous
setupApp().catch(console.error);

export default app;
