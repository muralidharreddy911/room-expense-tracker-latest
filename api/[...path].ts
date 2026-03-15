import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../shared/schema";
import { users, categories, monthStatus, settlements, expenses } from "../shared/schema";
import { eq } from "drizzle-orm";
import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Database Setup ───────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set!");
}

neonConfig.fetchConnectionCache = true;
const sql = neon(DATABASE_URL!);
const db = drizzle(sql, { schema });

// ─── Express App ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ─── Seed Default Data ────────────────────────────────────────────────
async function seedDefaults() {
  try {
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

      // Seed default categories
      const defaultCategories = [
        "Food", "Groceries", "Power", "Water", "Rent", "Internet", "Others"
      ];
      for (const name of defaultCategories) {
        await db.insert(categories).values({ name, isDefault: true });
      }
      console.log("✅ Default categories seeded.");
    }
  } catch (err) {
    console.error("Seeding error:", err);
  }
}

// ─── API Routes ───────────────────────────────────────────────────────

// GET /api/state - returns full app state
app.get("/api/state", async (_req: Request, res: Response) => {
  try {
    await seedDefaults(); // Ensure Admin exists on first call
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
    const [user] = await db.insert(users).values(req.body).returning();
    res.json(user);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:id
app.delete("/api/users/:id", async (req: Request, res: Response) => {
  try {
    await db.delete(users).where(eq(users.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:id/password
app.put("/api/users/:id/password", async (req: Request, res: Response) => {
  try {
    await db
      .update(users)
      .set({ password: req.body.password })
      .where(eq(users.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/expenses
app.post("/api/expenses", async (req: Request, res: Response) => {
  try {
    const [item] = await db.insert(expenses).values(req.body).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/expenses/:id
app.put("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    const [item] = await db
      .update(expenses)
      .set(req.body)
      .where(eq(expenses.id, req.params.id))
      .returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/expenses/:id
app.delete("/api/expenses/:id", async (req: Request, res: Response) => {
  try {
    await db.delete(expenses).where(eq(expenses.id, req.params.id));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/categories
app.post("/api/categories", async (req: Request, res: Response) => {
  try {
    const [item] = await db.insert(categories).values(req.body).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/months
app.post("/api/months", async (req: Request, res: Response) => {
  try {
    const { month, isLocked } = req.body;
    const [existing] = await db
      .select()
      .from(monthStatus)
      .where(eq(monthStatus.month, month));

    if (existing) {
      const [updated] = await db
        .update(monthStatus)
        .set({ isLocked })
        .where(eq(monthStatus.id, existing.id))
        .returning();
      res.json(updated);
    } else {
      const [created] = await db
        .insert(monthStatus)
        .values({ month, isLocked })
        .returning();
      res.json(created);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/settlements
app.post("/api/settlements", async (req: Request, res: Response) => {
  try {
    const [item] = await db.insert(settlements).values(req.body).returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/settlements/:id
app.put("/api/settlements/:id", async (req: Request, res: Response) => {
  try {
    const [item] = await db
      .update(settlements)
      .set({ status: req.body.status })
      .where(eq(settlements.id, req.params.id))
      .returning();
    res.json(item);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Error Handler ────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

// ─── Vercel Handler ───────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  return app(req as any, res as any);
}
