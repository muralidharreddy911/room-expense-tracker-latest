import express, { type Request, Response, NextFunction } from "express";
import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import TelegramBot from "node-telegram-bot-api";
import { format } from "date-fns";
import { parseExpenseMessage, inferCategory, type ParsedExpenseDraft, type ParserUser } from "../server/services/expense-parser";

// ─── Raw SQL Client ───────────────────────────────────────────────────────────
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

// ─── Telegram Bot Helpers ─────────────────────────────────────────────────────
interface BotUser {
  id: string;
  name: string;
  username: string;
  role: string;
}

interface BotCategory {
  id: string;
  name: string;
}

function findUserByTelegramName(users: BotUser[], telegramFirstName: string, telegramUsername?: string): BotUser | undefined {
  const firstName = telegramFirstName.toLowerCase();
  let user = users.find((u) => u.name.toLowerCase() === firstName);
  if (user) return user;
  user = users.find((u) => u.name.toLowerCase().startsWith(firstName));
  if (user) return user;
  if (telegramUsername) {
    const username = telegramUsername.toLowerCase();
    user = users.find((u) => u.username?.toLowerCase() === username || u.name.toLowerCase() === username);
  }
  return user;
}

function buildEqualSplits(participants: Array<{ id: string }>, amount: number): { userId: string; amount: number }[] {
  if (participants.length === 0) return [];
  const equal = Math.round((amount / participants.length) * 100) / 100;
  const splits = participants.map((p) => ({ userId: p.id, amount: equal }));
  const currentTotal = splits.reduce((sum, s) => sum + s.amount, 0);
  const diff = Math.round((amount - currentTotal) * 100) / 100;
  if (Math.abs(diff) > 0 && splits.length > 0) {
    splits[splits.length - 1].amount = Math.round((splits[splits.length - 1].amount + diff) * 100) / 100;
  }
  return splits;
}

function formatSingleExpenseResponse(entry: {
  draft: ParsedExpenseDraft;
  payerName: string;
  splitUsers: string[];
  splits: Array<{ userName: string; amount: number }>;
  perHeadInfo?: { amount: number; count: number };
}): string {
  const splitLines = entry.splits.map((s) => `- ${s.userName} -> ₹${s.amount.toFixed(2)}`).join("\n");
  const perHeadLine = entry.perHeadInfo
    ? `🔢 Per head: ₹${entry.perHeadInfo.amount.toFixed(2)} × ${entry.perHeadInfo.count} active users`
    : null;
  return [
    "✅ Expense Added!",
    "",
    `🧾 Type: ${entry.draft.type}`,
    `💰 Total: ₹${entry.draft.amount.toFixed(2)}`,
    perHeadLine,
    `👤 Paid by: ${entry.payerName}`,
    `👥 Split between: ${entry.splitUsers.join(", ")}`,
    "",
    "💸 Split:",
    splitLines,
    "",
    `📅 Date: ${format(new Date(entry.draft.date), "dd MMM yyyy")}`,
  ].filter(Boolean).join("\n");
}

function formatMultipleExpensesResponse(entries: Array<{ draft: ParsedExpenseDraft }>, defaultedToActive: boolean): string {
  const header = `✅ ${entries.length} Expenses Added!`;
  const lines = entries.map((e, idx) => `${idx + 1}️⃣ ${e.draft.type} - ₹${e.draft.amount.toFixed(2)}`);
  const splitLine = defaultedToActive ? "👥 Split among: All active members" : "👥 Split among: Mentioned members";
  return [header, "", ...lines, "", splitLine].join("\n");
}

function formatParseError(): string {
  return [
    "❌ Couldn't understand the message",
    "👉 Try formats like:",
    '- "Curd 30"',
    '- "Food 250 Murali 125 Gani 125"',
  ].join("\n");
}

async function handleTelegramUpdate(update: TelegramBot.Update): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("TELEGRAM_BOT_TOKEN not set. Skipping telegram update.");
    return;
  }

  const bot = new TelegramBot(token, { polling: false });
  const msg = update.message;
  if (!msg || !msg.text) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  // Handle /start command
  if (text === "/start") {
    await bot.sendMessage(chatId, [
      "🏠 Room Expense Bot",
      "",
      "Send natural messages like:",
      '- "Curd 30"',
      '- "Yesterday vegetables 50"',
      '- "Food 250 Murali 125 Gani 125"',
    ].join("\n"));
    return;
  }

  // Handle /help command
  if (text === "/help") {
    await bot.sendMessage(chatId, formatParseError());
    return;
  }

  // Skip other commands
  if (text.startsWith("/")) return;

  try {
    const sql = getSql();
    await seedDefaults(); // Ensure tables exist

    // Get app state
    const [users, categories, monthStatus] = await Promise.all([
      sql`SELECT * FROM users ORDER BY name`,
      sql`SELECT *, is_default AS "isDefault" FROM categories ORDER BY name`,
      sql`SELECT *, is_locked AS "isLocked" FROM month_status ORDER BY month DESC`,
    ]);

    const payer = findUserByTelegramName(users as BotUser[], msg.from?.first_name || "", msg.from?.username);
    if (!payer) {
      console.log(`Telegram user not found: ${msg.from?.first_name} / @${msg.from?.username}`);
      return;
    }

    const drafts = parseExpenseMessage({
      text,
      users: users as ParserUser[],
      categories: categories as BotCategory[],
      sender: payer,
      now: new Date(),
    });

    if (drafts.length === 0) {
      if (/\d/.test(text)) {
        await bot.sendMessage(chatId, formatParseError());
      }
      return;
    }

    const savedEntries: Array<{
      draft: ParsedExpenseDraft;
      splitUsers: string[];
      splits: Array<{ userName: string; amount: number }>;
    }> = [];

    for (const draft of drafts) {
      const month = draft.date.slice(0, 7);
      const monthLocked = (monthStatus as any[]).find((m) => m.month === month)?.isLocked;
      if (monthLocked) continue;

      // For default-all mode, fetch active users for the month
      let participants: BotUser[];
      if (draft.userSelectionMode === "mentioned") {
        participants = draft.participants as BotUser[];
      } else {
        // Get active users for the month
        const activeLinks = await sql`
          SELECT user_id FROM active_users_by_month
          WHERE month = ${month} AND is_active = TRUE
        `;
        if (activeLinks.length > 0) {
          const activeIds = new Set(activeLinks.map((l: any) => l.user_id));
          participants = (users as BotUser[]).filter((u) => activeIds.has(u.id));
        } else {
          participants = users as BotUser[];
        }
      }
      if (participants.length === 0) continue;

      let effectiveAmount = draft.amount;
      let splits: { userId: string; amount: number }[];

      if (draft.userSelectionMode === "default-all" && typeof draft.perHeadAmount === "number" && draft.perHeadAmount > 0) {
        splits = participants.map((p) => ({ userId: p.id, amount: draft.perHeadAmount as number }));
        effectiveAmount = Math.round(draft.perHeadAmount * participants.length * 100) / 100;
      } else {
        splits = draft.splits.length > 0
          ? draft.splits.map((s) => ({ userId: s.userId, amount: s.amount }))
          : buildEqualSplits(participants, draft.amount);
      }

      const splitUsers = participants.map((p) => p.name);
      const splitLabelMap = new Map<string, string>((users as BotUser[]).map((u) => [u.id, u.name]));
      const splitDetails = splits.map((s) => ({
        userName: splitLabelMap.get(s.userId) || s.userId,
        amount: s.amount,
      }));

      const category = inferCategory(draft.type, categories as BotCategory[]) || (categories as BotCategory[])[0];
      if (!category) continue;

      // Calculate next serial number
      const [serialRow] = await sql`
        SELECT COALESCE(MAX(serial_no), 0) + 1 AS next_serial FROM expenses WHERE month = ${month}
      `;
      const nextSerial = Number(serialRow.next_serial);

      // Insert expense
      await sql`
        INSERT INTO expenses (date, month, description, amount, category_id, paid_by, split_type, splits, created_at, serial_no)
        VALUES (${draft.date}, ${month}, ${draft.type + " (via Telegram)"}, ${effectiveAmount}, ${category.id}, ${payer.id}, ${draft.splits.length > 0 ? "custom" : "equal"}, ${JSON.stringify(splits)}, ${new Date().toISOString()}, ${nextSerial})
      `;

      savedEntries.push({
        draft: { ...draft, amount: effectiveAmount },
        splitUsers,
        splits: splitDetails,
      });
    }

    if (savedEntries.length === 0) {
      await bot.sendMessage(chatId, formatParseError());
      return;
    }

    if (savedEntries.length === 1) {
      const message = formatSingleExpenseResponse({
        draft: savedEntries[0].draft,
        payerName: payer.name,
        splitUsers: savedEntries[0].splitUsers,
        splits: savedEntries[0].splits,
        perHeadInfo: savedEntries[0].draft.userSelectionMode === "default-all" && typeof savedEntries[0].draft.perHeadAmount === "number"
          ? { amount: savedEntries[0].draft.perHeadAmount, count: savedEntries[0].splitUsers.length }
          : undefined,
      });
      await bot.sendMessage(chatId, message);
    } else {
      const defaultedToActive = savedEntries.some((e) => e.draft.userSelectionMode === "default-all");
      await bot.sendMessage(chatId, formatMultipleExpensesResponse(savedEntries.map((s) => ({ draft: s.draft })), defaultedToActive));
    }
  } catch (error) {
    console.error("Telegram message handling failed:", error);
    await bot.sendMessage(chatId, formatParseError());
  }
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

  // ── Create active_users_by_month table ───────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS active_users_by_month (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      month TEXT NOT NULL,
      user_id TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TEXT NOT NULL DEFAULT now()::text
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS active_users_month_user_unique
    ON active_users_by_month (month, user_id)
  `;

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

// ─── Telegram Webhook ─────────────────────────────────────────────────────────
app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
  try {
    await handleTelegramUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Telegram webhook processing failed:", error);
    res.sendStatus(500);
  }
});

// ─── Active Users ─────────────────────────────────────────────────────────────
app.get("/api/active-users", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    await seedDefaults(); // Ensure tables exist
    const month = String(req.query.month || "");
    if (!month) {
      return res.status(400).json({ error: "month query param is required (YYYY-MM)" });
    }

    const allUsers = await sql`SELECT * FROM users ORDER BY name`;
    let activeUsers: any[] = [];
    try {
      const links = await sql`
        SELECT user_id FROM active_users_by_month
        WHERE month = ${month} AND is_active = TRUE
      `;
      if (links.length > 0) {
        const activeIds = new Set(links.map((l: any) => l.user_id));
        activeUsers = allUsers.filter((u: any) => activeIds.has(u.id));
      }
    } catch (error) {
      console.error("Failed to read active users for month, defaulting to all users:", error);
    }

    const effective = activeUsers.length > 0 ? activeUsers : allUsers;
    res.json({
      month,
      userIds: effective.map((u: any) => u.id),
      users: effective,
      source: activeUsers.length > 0 ? "custom" : "default-all",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/active-users", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    await seedDefaults(); // Ensure tables exist
    const month = String(req.body?.month || "");
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];

    if (!month) {
      return res.status(400).json({ error: "month is required" });
    }

    // Delete existing entries for this month
    await sql`DELETE FROM active_users_by_month WHERE month = ${month}`;

    // Insert new active users
    if (userIds.length > 0) {
      for (const userId of userIds) {
        await sql`
          INSERT INTO active_users_by_month (month, user_id, is_active, updated_at)
          VALUES (${month}, ${userId}, TRUE, ${new Date().toISOString()})
          ON CONFLICT (month, user_id) DO UPDATE SET is_active = TRUE, updated_at = ${new Date().toISOString()}
        `;
      }
    }

    res.json({ success: true, month, userIds });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
