import express, { type Request, Response, NextFunction } from "express";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { pgTable, text, varchar, boolean, jsonb, real } from "drizzle-orm/pg-core";
import { sql, eq } from "drizzle-orm";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Schema (inline to avoid import issues) ───────────────────────────────────
const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  password: text("password").notNull(),
  role: text("role").notNull().default("member"),
  avatar: text("avatar"),
});

const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false),
});

const monthStatus = pgTable("month_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: text("month").notNull().unique(),
  isLocked: boolean("is_locked").default(false),
});

const settlements = pgTable("settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUser: text("from_user").notNull(),
  toUser: text("to_user").notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"),
  month: text("month").notNull(),
  createdAt: text("created_at").notNull(),
});

const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(),
  month: text("month").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  categoryId: text("category_id").notNull(),
  paidBy: text("paid_by").notNull(),
  splitType: text("split_type").notNull(),
  splits: jsonb("splits").notNull(),
  createdAt: text("created_at").notNull(),
});

// ─── Database Setup ───────────────────────────────────────────────────────────
function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  neonConfig.fetchConnectionCache = true;
  const sqlClient = neon(url);
  return drizzle(sqlClient);
}

// ─── Seed Default Data ────────────────────────────────────────────────────────
async function seedDefaults() {
  const db = getDb();
  
  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(eq(users.username, "Admin"));

  if (!existingAdmin) {
    await db.insert(users).values({
      username: "Admin",
      name: "Admin",
      password: "Admin123",
      role: "admin",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin",
    });
    console.log("✅ Default Admin user created.");

    const defaultCats = ["Food", "Groceries", "Power", "Water", "Rent", "Internet", "Others"];
    for (const name of defaultCats) {
      await db.insert(categories).values({ name, isDefault: true });
    }
    console.log("✅ Default categories seeded.");
  }
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Diagnostic endpoint - check env vars without DB
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
    const db = getDb();
    await seedDefaults();
    const [allUsers, allCategories, allExpenses, allMonthStatus, allSettlements] =
      await Promise.all([
        db.select().from(users),
        db.select().from(categories),
        db.select().from(expenses),
        db.select().from(monthStatus),
        db.select().from(settlements),
      ]);
    res.json({
      users: allUsers,
      categories: allCategories,
      expenses: allExpenses,
      monthStatus: allMonthStatus,
      settlements: allSettlements,
    });
  } catch (e: any) {
    console.error("GET /api/state error:", e);
    res.status(500).json({ error: e.message || "Failed to load state" });
  }
});

// POST /api/users
app.post("/api/users", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [user] = await db.insert(users).values(req.body).returning();
    res.json(user);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:id
app.delete("/api/users/:id", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.delete(users).where(eq(users.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:id/password
app.put("/api/users/:id/password", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.update(users).set({ password: req.body.password }).where(eq(users.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/expenses
app.post("/api/expenses", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [item] = await db.insert(expenses).values(req.body).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/expenses/:id
app.put("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [item] = await db.update(expenses).set(req.body).where(eq(expenses.id, req.params.id)).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/expenses/:id
app.delete("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    await db.delete(expenses).where(eq(expenses.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/categories
app.post("/api/categories", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [item] = await db.insert(categories).values(req.body).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/months
app.post("/api/months", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { month, isLocked } = req.body;
    const [existing] = await db.select().from(monthStatus).where(eq(monthStatus.month, month));
    if (existing) {
      const [updated] = await db.update(monthStatus).set({ isLocked }).where(eq(monthStatus.id, existing.id)).returning();
      res.json(updated);
    } else {
      const [created] = await db.insert(monthStatus).values({ month, isLocked }).returning();
      res.json(created);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settlements
app.post("/api/settlements", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [item] = await db.insert(settlements).values(req.body).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settlements/:id
app.put("/api/settlements/:id", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [item] = await db.update(settlements).set({ status: req.body.status }).where(eq(settlements.id, req.params.id)).returning();
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
