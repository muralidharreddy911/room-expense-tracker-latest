import type { Express, Request, Response } from "express";
import TelegramBot from "node-telegram-bot-api";
import { format } from "date-fns";
import { storage } from "../storage";
import { inferCategory, parseExpenseMessage, type ParsedExpenseDraft, type ParserUser } from "./expense-parser";

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

interface UndoRecord {
  undoId: string;
  createdAt: number;
  chatId: number;
  payerUserId: string;
  expenseIds: string[];
  serialNos: number[];
  items: Array<{
    expenseId: string;
    serialNo?: number;
    type: string;
    amount: number;
  }>;
}

let botInstance: TelegramBot | null = null;
let initialized = false;
let pollingRestartTimer: NodeJS.Timeout | null = null;
let pollingRestartInProgress = false;

const activeUsersCache = new Map<string, { expiresAt: number; users: BotUser[] }>();
const ACTIVE_USERS_CACHE_TTL_MS = Number.parseInt(process.env.ACTIVE_USERS_CACHE_TTL_MS || "300000", 10);
const UNDO_WINDOW_MS = 30 * 60 * 1000;
const recentUndoByChatAndUser = new Map<string, UndoRecord>();
const undoById = new Map<string, UndoRecord>();

function getUndoKey(chatId: number, userId: string): string {
  return `${chatId}:${userId}`;
}

function clearActiveUsersCache(month?: string): void {
  if (month) {
    activeUsersCache.delete(month);
    return;
  }
  activeUsersCache.clear();
}

function createUndoId(chatId: number, payerUserId: string): string {
  const timePart = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 8);
  // Keep callback payload short (Telegram callback_data max is 64 bytes).
  return `${timePart}${randomPart}`;
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

function getMonthFromDate(date: string): string {
  return date.slice(0, 7);
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

async function getActiveUsersForMonth(month: string, allUsers: BotUser[]): Promise<BotUser[]> {
  const now = Date.now();
  const cached = activeUsersCache.get(month);
  if (cached && cached.expiresAt > now) {
    return cached.users.length > 0 ? cached.users : allUsers;
  }

  try {
    const active = await storage.getActiveUsers(month);
    const users = active.length > 0 ? active : allUsers;
    activeUsersCache.set(month, {
      users,
      expiresAt: now + ACTIVE_USERS_CACHE_TTL_MS,
    });
    return users;
  } catch (error) {
    console.error("Active users lookup failed, falling back to all users:", error);
    activeUsersCache.set(month, {
      users: allUsers,
      expiresAt: now + ACTIVE_USERS_CACHE_TTL_MS,
    });
    return allUsers;
  }
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

function formatUndoHint(record: UndoRecord): string {
  const refs = record.serialNos.length > 0 ? ` (#${record.serialNos.join(", #")})` : "";
  return `\n\n↩️ Use Undo within 30 minutes to remove this expense${record.expenseIds.length > 1 ? "s" : ""}${refs}.`;
}

function buildUndoReplyMarkup(record: UndoRecord): TelegramBot.SendMessageOptions["reply_markup"] {
  return {
    inline_keyboard: [[{ text: "Undo (30m)", callback_data: `undo:${record.undoId}` }]],
  };
}

function isTransientNetworkError(error: unknown): boolean {
  const err = error as any;
  const code = err?.code || err?.cause?.code || err?.error?.code;
  const message = String(err?.message || err?.cause?.message || err?.error?.message || "").toUpperCase();
  return code === "ECONNRESET" || code === "ETIMEDOUT" || message.includes("ECONNRESET") || message.includes("ETIMEDOUT");
}

async function safeSendMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message | null> {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    if (isTransientNetworkError(error)) {
      console.warn("Transient Telegram sendMessage failure:", (error as any)?.message || error);
      return null;
    }
    console.error("Telegram sendMessage failed:", error);
    return null;
  }
}

async function safeAnswerCallbackQuery(
  bot: TelegramBot,
  callbackId: string,
  options?: {
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
  }
): Promise<void> {
  try {
    await bot.answerCallbackQuery(callbackId, options as any);
  } catch (error) {
    if (isTransientNetworkError(error)) {
      console.warn("Transient Telegram callback answer failure:", (error as any)?.message || error);
      return;
    }
    throw error;
  }
}

async function resolveRequester(msg: TelegramBot.Message): Promise<BotUser | null> {
  try {
    const users = await storage.getUsers();
    const requester = findUserByTelegramName(users as BotUser[], msg.from?.first_name || "", msg.from?.username);
    return requester || null;
  } catch (error) {
    console.error("Failed to resolve requester:", error);
    return null;
  }
}

async function resolveRequesterFromTelegramIdentity(firstName: string, username?: string): Promise<BotUser | null> {
  try {
    const users = await storage.getUsers();
    const requester = findUserByTelegramName(users as BotUser[], firstName || "", username);
    return requester || null;
  } catch (error) {
    console.error("Failed to resolve requester from callback:", error);
    return null;
  }
}

async function executeUndoRecord(record: UndoRecord): Promise<{ deleted: number; deletedItems: string[] }> {
  let deleted = 0;
  const deletedItems: string[] = [];

  for (const expenseId of record.expenseIds) {
    try {
      await storage.deleteExpense(expenseId);
      deleted += 1;
      const item = record.items.find((i) => i.expenseId === expenseId);
      if (item) {
        const ref = item.serialNo ? `#${item.serialNo}` : item.expenseId.slice(0, 8);
        deletedItems.push(`• ${item.type} - ₹${item.amount.toFixed(2)} (${ref})`);
      }
    } catch {
      // ignore already-deleted or missing records
    }
  }

  recentUndoByChatAndUser.delete(getUndoKey(record.chatId, record.payerUserId));
  undoById.delete(record.undoId);
  return { deleted, deletedItems };
}

async function handleUndoCommand(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  try {
    const requester = await resolveRequester(msg);
    if (!requester) {
      await safeSendMessage(bot, msg.chat.id, "❌ Could not match your user profile (or DB is temporarily unavailable). Please try again.");
      return;
    }

    const key = getUndoKey(msg.chat.id, requester.id);
    const record = recentUndoByChatAndUser.get(key);
    if (!record) {
      await safeSendMessage(bot, msg.chat.id, "⚠️ No recent expense to undo.");
      return;
    }

    if (Date.now() - record.createdAt > UNDO_WINDOW_MS) {
      recentUndoByChatAndUser.delete(key);
      undoById.delete(record.undoId);
      await safeSendMessage(bot, msg.chat.id, "⌛ Undo window expired (30 minutes).");
      return;
    }

    const { deleted, deletedItems } = await executeUndoRecord(record);
    if (deleted > 0) {
      const details = deletedItems.length > 0 ? `\n\n${deletedItems.join("\n")}` : "";
      await safeSendMessage(bot, msg.chat.id, `✅ Undo successful. Deleted ${deleted} expense(s).${details}`);
    } else {
      await safeSendMessage(bot, msg.chat.id, "⚠️ Nothing to undo.");
    }
  } catch (error) {
    console.error("Undo command failed:", error);
    await safeSendMessage(bot, msg.chat.id, "❌ Undo failed due to a temporary database/network issue. Please try again.");
  }
}

async function handleUndoCallback(bot: TelegramBot, query: TelegramBot.CallbackQuery): Promise<void> {
  try {
    const callbackId = query.id;
    const message = query.message;
    const data = query.data || "";

    if (!data.startsWith("undo:")) {
      await safeAnswerCallbackQuery(bot, callbackId);
      return;
    }

    const undoId = data.slice("undo:".length);
    const record = undoById.get(undoId);
    if (!record) {
      await safeAnswerCallbackQuery(bot, callbackId, { text: "Undo record not found or already used." });
      return;
    }

    if (!message || message.chat.id !== record.chatId) {
      await safeAnswerCallbackQuery(bot, callbackId, { text: "This undo action is not valid for this chat." });
      return;
    }

    const requester = await resolveRequesterFromTelegramIdentity(query.from.first_name || "", query.from.username);
    if (!requester) {
      await safeAnswerCallbackQuery(bot, callbackId, { text: "Could not verify your profile right now." });
      return;
    }

    if (requester.id !== record.payerUserId) {
      await safeAnswerCallbackQuery(bot, callbackId, { text: "Only the creator can undo this expense." });
      return;
    }

    if (Date.now() - record.createdAt > UNDO_WINDOW_MS) {
      undoById.delete(record.undoId);
      recentUndoByChatAndUser.delete(getUndoKey(record.chatId, record.payerUserId));
      await safeAnswerCallbackQuery(bot, callbackId, { text: "Undo window expired (30 minutes)." });
      return;
    }

    const { deleted, deletedItems } = await executeUndoRecord(record);
    const details = deletedItems.length > 0 ? `\n\n${deletedItems.join("\n")}` : "";
    if (deleted > 0) {
      await safeAnswerCallbackQuery(bot, callbackId, { text: `Undid ${deleted} expense(s).` });
      await safeSendMessage(bot, record.chatId, `✅ Undo successful. Deleted ${deleted} expense(s).${details}`);
    } else {
      await safeAnswerCallbackQuery(bot, callbackId, { text: "Nothing to undo." });
      await safeSendMessage(bot, record.chatId, "⚠️ Nothing to undo.");
    }
  } catch (error) {
    console.error("Undo callback failed:", error);
    try {
      await safeAnswerCallbackQuery(bot, query.id, { text: "Undo failed due to temporary DB/network issue." });
    } catch {
      // ignore callback answer failures in catch path
    }
    if (query.message?.chat?.id) {
      await safeSendMessage(bot, query.message.chat.id, "❌ Undo failed due to a temporary database/network issue. Please try again.");
    }
  }
}

async function handleDeleteExpenseCommand(bot: TelegramBot, msg: TelegramBot.Message, rawRef: string): Promise<void> {
  try {
    const ref = rawRef.trim();
    if (!ref) {
      await safeSendMessage(bot, msg.chat.id, "⚠️ Usage: /delete_expense <expenseId|serialNo>");
      return;
    }

    const requester = await resolveRequester(msg);
    if (!requester) {
      await safeSendMessage(bot, msg.chat.id, "❌ Could not match your user profile (or DB is temporarily unavailable). Please try again.");
      return;
    }

    const state = await storage.getAppState();
    const target = state.expenses.find((e: any) => e.id === ref || String(e.serialNo) === ref);

    if (!target) {
      await safeSendMessage(bot, msg.chat.id, `❌ Expense not found for: ${ref}`);
      return;
    }

    const isOwner = target.paidBy === requester.id;
    const isAdmin = requester.role?.toLowerCase() === "admin";

    if (!isOwner && !isAdmin) {
      await safeSendMessage(bot, msg.chat.id, "❌ You can delete only your own expenses (admins can delete any).");
      return;
    }

    await storage.deleteExpense(target.id);
    await safeSendMessage(bot, msg.chat.id, `✅ Expense deleted (ref: ${target.serialNo || target.id}).`);
  } catch (error) {
    console.error("Delete expense command failed:", error);
    await safeSendMessage(bot, msg.chat.id, "❌ Delete failed due to a temporary database/network issue. Please try again.");
  }
}

async function handleNaturalMessage(bot: TelegramBot, msg: TelegramBot.Message): Promise<void> {
  try {
    const text = msg.text?.trim();
    if (!text) return;
    if (text.startsWith("/")) return;

    const { users, categories, monthStatus } = await storage.getAppState();
    const payer = findUserByTelegramName(users, msg.from?.first_name || "", msg.from?.username);
    if (!payer) return;

    const drafts = parseExpenseMessage({
      text,
      users: users as ParserUser[],
      categories,
      sender: payer,
      now: new Date(),
    });

    if (drafts.length === 0) {
      if (/\d/.test(text)) {
        await safeSendMessage(bot, msg.chat.id, formatParseError());
      }
      return;
    }

    const savedEntries: Array<{
      draft: ParsedExpenseDraft;
      splitUsers: string[];
      splits: Array<{ userName: string; amount: number }>;
      expenseId: string;
      serialNo?: number;
    }> = [];

    for (const draft of drafts) {
      const month = getMonthFromDate(draft.date);
      const monthLocked = monthStatus.find((m: { month: string; isLocked: boolean }) => m.month === month)?.isLocked;
      if (monthLocked) {
        continue;
      }

      const participants =
        draft.userSelectionMode === "mentioned"
          ? draft.participants
          : await getActiveUsersForMonth(month, users as BotUser[]);

      if (participants.length === 0) {
        continue;
      }

      let effectiveAmount = draft.amount;
      let splits: { userId: string; amount: number }[];

      if (draft.userSelectionMode === "default-all" && typeof draft.perHeadAmount === "number" && draft.perHeadAmount > 0) {
        splits = participants.map((p) => ({ userId: p.id, amount: draft.perHeadAmount as number }));
        effectiveAmount = Math.round(draft.perHeadAmount * participants.length * 100) / 100;
      } else {
        splits =
          draft.splits.length > 0
            ? draft.splits.map((s) => ({ userId: s.userId, amount: s.amount }))
            : buildEqualSplits(participants, draft.amount);
      }

      const splitUsers = participants.map((p) => p.name);
      const splitLabelMap = new Map<string, string>(users.map((u: BotUser) => [u.id, u.name]));

      const splitDetails = splits.map((s) => ({
        userName: splitLabelMap.get(s.userId) || s.userId,
        amount: s.amount,
      }));

      const category = inferCategory(draft.type, categories as BotCategory[]) || categories[0];
      if (!category) {
        continue;
      }

      const created = await storage.createExpense({
        date: draft.date,
        month,
        description: `${draft.type} (via Telegram)`,
        amount: effectiveAmount,
        categoryId: category.id,
        paidBy: payer.id,
        splitType: draft.splits.length > 0 ? "custom" : "equal",
        splits,
        createdAt: new Date().toISOString(),
      });

      savedEntries.push({
        draft: { ...draft, amount: effectiveAmount },
        splitUsers,
        splits: splitDetails,
        expenseId: created.id,
        serialNo: created.serialNo,
      });
    }

    if (savedEntries.length === 0) {
      await safeSendMessage(bot, msg.chat.id, formatParseError());
      return;
    }

    if (savedEntries.length === 1) {
      const undoId = createUndoId(msg.chat.id, payer.id);
      const undoRecord: UndoRecord = {
        undoId,
        createdAt: Date.now(),
        chatId: msg.chat.id,
        payerUserId: payer.id,
        expenseIds: [savedEntries[0].expenseId],
        serialNos: savedEntries[0].serialNo ? [savedEntries[0].serialNo] : [],
        items: [
          {
            expenseId: savedEntries[0].expenseId,
            serialNo: savedEntries[0].serialNo,
            type: savedEntries[0].draft.type,
            amount: savedEntries[0].draft.amount,
          },
        ],
      };
      recentUndoByChatAndUser.set(getUndoKey(msg.chat.id, payer.id), undoRecord);
      undoById.set(undoId, undoRecord);

      const message = formatSingleExpenseResponse({
        draft: savedEntries[0].draft,
        payerName: payer.name,
        splitUsers: savedEntries[0].splitUsers,
        splits: savedEntries[0].splits,
        perHeadInfo:
          savedEntries[0].draft.userSelectionMode === "default-all" && typeof savedEntries[0].draft.perHeadAmount === "number"
            ? { amount: savedEntries[0].draft.perHeadAmount, count: savedEntries[0].splitUsers.length }
            : undefined,
      });
      await safeSendMessage(bot, msg.chat.id, message + formatUndoHint(undoRecord), {
        reply_markup: buildUndoReplyMarkup(undoRecord),
      });
      return;
    }

    const defaultedToActive = savedEntries.some((e) => e.draft.userSelectionMode === "default-all");
    const undoId = createUndoId(msg.chat.id, payer.id);
    const multiUndoRecord: UndoRecord = {
      undoId,
      createdAt: Date.now(),
      chatId: msg.chat.id,
      payerUserId: payer.id,
      expenseIds: savedEntries.map((s) => s.expenseId),
      serialNos: savedEntries.map((s) => s.serialNo).filter((v): v is number => typeof v === "number"),
      items: savedEntries.map((s) => ({
        expenseId: s.expenseId,
        serialNo: s.serialNo,
        type: s.draft.type,
        amount: s.draft.amount,
      })),
    };
    recentUndoByChatAndUser.set(getUndoKey(msg.chat.id, payer.id), multiUndoRecord);
    undoById.set(undoId, multiUndoRecord);

    await safeSendMessage(
      bot,
      msg.chat.id,
      formatMultipleExpensesResponse(savedEntries.map((s) => ({ draft: s.draft })), defaultedToActive) + formatUndoHint(multiUndoRecord),
      {
        reply_markup: buildUndoReplyMarkup(multiUndoRecord),
      }
    );
  } catch (error) {
    console.error("Telegram message handling failed:", error);
    await safeSendMessage(bot, msg.chat.id, formatParseError());
  }
}

function wireSafeBotEvent<T extends any[]>(
  bot: TelegramBot,
  label: string,
  register: (handler: (...args: T) => void) => void,
  handler: (...args: T) => Promise<void>
): void {
  register((...args: T) => {
    handler(...args).catch((error) => {
      console.error(`Unhandled bot event error [${label}]:`, error);
    });
  });
}

function schedulePollingRestart(bot: TelegramBot): void {
  if (pollingRestartInProgress || pollingRestartTimer) {
    return;
  }

  pollingRestartTimer = setTimeout(async () => {
    pollingRestartTimer = null;
    pollingRestartInProgress = true;
    try {
      await bot.stopPolling({ cancel: false } as any);
    } catch {
      // ignore stop failures
    }

    try {
      await bot.startPolling();
      console.log("Telegram polling restarted after transient error.");
    } catch (error) {
      console.error("Telegram polling restart failed:", error);
    } finally {
      pollingRestartInProgress = false;
    }
  }, 1500);
}

export function registerTelegramWebhookRoute(app: Express): void {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    try {
      if (botInstance) {
        await botInstance.processUpdate(req.body);
      }
      res.sendStatus(200);
    } catch (error) {
      console.error("Telegram webhook processing failed:", error);
      res.sendStatus(500);
    }
  });
}

export async function startTelegramBot(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("TELEGRAM_BOT_TOKEN not set. Skipping Telegram bot startup.");
    return;
  }

  const useWebhook = process.env.TELEGRAM_USE_WEBHOOK === "true" || Boolean(process.env.VERCEL);
  botInstance = new TelegramBot(token, { polling: !useWebhook });

  if (useWebhook && process.env.TELEGRAM_WEBHOOK_URL) {
    try {
      await botInstance.setWebHook(`${process.env.TELEGRAM_WEBHOOK_URL}/api/telegram/webhook`);
      console.log("Telegram bot started in webhook mode.");
    } catch (error) {
      console.error("Failed to set Telegram webhook:", error);
    }
  } else {
    console.log("Telegram bot started in polling mode.");
  }

  wireSafeBotEvent(botInstance, "/start", (handler) => botInstance!.onText(/\/start/, (msg) => void handler(msg)), async (msg) => {
    await safeSendMessage(
      botInstance as TelegramBot,
      msg.chat.id,
      [
        "🏠 Room Expense Bot",
        "",
        "Send natural messages like:",
        '- "Curd 30"',
        '- "Yesterday vegetables 50"',
        '- "Food 250 Murali 125 Gani 125"',
      ].join("\n")
    );
  });

  wireSafeBotEvent(botInstance, "/help", (handler) => botInstance!.onText(/\/help/, (msg) => void handler(msg)), async (msg) => {
    await safeSendMessage(botInstance as TelegramBot, msg.chat.id, formatParseError());
  });

  wireSafeBotEvent(botInstance, "/undo", (handler) => botInstance!.onText(/\/undo/, (msg) => void handler(msg)), async (msg) => {
    await handleUndoCommand(botInstance as TelegramBot, msg);
  });

  wireSafeBotEvent(
    botInstance,
    "/delete_expense",
    (handler) => botInstance!.onText(/\/delete_expense\s+(.+)/, (msg, match) => void handler(msg, match)),
    async (msg, match) => {
      const ref = match?.[1] || "";
      await handleDeleteExpenseCommand(botInstance as TelegramBot, msg, ref);
    }
  );

  wireSafeBotEvent(botInstance, "message", (handler) => botInstance!.on("message", (msg) => void handler(msg)), async (msg) => {
    await handleNaturalMessage(botInstance as TelegramBot, msg);
  });

  wireSafeBotEvent(
    botInstance,
    "callback_query",
    (handler) => botInstance!.on("callback_query", (query) => void handler(query)),
    async (query) => {
      await handleUndoCallback(botInstance as TelegramBot, query);
    }
  );

  botInstance.on("polling_error", (error) => {
    console.error("Telegram polling error:", error?.message || error);
    if (isTransientNetworkError(error)) {
      schedulePollingRestart(botInstance as TelegramBot);
    }
  });

  botInstance.on("webhook_error", (error) => {
    console.error("Telegram webhook error:", error?.message || error);
  });

  botInstance.on("error", (error) => {
    console.error("Telegram bot runtime error:", error?.message || error);
  });
}

export function invalidateActiveUsersCache(month?: string): void {
  clearActiveUsersCache(month);
}
