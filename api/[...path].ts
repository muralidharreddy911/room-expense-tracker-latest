import express, { type Request, Response, NextFunction } from "express";
import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Raw SQL Client ───────────────────────────────────────────────────────────
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

  // ── Migration: serial_no column ─────────────────────────────────────────────
  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS serial_no INTEGER`;

  // ── Fix 3: Recalculate serial_no to reset per month ─────────────────────────
  // Overwrite all serial_no values to ensure they monotonically increase per month
  await sql`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY month ORDER BY created_at ASC NULLS LAST) AS new_sn
      FROM expenses
    )
    UPDATE expenses
    SET serial_no = ranked.new_sn
    FROM ranked
    WHERE expenses.id = ranked.id
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
      created_at TEXT NOT NULL,
      settled_at TEXT
    )
  `;
  await sql`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS settled_at TEXT`;

  // ── STEP 1: Remove duplicate categories FIRST ───────────────────────────────
  // CRITICAL ORDER: This DELETE must run BEFORE the CREATE UNIQUE INDEX below.
  // PostgreSQL will reject CREATE UNIQUE INDEX if the table still has duplicates.
  // Previously this was reversed (index first, dedup second) which caused:
  //   ERROR: could not create unique index: Key (lower(name)) is duplicated
  // That exception crashed seedDefaults(), /api/state returned 500, and the
  // entire app appeared empty (even though all data was safe in the database).
  await sql`
    DELETE FROM categories
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM categories
      GROUP BY LOWER(name)
    )
  `;

  // ── STEP 2: Create unique index (now safe — no duplicates remain) ────────────
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_uq
    ON categories (LOWER(name))
  `;

  // ── Fix 1 + Admin: Use EXISTS instead of COUNT cast (avoids BigInt type issues)
  // Only seed if there are ZERO users (prevents re-seeding after admin deletion)
  const existing = await sql`SELECT 1 FROM users LIMIT 1`;
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
  }

  // ── Seed default categories only if none exist (idempotent) ─────────────────
  // ON CONFLICT (LOWER(name)) DO NOTHING prevents duplicates even if called multiple times
  const cats = ["Food", "Groceries", "Power", "Water", "Rent", "Internet", "Others"];
  for (const name of cats) {
    await sql`
      INSERT INTO categories (name, is_default)
      VALUES (${name}, TRUE)
      ON CONFLICT (LOWER(name)) DO NOTHING
    `;
  }
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    hasDbUrl: !!process.env.DATABASE_URL,
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ─── GET /api/state ───────────────────────────────────────────────────────────
app.get("/api/state", async (_req: Request, res: Response) => {
  try {
    const sql = getSql();
    await seedDefaults();
    const [users, categories, expenses, monthStatus, settlements] = await Promise.all([
      sql`SELECT * FROM users ORDER BY name`,
      sql`SELECT *, is_default AS "isDefault" FROM categories ORDER BY name`,
      sql`
        SELECT *,
          category_id  AS "categoryId",
          paid_by      AS "paidBy",
          split_type   AS "splitType",
          created_at   AS "createdAt",
          serial_no    AS "serialNo"
        FROM expenses
        ORDER BY serial_no ASC NULLS LAST, created_at ASC
      `,
      sql`SELECT *, is_locked AS "isLocked" FROM month_status ORDER BY month DESC`,
      sql`
        SELECT *,
          from_user  AS "fromUser",
          to_user    AS "toUser",
          created_at AS "createdAt",
          settled_at AS "settledAt"
        FROM settlements
        ORDER BY created_at DESC
      `,
    ]);
    res.json({ users, categories, expenses, monthStatus, settlements });
  } catch (e: any) {
    console.error("GET /api/state error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

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

app.delete("/api/users/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    await sql`DELETE FROM users WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/users/:id/password", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { password } = req.body;
    if (!password || typeof password !== "string" || password.trim().length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters long." });
    }
    const [updated] = await sql`
      UPDATE users SET password = ${password.trim()}
      WHERE id = ${req.params.id}
      RETURNING id, username, name, role, avatar
    `;
    if (!updated) return res.status(404).json({ error: "User not found." });
    console.log(`✅ Password updated for user ${updated.username}`);
    res.json({ success: true, user: updated });
  } catch (e: any) {
    console.error("PUT /api/users/:id/password error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Expenses ─────────────────────────────────────────────────────────────────

app.post("/api/expenses", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { date, month, description, amount, categoryId, paidBy, splitType, splits, createdAt } = req.body;

    // 1. Check if month is locked
    const [monthLock] = await sql`
      SELECT is_locked FROM month_status WHERE month = ${month} LIMIT 1
    `;
    if (monthLock?.is_locked) {
      return res.status(403).json({ error: `Month ${month} is locked. Cannot add expenses.` });
    }

    // 2. Calculate next serial number scoped by month
    // Number() cast handles cases where Neon returns BigInt for arithmetic results
    const [serialRow] = await sql`
      SELECT COALESCE(MAX(serial_no), 0) + 1 AS next_serial FROM expenses WHERE month = ${month}
    `;
    const next_serial = Number(serialRow.next_serial);

    // 3. Insert (let DB generate UUID for id)
    const [item] = await sql`
      INSERT INTO expenses
        (date, month, description, amount, category_id, paid_by, split_type, splits, created_at, serial_no)
      VALUES
        (${date}, ${month}, ${description}, ${amount}, ${categoryId}, ${paidBy},
         ${splitType}, ${JSON.stringify(splits)}, ${createdAt}, ${next_serial})
      RETURNING *,
        category_id AS "categoryId",
        paid_by     AS "paidBy",
        split_type  AS "splitType",
        created_at  AS "createdAt",
        serial_no   AS "serialNo"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const {
      date, month, description, amount, categoryId, paidBy, splitType, splits,
      requestingUserId,
    } = req.body;

    // 1. Fetch existing expense
    const [expense] = await sql`
      SELECT id, month, paid_by FROM expenses WHERE id = ${req.params.id}
    `;
    if (!expense) return res.status(404).json({ error: "Expense not found." });

    // 2. Ownership check
    if (requestingUserId && expense.paid_by !== requestingUserId) {
      return res.status(403).json({ error: "Unauthorized: You can only edit your own expenses." });
    }

    // 3. Month lock check (uses the expense's CURRENT month)
    const [monthLock] = await sql`
      SELECT is_locked FROM month_status WHERE month = ${expense.month} LIMIT 1
    `;
    if (monthLock?.is_locked) {
      return res.status(403).json({
        error: `Month ${expense.month} is locked. Cannot edit expenses.`,
      });
    }

    const [item] = await sql`
      UPDATE expenses
      SET
        date        = ${date},
        month       = ${month},
        description = ${description},
        amount      = ${amount},
        category_id = ${categoryId},
        paid_by     = ${paidBy},
        split_type  = ${splitType},
        splits      = ${JSON.stringify(splits)}
      WHERE id = ${req.params.id}
      RETURNING *,
        category_id AS "categoryId",
        paid_by     AS "paidBy",
        split_type  AS "splitType",
        created_at  AS "createdAt",
        serial_no   AS "serialNo"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();

    const [expense] = await sql`
      SELECT id, month, paid_by FROM expenses WHERE id = ${req.params.id}
    `;
    if (!expense) return res.status(404).json({ error: "Expense not found." });

    const requestingUserId = req.query.userId as string;
    if (!requestingUserId) {
      return res.status(400).json({ error: "userId query parameter is required." });
    }
    if (expense.paid_by !== requestingUserId) {
      return res.status(403).json({ error: "Unauthorized: You can only delete your own expenses." });
    }

    const [monthLock] = await sql`
      SELECT is_locked FROM month_status WHERE month = ${expense.month} LIMIT 1
    `;
    if (monthLock?.is_locked) {
      return res.status(403).json({
        error: `Month ${expense.month} is locked. Deletion is not allowed.`,
      });
    }

    await sql`DELETE FROM expenses WHERE id = ${req.params.id}`;
    console.log(`✅ Expense ${req.params.id} deleted by user ${requestingUserId}`);
    res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /api/expenses/:id error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────

app.post("/api/categories", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { name, isDefault } = req.body;
    // Case-insensitive duplicate check
    const existing = await sql`
      SELECT id FROM categories WHERE LOWER(name) = LOWER(${name}) LIMIT 1
    `;
    if (existing.length > 0) {
      return res.status(409).json({ error: "Category already exists." });
    }
    const [item] = await sql`
      INSERT INTO categories (name, is_default) VALUES (${name}, ${isDefault || false})
      RETURNING *, is_default AS "isDefault"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/categories/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const usedIn = await sql`
      SELECT id FROM expenses WHERE category_id = ${req.params.id} LIMIT 1
    `;
    if (usedIn.length > 0) {
      return res.status(409).json({
        error: "Category is used in existing expenses and cannot be deleted.",
      });
    }
    await sql`DELETE FROM categories WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Months ───────────────────────────────────────────────────────────────────

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

// DELETE /api/months/:month — unlock (admin can re-open a locked month)
app.delete("/api/months/:month", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { month } = req.params;
    const [item] = await sql`
      UPDATE month_status SET is_locked = FALSE WHERE month = ${month}
      RETURNING *, is_locked AS "isLocked"
    `;
    if (!item) return res.status(404).json({ error: "Month not found." });
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Settlements ──────────────────────────────────────────────────────────────

app.post("/api/settlements", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { fromUser, toUser, amount, status, month, createdAt } = req.body;
    const [item] = await sql`
      INSERT INTO settlements (from_user, to_user, amount, status, month, created_at)
      VALUES (${fromUser}, ${toUser}, ${amount}, ${status || "paid"}, ${month}, ${createdAt})
      RETURNING *,
        from_user  AS "fromUser",
        to_user    AS "toUser",
        created_at AS "createdAt",
        settled_at AS "settledAt"
    `;
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/settlements/:id", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const newStatus = req.body.status;
    const settledAt = newStatus === "paid" ? new Date().toISOString() : null;
    const [item] = await sql`
      UPDATE settlements
      SET status     = ${newStatus},
          settled_at = ${settledAt}
      WHERE id = ${req.params.id}
      RETURNING *,
        from_user  AS "fromUser",
        to_user    AS "toUser",
        created_at AS "createdAt",
        settled_at AS "settledAt"
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
