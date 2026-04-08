import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  console.error("CRITICAL ERROR: DATABASE_URL must be set. Did you forget to provision a database in Vercel Environment Variables?");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://dummy_user:dummy_password@localhost/dummy_db",
});

export const db = drizzle(pool, { schema });
