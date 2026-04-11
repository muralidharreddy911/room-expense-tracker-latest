import express, { type Request, Response, NextFunction } from "express";
import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { format, parse, subDays } from "date-fns";

// ─── Expense Parser Types ─────────────────────────────────────────────────────
interface ParserUser {
  id: string;
  name: string;
  username?: string;
}

interface ParserCategory {
  id: string;
  name: string;
}

interface ParsedSplitHint {
  userId: string;
  userName: string;
  amount: number;
}

interface ParsedExpenseDraft {
  type: string;
  amount: number;
  date: string;
  paidBy: string;
  participants: ParserUser[];
  userSelectionMode: "mentioned" | "default-all";
  splits: ParsedSplitHint[];
  perHeadAmount?: number;
  confidence: number;
  sourceText: string;
  categoryHint?: string;
}

interface ParserInput {
  text: string;
  users: ParserUser[];
  categories: ParserCategory[];
  sender: ParserUser;
  now?: Date;
}

// ─── Expense Parser Implementation ────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  rent: ["rent"],
  wifi: ["wifi", "internet", "broadband"],
  electricity: ["current", "electricity", "eb"],
  gas: ["gas", "cylinder"],
  groceries: ["groceries", "grocery", "vegetables", "veggies", "veg", "onions", "milk", "curd", "tea", "oil", "water", "chicken", "chips"],
};

const CATEGORY_PREFERRED_NAMES: Record<string, string[]> = {
  rent: ["rent"],
  wifi: ["internet", "wifi", "broadband"],
  electricity: ["power", "electricity", "current"],
  gas: ["gas"],
  groceries: ["groceries", "grocery", "food"],
};

const learnedTypeToCategory = new Map<string, string>();

const PATTERNS = {
  leadingNameAmount: /^([a-z][a-z\s]{0,40}?)\s*[-:=]\s*(\d+(?:\.\d+)?)(?:\b.*)?$/i,
  simpleTypeAmount: /^([a-z][a-z\s+&-]{1,60}?)\s*(?:=|:|-)?\s*(\d+(?:\.\d+)?)$/i,
  amountThenType: /^(\d+(?:\.\d+)?)\s+([a-z][a-z\s+&-]{1,60})$/i,
  simpleTypeAmountExpression: /^([a-z][a-z\s+&-]{1,60}?)\s*(?:=|:|-)?\s*(\d+(?:\s*\+\s*\d+)+)$/i,
  amountOnly: /^(\d+(?:\.\d+)?)$/,
  eachSplit: /([a-z\s,]+?)\s+each\s+(\d+(?:\.\d+)?)/i,
  eachSplitNoNamesTypeEachAmount: /^([a-z][a-z\s+&-]{1,60}?)\s+each\s+(\d+(?:\.\d+)?)$/i,
  eachSplitNoNamesTypeAmountEach: /^([a-z][a-z\s+&-]{1,60}?)\s+(\d+(?:\.\d+)?)\s+each$/i,
  eachSplitNoNamesEachTypeAmount: /^each\s+([a-z][a-z\s+&-]{1,60}?)\s+(\d+(?:\.\d+)?)$/i,
  eachSplitNoNamesAmountTypeEach: /^(\d+(?:\.\d+)?)\s+([a-z][a-z\s+&-]{1,60}?)\s+each$/i,
  dateSlash: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/i,
  dateMonthTextWithYear: /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\s+(\d{4})\b/i,
  dateMonthTextNoYear: /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/i,
  relativeDate: /\b(yesterday|today)\b/i,
  multiItem: /([a-z][a-z\s+&-]{1,60}?)\s*(?:=|:|-)?\s*(\d+(?:\.\d+)?)(?=\s*(?:and|,|$))/gi,
  multiItemAmountFirst: /(\d+(?:\.\d+)?)\s+([a-z][a-z\s+&-]{1,60}?)(?=\s*(?:and|,|$))/gi,
};

function normalizeText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("₹", " ").replaceAll("rs.", " ").replaceAll("rs", " ").trim();
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s+&-]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeExpenseType(type: string): string {
  return normalizeToken(type).replace(/\bexpense\b/g, " ").replace(/\bfor\b/g, " ").replace(/\s+/g, " ").trim() || "general";
}

function normalizeContextWords(text: string): string {
  return text.replaceAll(/\bmeans to\b/gi, " ").replaceAll(/\bfor\b/gi, " for ").replaceAll(/\s{2,}/g, " ").trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function containsWordOrPhrase(haystack: string, needle: string): boolean {
  const cleanNeedle = normalizeToken(needle);
  if (!cleanNeedle) return false;
  const pattern = new RegExp(`\\b${escapeRegex(cleanNeedle)}\\b`, "i");
  return pattern.test(haystack);
}

function findCategoryByWord(word: string, categories: ParserCategory[]): ParserCategory | undefined {
  const needle = normalizeToken(word);
  return categories.find((c) => {
    const name = normalizeToken(c.name);
    return name === needle || name.includes(needle) || needle.includes(name);
  });
}

function inferCategory(type: string, categories: ParserCategory[]): ParserCategory | undefined {
  const normalizedType = normalizeToken(type);
  const learned = learnedTypeToCategory.get(normalizedType);
  if (learned) {
    const cached = categories.find((c) => normalizeToken(c.name) === learned);
    if (cached) return cached;
  }
  for (const [label, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => containsWordOrPhrase(normalizedType, w))) {
      const preferred = CATEGORY_PREFERRED_NAMES[label] || [];
      const found = preferred.map((name) => findCategoryByWord(name, categories)).find(Boolean) ||
        findCategoryByWord(label, categories) ||
        words.map((word) => findCategoryByWord(word, categories)).find(Boolean);
      if (found) {
        learnedTypeToCategory.set(normalizedType, normalizeToken(found.name));
        return found;
      }
    }
  }
  const direct = categories.find((c) => {
    const cName = normalizeToken(c.name);
    return cName === normalizedType || cName.includes(normalizedType) || normalizedType.includes(cName);
  });
  if (direct) {
    learnedTypeToCategory.set(normalizedType, normalizeToken(direct.name));
    return direct;
  }
  return findCategoryByWord("general", categories) || findCategoryByWord("misc", categories) || findCategoryByWord("other", categories);
}

function resolveUserToken(token: string, users: ParserUser[]): ParserUser | undefined {
  const clean = normalizeToken(token);
  if (!clean) return undefined;
  let exact = users.find((u) => normalizeToken(u.name) === clean || normalizeToken(u.username || "") === clean);
  if (exact) return exact;
  exact = users.find((u) => {
    const name = normalizeToken(u.name);
    const first = name.split(" ")[0] || "";
    return name.startsWith(clean) || first.startsWith(clean);
  });
  if (exact) return exact;
  let best: { user: ParserUser; score: number } | undefined;
  for (const user of users) {
    const candidates = [normalizeToken(user.name), normalizeToken(user.username || "")].filter(Boolean);
    for (const candidate of candidates) {
      const dist = levenshtein(clean, candidate);
      const score = 1 - dist / Math.max(clean.length, candidate.length);
      if (!best || score > best.score) best = { user, score };
    }
  }
  return best && best.score >= 0.72 ? best.user : undefined;
}

function extractDate(text: string, now: Date): { date: string; text: string } {
  let cleaned = text;
  let resolved = now;
  const rel = cleaned.match(PATTERNS.relativeDate);
  if (rel) {
    const word = normalizeToken(rel[1]);
    resolved = word === "yesterday" ? subDays(now, 1) : now;
    cleaned = cleaned.replace(rel[0], " ").trim();
  }
  const slash = cleaned.match(PATTERNS.dateSlash);
  if (slash) {
    const day = Number.parseInt(slash[1], 10);
    const month = Number.parseInt(slash[2], 10);
    const yearRaw = Number.parseInt(slash[3], 10);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const parsed = new Date(year, month - 1, day);
    if (!Number.isNaN(parsed.getTime())) {
      resolved = parsed;
      cleaned = cleaned.replace(slash[0], " ").trim();
    }
  }
  const monthWithYear = cleaned.match(PATTERNS.dateMonthTextWithYear);
  if (monthWithYear) {
    const raw = `${monthWithYear[1]} ${monthWithYear[2]} ${monthWithYear[3]}`;
    const parsedDate = parse(raw, "d MMM yyyy", now);
    const fallback = parse(raw, "d MMMM yyyy", now);
    const picked = Number.isNaN(parsedDate.getTime()) ? fallback : parsedDate;
    if (!Number.isNaN(picked.getTime())) {
      resolved = picked;
      cleaned = cleaned.replace(monthWithYear[0], " ").trim();
    }
  } else {
    const monthNoYear = cleaned.match(PATTERNS.dateMonthTextNoYear);
    if (monthNoYear) {
      const raw = `${monthNoYear[1]} ${monthNoYear[2]}`;
      const parsedDate = parse(raw, "d MMM", now);
      const fallback = parse(raw, "d MMMM", now);
      const picked = Number.isNaN(parsedDate.getTime()) ? fallback : parsedDate;
      if (!Number.isNaN(picked.getTime())) {
        resolved = new Date(now.getFullYear(), picked.getMonth(), picked.getDate());
        cleaned = cleaned.replace(monthNoYear[0], " ").trim();
      }
    }
  }
  return { date: format(resolved, "yyyy-MM-dd"), text: cleaned.replace(/\s{2,}/g, " ").trim() };
}

function detectParticipants(text: string, users: ParserUser[], sender: ParserUser): { participants: ParserUser[]; explicitMention: boolean } {
  const lower = normalizeToken(text);
  const found: ParserUser[] = [];
  let explicitMention = false;
  if (/\bme\b/.test(lower)) {
    found.push(sender);
    explicitMention = true;
  }
  for (const user of users) {
    const normalizedName = normalizeToken(user.name);
    const first = normalizedName.split(" ")[0] || "";
    const normalizedUsername = normalizeToken(user.username || "");
    const fullMatch = normalizedName && lower.includes(normalizedName);
    const firstMatch = first ? new RegExp(`\\b${escapeRegex(first)}\\b`, "i").test(lower) : false;
    const usernameMatch = normalizedUsername ? new RegExp(`\\b${escapeRegex(normalizedUsername)}\\b`, "i").test(lower) : false;
    if (fullMatch || firstMatch || usernameMatch) {
      explicitMention = true;
      if (!found.some((f) => f.id === user.id)) found.push(user);
    }
  }
  return { participants: found.length > 0 ? found : users, explicitMention };
}

function buildDraft(args: {
  type: string; amount: number; date: string; paidBy: string; participants: ParserUser[];
  userSelectionMode: "mentioned" | "default-all"; splits: ParsedSplitHint[]; perHeadAmount?: number;
  sourceText: string; categories: ParserCategory[]; confidence: number;
}): ParsedExpenseDraft {
  const type = normalizeExpenseType(args.type || "general");
  return {
    type, amount: round2(args.amount), date: args.date, paidBy: args.paidBy, participants: args.participants,
    userSelectionMode: args.userSelectionMode, splits: args.splits, perHeadAmount: args.perHeadAmount,
    confidence: args.confidence, sourceText: args.sourceText, categoryHint: inferCategory(type, args.categories)?.name,
  };
}

function sanitizeTypeText(raw: string, participants: ParserUser[]): string {
  let value = normalizeExpenseType(raw).replaceAll(/^and\s+/g, "").replaceAll(/^me\s+and\s+/g, "").replaceAll(/^me\s+/g, "").trim();
  for (const participant of participants) {
    const first = normalizeToken(participant.name).split(" ")[0];
    if (!first) continue;
    value = value.replace(new RegExp(`^${escapeRegex(first)}\\s+`, "i"), "").trim();
  }
  return value || "general";
}

function parseAmountExpression(value: string): number | null {
  if (!value.includes("+")) {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  const parts = value.split("+").map((p) => p.trim()).filter(Boolean).map((p) => Number.parseFloat(p));
  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return round2(parts.reduce((sum, n) => sum + n, 0));
}

function parseEachSplit(text: string, users: ParserUser[]): { type: string; totalAmount: number; participants: ParserUser[]; splits: ParsedSplitHint[] } | null {
  const match = text.match(PATTERNS.eachSplit);
  if (!match) return null;
  const amount = Number.parseFloat(match[2]);
  if (Number.isNaN(amount) || amount <= 0) return null;
  const tokens = normalizeToken(match[1]).split(/\s+/).filter(Boolean);
  const participants: ParserUser[] = [];
  for (const token of tokens) {
    const user = resolveUserToken(token, users);
    if (user && !participants.some((p) => p.id === user.id)) participants.push(user);
  }
  if (participants.length < 2) return null;
  return { type: "general", totalAmount: round2(amount * participants.length), participants, splits: participants.map((p) => ({ userId: p.id, userName: p.name, amount })) };
}

function parseEachSplitWithoutNames(text: string, users: ParserUser[]): { type: string; eachAmount: number; participants: ParserUser[] } | null {
  let typeRaw: string | undefined;
  let amountRaw: string | undefined;
  const a = text.match(PATTERNS.eachSplitNoNamesTypeEachAmount);
  if (a) { typeRaw = a[1]; amountRaw = a[2]; }
  const b = !typeRaw ? text.match(PATTERNS.eachSplitNoNamesTypeAmountEach) : null;
  if (b) { typeRaw = b[1]; amountRaw = b[2]; }
  const c = !typeRaw ? text.match(PATTERNS.eachSplitNoNamesEachTypeAmount) : null;
  if (c) { typeRaw = c[1]; amountRaw = c[2]; }
  const d = !typeRaw ? text.match(PATTERNS.eachSplitNoNamesAmountTypeEach) : null;
  if (d) { typeRaw = d[2]; amountRaw = d[1]; }
  if (!typeRaw || !amountRaw) return null;
  const eachAmount = Number.parseFloat(amountRaw);
  if (Number.isNaN(eachAmount) || eachAmount <= 0) return null;
  if (users.length === 0) return null;
  return { type: normalizeExpenseType(typeRaw), eachAmount, participants: users };
}

function parseNamedSplitWithTotal(text: string, users: ParserUser[]): { type: string; totalAmount: number; participants: ParserUser[]; splits: ParsedSplitHint[]; confidence: number } | null {
  const head = text.match(/^([a-z][a-z\s+&-]{1,60})\s+(\d+(?:\.\d+)?)(.*)$/i);
  if (!head) return null;
  const type = normalizeExpenseType(head[1]);
  const totalAmount = Number.parseFloat(head[2]);
  const tail = (head[3] || "").trim();
  if (!tail) return null;
  const pairs = Array.from(tail.matchAll(/([a-z]+)\s+(\d+(?:\.\d+)?)/gi));
  if (pairs.length < 2) return null;
  const participants: ParserUser[] = [];
  const splits: ParsedSplitHint[] = [];
  for (const pair of pairs) {
    const user = resolveUserToken(pair[1], users);
    if (!user) return null;
    const amount = Number.parseFloat(pair[2]);
    if (Number.isNaN(amount) || amount < 0) return null;
    splits.push({ userId: user.id, userName: user.name, amount });
    if (!participants.some((p) => p.id === user.id)) participants.push(user);
  }
  const sum = round2(splits.reduce((acc, s) => acc + s.amount, 0));
  const diff = Math.abs(sum - totalAmount);
  return { type, totalAmount, participants, splits, confidence: diff <= 1 ? 0.95 : 0.8 };
}

function parseNamedSplitWithoutTotal(text: string, users: ParserUser[]): { type: string; totalAmount: number; participants: ParserUser[]; splits: ParsedSplitHint[] } | null {
  const pairs = Array.from(text.matchAll(/([a-z]+)\s+(\d+(?:\.\d+)?)/gi));
  if (pairs.length < 2) return null;
  const firstPairIndex = pairs[0].index ?? -1;
  if (firstPairIndex <= 0) return null;
  const type = normalizeExpenseType(text.slice(0, firstPairIndex).trim());
  if (!type || type === "general") return null;
  const participants: ParserUser[] = [];
  const splits: ParsedSplitHint[] = [];
  for (const pair of pairs) {
    const user = resolveUserToken(pair[1], users);
    if (!user) return null;
    const amount = Number.parseFloat(pair[2]);
    if (Number.isNaN(amount) || amount < 0) return null;
    splits.push({ userId: user.id, userName: user.name, amount });
    if (!participants.some((p) => p.id === user.id)) participants.push(user);
  }
  return { type, totalAmount: round2(splits.reduce((sum, s) => sum + s.amount, 0)), participants, splits };
}

function parseMultiItems(text: string, input: ParserInput, date: string, sourceText: string): ParsedExpenseDraft[] {
  const matches = Array.from(text.matchAll(PATTERNS.multiItem));
  if (matches.length <= 1) return [];
  const detected = detectParticipants(text, input.users, input.sender);
  return matches.map((match) => {
    const amount = Number.parseFloat(match[2]);
    if (Number.isNaN(amount) || amount <= 0) return null;
    return buildDraft({ type: sanitizeTypeText(match[1], detected.participants), amount, date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText, categories: input.categories, confidence: 0.86 });
  }).filter((v): v is ParsedExpenseDraft => v !== null);
}

function parseMultiItemsAmountFirst(text: string, input: ParserInput, date: string, sourceText: string): ParsedExpenseDraft[] {
  const matches = Array.from(text.matchAll(PATTERNS.multiItemAmountFirst));
  if (matches.length <= 1) return [];
  const detected = detectParticipants(text, input.users, input.sender);
  return matches.map((match) => {
    const amount = Number.parseFloat(match[1]);
    if (Number.isNaN(amount) || amount <= 0) return null;
    return buildDraft({ type: sanitizeTypeText(match[2], detected.participants), amount, date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText, categories: input.categories, confidence: 0.86 });
  }).filter((v): v is ParsedExpenseDraft => v !== null);
}

function parseGeneralNaturalLine(text: string, input: ParserInput, date: string, sourceText: string): ParsedExpenseDraft | null {
  const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!amountMatch) return null;
  const amount = Number.parseFloat(amountMatch[1]);
  if (Number.isNaN(amount) || amount <= 0) return null;
  const before = text.slice(0, amountMatch.index).trim();
  const after = text.slice((amountMatch.index || 0) + amountMatch[1].length).trim();
  const detected = detectParticipants(text, input.users, input.sender);
  return buildDraft({ type: sanitizeTypeText(after || before || "general", detected.participants), amount, date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText, categories: input.categories, confidence: 0.62 });
}

function parseLine(line: string, input: ParserInput, now: Date): ParsedExpenseDraft[] {
  const withDate = extractDate(line, now);
  const cleaned = normalizeContextWords(withDate.text);
  if (!cleaned) return [];
  const leadingNameAmount = cleaned.match(PATTERNS.leadingNameAmount);
  if (leadingNameAmount) {
    const amount = Number.parseFloat(leadingNameAmount[2]);
    if (!Number.isNaN(amount) && amount > 0) {
      const detected = detectParticipants(cleaned, input.users, input.sender);
      return [buildDraft({ type: leadingNameAmount[1], amount, date: withDate.date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText: line, categories: input.categories, confidence: 0.84 })];
    }
  }
  const eachSplit = parseEachSplit(cleaned, input.users);
  if (eachSplit) return [buildDraft({ type: eachSplit.type, amount: eachSplit.totalAmount, date: withDate.date, paidBy: input.sender.id, participants: eachSplit.participants, userSelectionMode: "mentioned", splits: eachSplit.splits, sourceText: line, categories: input.categories, confidence: 0.93 })];
  const eachNoNames = parseEachSplitWithoutNames(cleaned, input.users);
  if (eachNoNames) return [buildDraft({ type: eachNoNames.type, amount: eachNoNames.eachAmount, date: withDate.date, paidBy: input.sender.id, participants: eachNoNames.participants, userSelectionMode: "default-all", splits: [], perHeadAmount: eachNoNames.eachAmount, sourceText: line, categories: input.categories, confidence: 0.91 })];
  const namedSplit = parseNamedSplitWithTotal(cleaned, input.users);
  if (namedSplit) return [buildDraft({ type: namedSplit.type, amount: namedSplit.totalAmount, date: withDate.date, paidBy: input.sender.id, participants: namedSplit.participants, userSelectionMode: "mentioned", splits: namedSplit.splits, sourceText: line, categories: input.categories, confidence: namedSplit.confidence })];
  const namedSplitNoTotal = parseNamedSplitWithoutTotal(cleaned, input.users);
  if (namedSplitNoTotal) return [buildDraft({ type: namedSplitNoTotal.type, amount: namedSplitNoTotal.totalAmount, date: withDate.date, paidBy: input.sender.id, participants: namedSplitNoTotal.participants, userSelectionMode: "mentioned", splits: namedSplitNoTotal.splits, sourceText: line, categories: input.categories, confidence: 0.9 })];
  const multi = parseMultiItems(cleaned, input, withDate.date, line);
  if (multi.length > 0) return multi;
  const multiAmountFirst = parseMultiItemsAmountFirst(cleaned, input, withDate.date, line);
  if (multiAmountFirst.length > 0) return multiAmountFirst;
  const simpleExpr = cleaned.match(PATTERNS.simpleTypeAmountExpression);
  if (simpleExpr) {
    const amount = parseAmountExpression(simpleExpr[2]);
    if (amount !== null) {
      const detected = detectParticipants(cleaned, input.users, input.sender);
      return [buildDraft({ type: simpleExpr[1], amount, date: withDate.date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText: line, categories: input.categories, confidence: 0.87 })];
    }
  }
  const amountOnly = cleaned.match(PATTERNS.amountOnly);
  if (amountOnly) return [buildDraft({ type: "general", amount: Number.parseFloat(amountOnly[1]), date: withDate.date, paidBy: input.sender.id, participants: input.users, userSelectionMode: "default-all", splits: [], sourceText: line, categories: input.categories, confidence: 0.65 })];
  const simple = cleaned.match(PATTERNS.simpleTypeAmount);
  if (simple) {
    const detected = detectParticipants(cleaned, input.users, input.sender);
    return [buildDraft({ type: simple[1], amount: Number.parseFloat(simple[2]), date: withDate.date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText: line, categories: input.categories, confidence: 0.88 })];
  }
  const reverse = cleaned.match(PATTERNS.amountThenType);
  if (reverse) {
    const detected = detectParticipants(cleaned, input.users, input.sender);
    return [buildDraft({ type: reverse[2], amount: Number.parseFloat(reverse[1]), date: withDate.date, paidBy: input.sender.id, participants: detected.participants, userSelectionMode: detected.explicitMention ? "mentioned" : "default-all", splits: [], sourceText: line, categories: input.categories, confidence: 0.81 })];
  }
  const fallback = parseGeneralNaturalLine(cleaned, input, withDate.date, line);
  return fallback ? [fallback] : [];
}

function parseTypeEachWithParticipantList(lines: string[], input: ParserInput, now: Date): ParsedExpenseDraft | null {
  if (lines.length < 2) return null;
  const header = /^([a-z][a-z\s+&-]{1,60}?)\s+each\s+(\d+(?:\.\d+)?)$/i.exec(lines[0]);
  if (!header) return null;
  const type = normalizeExpenseType(header[1]);
  const eachAmount = Number.parseFloat(header[2]);
  if (!type || type === "general" || Number.isNaN(eachAmount) || eachAmount <= 0) return null;
  const participants: ParserUser[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const token = normalizeToken(lines[i]);
    if (!token) continue;
    const user = resolveUserToken(token, input.users);
    if (!user) return null;
    if (!participants.some((p) => p.id === user.id)) participants.push(user);
  }
  if (participants.length === 0) return null;
  const splits: ParsedSplitHint[] = participants.map((p) => ({ userId: p.id, userName: p.name, amount: eachAmount }));
  return buildDraft({ type, amount: round2(eachAmount * participants.length), date: format(now, "yyyy-MM-dd"), paidBy: input.sender.id, participants, userSelectionMode: "mentioned", splits, sourceText: lines.join("\n"), categories: input.categories, confidence: 0.95 });
}

function parseTypeWithNamedAmounts(lines: string[], input: ParserInput, now: Date): ParsedExpenseDraft | null {
  if (lines.length < 2) return null;
  const type = normalizeExpenseType(lines[0]);
  if (!type || type === "general") return null;
  const participants: ParserUser[] = [];
  const splits: ParsedSplitHint[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = normalizeToken(lines[i]);
    const pair = /^([a-z][a-z\s]{0,40}?)\s+(\d+(?:\.\d+)?)$/i.exec(line);
    if (!pair) return null;
    const user = resolveUserToken(pair[1], input.users);
    if (!user) return null;
    const amount = Number.parseFloat(pair[2]);
    if (Number.isNaN(amount) || amount < 0) return null;
    if (!participants.some((p) => p.id === user.id)) participants.push(user);
    splits.push({ userId: user.id, userName: user.name, amount });
  }
  if (splits.length === 0) return null;
  return buildDraft({ type, amount: round2(splits.reduce((sum, s) => sum + s.amount, 0)), date: format(now, "yyyy-MM-dd"), paidBy: input.sender.id, participants, userSelectionMode: "mentioned", splits, sourceText: lines.join("\n"), categories: input.categories, confidence: 0.94 });
}

function parseAmountWithParticipantList(lines: string[], input: ParserInput, now: Date): ParsedExpenseDraft | null {
  if (lines.length < 2) return null;
  let type = "general";
  let firstAmount = Number.parseFloat(lines[0]);
  if (Number.isNaN(firstAmount) || firstAmount <= 0) {
    const typed = lines[0].match(PATTERNS.simpleTypeAmount);
    if (!typed) return null;
    type = normalizeExpenseType(typed[1]);
    firstAmount = Number.parseFloat(typed[2]);
    if (Number.isNaN(firstAmount) || firstAmount <= 0) return null;
  }
  const participants: ParserUser[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = normalizeToken(lines[i]);
    if (!line) continue;
    const user = resolveUserToken(line, input.users);
    if (!user) return null;
    if (!participants.some((p) => p.id === user.id)) participants.push(user);
  }
  if (participants.length === 0) return null;
  return buildDraft({ type, amount: firstAmount, date: format(now, "yyyy-MM-dd"), paidBy: input.sender.id, participants, userSelectionMode: "mentioned", splits: [], sourceText: lines.join("\n"), categories: input.categories, confidence: 0.9 });
}

function parseInlineAmountWithParticipantList(text: string, input: ParserInput, now: Date): ParsedExpenseDraft | null {
  const normalized = normalizeToken(text);
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const firstAmount = Number.parseFloat(parts[0]);
  if (Number.isNaN(firstAmount) || firstAmount <= 0) return null;
  const participants: ParserUser[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    const user = resolveUserToken(parts[i], input.users);
    if (!user) return null;
    if (!participants.some((p) => p.id === user.id)) participants.push(user);
  }
  if (participants.length === 0) return null;
  return buildDraft({ type: "general", amount: firstAmount, date: format(now, "yyyy-MM-dd"), paidBy: input.sender.id, participants, userSelectionMode: "mentioned", splits: [], sourceText: text, categories: input.categories, confidence: 0.89 });
}

function parseExpenseMessage(input: ParserInput): ParsedExpenseDraft[] {
  const now = input.now ?? new Date();
  const normalized = normalizeText(input.text);
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const groupedTypeEachSplit = parseTypeEachWithParticipantList(lines, input, now);
  if (groupedTypeEachSplit) return [groupedTypeEachSplit];
  const groupedAmountSplit = parseAmountWithParticipantList(lines, input, now);
  if (groupedAmountSplit) return [groupedAmountSplit];
  const groupedTypeWithNamedAmounts = parseTypeWithNamedAmounts(lines, input, now);
  if (groupedTypeWithNamedAmounts) return [groupedTypeWithNamedAmounts];
  const inlineAmountSplit = parseInlineAmountWithParticipantList(normalized, input, now);
  if (inlineAmountSplit) return [inlineAmountSplit];
  const drafts: ParsedExpenseDraft[] = [];
  for (const line of lines) drafts.push(...parseLine(line, input, now));
  return drafts.filter((d) => d.amount > 0 && Number.isFinite(d.amount));
}

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

// Helper to send Telegram message using fetch (more reliable in serverless)
async function sendTelegramMessage(token: string, chatId: number | string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  console.log(`Sending Telegram message to chat ${chatId}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error(`Telegram API error: ${response.status}`, result);
    } else {
      console.log(`Telegram message sent successfully to ${chatId}`);
    }
  } catch (err) {
    console.error(`Failed to send Telegram message:`, err);
  }
}

// Helper to send message with undo button
async function sendTelegramMessageWithUndo(token: string, chatId: number | string, text: string, expenseIds: string[]): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const undoData = expenseIds.length === 1 ? `undo:${expenseIds[0]}` : `undo:${expenseIds.join(',').slice(0, 50)}`;
  const replyMarkup = {
    inline_keyboard: [[{ text: "↩️ Undo (30m)", callback_data: undoData }]]
  };
  const undoHint = `\n\n↩️ Tap Undo within 30 minutes to remove this expense${expenseIds.length > 1 ? 's' : ''}.`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text + undoHint, reply_markup: replyMarkup }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error(`Telegram API error: ${response.status}`, result);
    }
  } catch (err) {
    console.error(`Failed to send Telegram message with undo:`, err);
  }
}

// Helper to answer callback query
async function answerCallbackQuery(token: string, callbackId: string, text?: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text }),
    });
  } catch (err) {
    console.error(`Failed to answer callback query:`, err);
  }
}

// Helper to edit message (remove undo button after use)
async function editMessageReplyMarkup(token: string, chatId: number | string, messageId: number): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
    });
  } catch (err) {
    console.error(`Failed to edit message:`, err);
  }
}

const UNDO_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

async function handleTelegramUpdate(update: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("TELEGRAM_BOT_TOKEN not set. Skipping telegram update.");
    return;
  }

  // Handle callback query (undo button)
  if (update.callback_query) {
    const query = update.callback_query;
    const callbackId = query.id;
    const data = query.data || '';
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    
    if (data.startsWith('undo:') && chatId) {
      const expenseIdsStr = data.slice('undo:'.length);
      const expenseIds = expenseIdsStr.split(',').filter(Boolean);
      
      if (expenseIds.length === 0) {
        await answerCallbackQuery(token, callbackId, 'No expense to undo.');
        return;
      }
      
      const sql = getSql();
      let deleted = 0;
      const deletedItems: string[] = [];
      
      for (const expenseId of expenseIds) {
        try {
          // Check if expense exists and is within undo window
          const [expense] = await sql`
            SELECT id, description, amount, created_at FROM expenses WHERE id = ${expenseId}
          `;
          
          if (!expense) {
            continue;
          }
          
          const createdAt = new Date(expense.created_at).getTime();
          if (Date.now() - createdAt > UNDO_WINDOW_MS) {
            await answerCallbackQuery(token, callbackId, '⌛ Undo window expired (30 minutes).');
            if (messageId) await editMessageReplyMarkup(token, chatId, messageId);
            return;
          }
          
          // Delete the expense
          await sql`DELETE FROM expenses WHERE id = ${expenseId}`;
          deleted++;
          deletedItems.push(`• ${expense.description} - ₹${Number(expense.amount).toFixed(2)}`);
        } catch (err) {
          console.error(`Failed to delete expense ${expenseId}:`, err);
        }
      }
      
      // Remove undo button from message
      if (messageId) await editMessageReplyMarkup(token, chatId, messageId);
      
      if (deleted > 0) {
        const details = deletedItems.length > 0 ? `\n\n${deletedItems.join('\n')}` : '';
        await answerCallbackQuery(token, callbackId, `✅ Deleted ${deleted} expense(s)`);
        await sendTelegramMessage(token, chatId, `✅ Undo successful. Deleted ${deleted} expense(s).${details}`);
      } else {
        await answerCallbackQuery(token, callbackId, '⚠️ Nothing to undo.');
      }
    } else {
      await answerCallbackQuery(token, callbackId);
    }
    return;
  }

  // Handle regular message
    return;
  }

  const msg = update.message;
  if (!msg || !msg.text) return;

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  // Handle /start command
  if (text === "/start") {
    await sendTelegramMessage(token, chatId, [
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
    await sendTelegramMessage(token, chatId, formatParseError());
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
      await sendTelegramMessage(token, chatId, `❌ User "${msg.from?.first_name || msg.from?.username}" not found in the system.\n\nPlease ask your admin to add you with a matching name.`);
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
        await sendTelegramMessage(token, chatId, formatParseError());
      }
      return;
    }

    const savedEntries: Array<{
      expenseId: string;
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

      // Insert expense and get its ID
      const [inserted] = await sql`
        INSERT INTO expenses (date, month, description, amount, category_id, paid_by, split_type, splits, created_at, serial_no)
        VALUES (${draft.date}, ${month}, ${draft.type + " (via Telegram)"}, ${effectiveAmount}, ${category.id}, ${payer.id}, ${draft.splits.length > 0 ? "custom" : "equal"}, ${JSON.stringify(splits)}, ${new Date().toISOString()}, ${nextSerial})
        RETURNING id
      `;

      savedEntries.push({
        expenseId: inserted.id,
        draft: { ...draft, amount: effectiveAmount },
        splitUsers,
        splits: splitDetails,
      });
    }

    if (savedEntries.length === 0) {
      await sendTelegramMessage(token, chatId, formatParseError());
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
      await sendTelegramMessageWithUndo(token, chatId, message, [savedEntries[0].expenseId]);
    } else {
      const defaultedToActive = savedEntries.some((e) => e.draft.userSelectionMode === "default-all");
      const expenseIds = savedEntries.map((e) => e.expenseId);
      await sendTelegramMessageWithUndo(token, chatId, formatMultipleExpensesResponse(savedEntries.map((s) => ({ draft: s.draft })), defaultedToActive), expenseIds);
    }
  } catch (error) {
    console.error("Telegram message handling failed:", error);
    try {
      await sendTelegramMessage(token, chatId, formatParseError());
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }
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

// DELETE /api/months/:month/delete — delete month completely
app.delete("/api/months/:month/delete", async (req: Request, res: Response) => {
  try {
    const sql = getSql();
    const { month } = req.params;
    await sql`DELETE FROM month_status WHERE month = ${month}`;
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to delete month" });
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
