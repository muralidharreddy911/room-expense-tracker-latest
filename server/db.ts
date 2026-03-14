import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error("CRITICAL ERROR: DATABASE_URL must be set. Did you forget to provision a database in Vercel Environment Variables?");
}

// Ensure fetch connections aren't cached indefinitely in serverless functions
neonConfig.fetchConnectionCache = true;

const sql = neon(process.env.DATABASE_URL || "postgresql://dummy_user:dummy_password@localhost/dummy_db");
export const db = drizzle(sql, { schema });
