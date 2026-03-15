import express, { type Request, Response, NextFunction } from "express";
import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Raw SQL Client ───────────────────────────────────────────────────────────
// Using neon tagged-template SQL directly — compatible with @neondatabase/serverless v1.x
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

// ─── Seed Default Data ────────────────────────────────────────────────────────
async function seedDefaults() {
  const sql = getSql();

  // Create all tables if they don't exist
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      avatar TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      is_default BOOLEAN DEFAULT FALSE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS expenses (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      date TEXT NOT NULL,
      month TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category_id TEXT NOT NULL,
      paid_by TEXT NOT NULL,
      split_type TEXT NOT NULL,
      splits JSONB NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS month_status (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      month TEXT NOT NULL UNIQUE,
      is_locked BOOLEAN DEFAULT FALSE
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS settlements (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      month TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  // Seed Admin user if not exists
  const existing = await sql`SELECT id FROM users WHERE username = 'Admin' LIMIT 1`;
  if (existing.length === 0) {
    await sql`
      INSERT INTO users (username, name, password, role, avatar)
      VALUES (
        'Admin',
        'Admin',
        'Admin123',
        'admin',
        'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin'
      )
    `;
    console.log("✅ Default Admin user created.");

    // Seed categories
    const cats = ["Food", "Groceries", "Power", "Water", "Rent", "Internet", "Others"];
    for (const name of cats) {
      await sql`INSERT INTO categories (name, is_default) VALUES (${name}, TRUE)`;
    }
    console.log("✅ Default categories seeded.");
  }
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Diagnostic
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    hasDbUrl: !!process.env.DATABASE_URL,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/state
app.get("/api/state", async (_req: Request, res: Response) => {
  try {
    const sql = getSql();
    await seedDefaults();
    const [users, categories, expenses, monthStatus, settlements] = await Promise.all([
      sql`SELECT * FROM users ORDER BY name`,
      sql`SELECT *, is_default AS "isDefault" FROM categories ORDER BY name`,
      sql`SELECT *, category_id AS "categoryId", paid_by AS "paidBy", split_type AS "splitType", created_at AS "createdAt" FROM expenses ORDER BY created_at DESC`,
      sql`SELECT *, is_locked AS "isLocked" FROM month_status ORDER BY month`,
      sql`SELECT *, from_user AS "fromUser", to_user AS "toUser", created_at AS "createdAt" FROM settlements ORDER BY created_at DESC`,
    ]);
    res.json({ users, categories, expenses, monthStatus, settlements });
  } catch (e: any) {
    console.error("GET /api/state error:", e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/users
app.post("/api/users", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { username, name, password, role, avatar } = req.body;
    const [user] = await sql`
      INSERT INTO users (username, name, password, role, avatar)
      VALUES (${username}, ${name}, ${password}, ${role || "member"}, ${avatar || null})
      RETURNING *
    `;
    res.json(user);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:id
app.delete("/api/users/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    await sql`DELETE FROM users WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:id/password
app.put("/api/users/:id/password", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    await sql`UPDATE users SET password = ${req.body.password} WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/expenses
app.post("/api/expenses", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { date, month, description, amount, categoryId, paidBy, splitType, splits, createdAt } = req.body;
    const [item] = await sql`
      INSERT INTO expenses (date, month, description, amount, category_id, paid_by, split_type, splits, created_at)
      VALUES (${date}, ${month}, ${description}, ${amount}, ${categoryId}, ${paidBy}, ${splitType}, ${JSON.stringify(splits)}, ${createdAt})
      RETURNING *, category_id AS "categoryId", paid_by AS "paidBy", split_type AS "splitType", created_at AS "createdAt"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/expenses/:id
app.put("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { date, month, description, amount, categoryId, paidBy, splitType, splits } = req.body;
    const [item] = await sql`
      UPDATE expenses
      SET date=${date}, month=${month}, description=${description}, amount=${amount},
          category_id=${categoryId}, paid_by=${paidBy}, split_type=${splitType}, splits=${JSON.stringify(splits)}
      WHERE id = ${req.params.id}
      RETURNING *, category_id AS "categoryId", paid_by AS "paidBy", split_type AS "splitType", created_at AS "createdAt"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/expenses/:id
app.delete("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    await sql`DELETE FROM expenses WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/categories
app.post("/api/categories", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { name, isDefault } = req.body;
    const [item] = await sql`
      INSERT INTO categories (name, is_default) VALUES (${name}, ${isDefault || false})
      RETURNING *, is_default AS "isDefault"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/months
app.post("/api/months", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { month, isLocked } = req.body;
    const [item] = await sql`
      INSERT INTO month_status (month, is_locked) VALUES (${month}, ${isLocked})
      ON CONFLICT (month) DO UPDATE SET is_locked = EXCLUDED.is_locked
      RETURNING *, is_locked AS "isLocked"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settlements
app.post("/api/settlements", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { fromUser, toUser, amount, status, month, createdAt } = req.body;
    const [item] = await sql`
      INSERT INTO settlements (from_user, to_user, amount, status, month, created_at)
      VALUES (${fromUser}, ${toUser}, ${amount}, ${status || "pending"}, ${month}, ${createdAt})
      RETURNING *, from_user AS "fromUser", to_user AS "toUser", created_at AS "createdAt"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settlements/:id
app.put("/api/settlements/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const [item] = await sql`
      UPDATE settlements SET status = ${req.body.status} WHERE id = ${req.params.id}
      RETURNING *, from_user AS "fromUser", to_user AS "toUser", created_at AS "createdAt"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// ─── Vercel Export ────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}
