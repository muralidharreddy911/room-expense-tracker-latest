import { neon, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Ensure fetch connections aren't cached indefinitely in serverless functions
neonConfig.fetchConnectionCache = true;

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, { schema });
