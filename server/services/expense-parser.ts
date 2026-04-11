import { format, parse, subDays } from "date-fns";

export interface ParserUser {
  id: string;
  name: string;
  username?: string;
}

export interface ParserCategory {
  id: string;
  name: string;
}

export interface ParsedSplitHint {
  userId: string;
  userName: string;
  amount: number;
}

export interface ParsedExpenseDraft {
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

export interface ParserInput {
  text: string;
  users: ParserUser[];
  categories: ParserCategory[];
  sender: ParserUser;
  now?: Date;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  rent: ["rent"],
  wifi: ["wifi", "internet", "broadband"],
  electricity: ["current", "electricity", "eb"],
  gas: ["gas", "cylinder"],
  groceries: [
    "groceries",
    "grocery",
    "vegetables",
    "veggies",
    "veg",
    "onions",
    "milk",
    "curd",
    "tea",
    "oil",
    "water",
    "chicken",
    "chips",
  ],
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

export function parseExpenseMessage(input: ParserInput): ParsedExpenseDraft[] {
  const now = input.now ?? new Date();
  const normalized = normalizeText(input.text);
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  const groupedTypeEachSplit = parseTypeEachWithParticipantList(lines, input, now);
  if (groupedTypeEachSplit) {
    return [groupedTypeEachSplit];
  }

  const groupedAmountSplit = parseAmountWithParticipantList(lines, input, now);
  if (groupedAmountSplit) {
    return [groupedAmountSplit];
  }

  const groupedTypeWithNamedAmounts = parseTypeWithNamedAmounts(lines, input, now);
  if (groupedTypeWithNamedAmounts) {
    return [groupedTypeWithNamedAmounts];
  }

  const inlineAmountSplit = parseInlineAmountWithParticipantList(normalized, input, now);
  if (inlineAmountSplit) {
    return [inlineAmountSplit];
  }

  const drafts: ParsedExpenseDraft[] = [];
  for (const line of lines) {
    drafts.push(...parseLine(line, input, now));
  }

  return drafts.filter((d) => d.amount > 0 && Number.isFinite(d.amount));
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
    if (!participants.some((p) => p.id === user.id)) {
      participants.push(user);
    }
  }

  if (participants.length === 0) return null;

  const splits: ParsedSplitHint[] = participants.map((p) => ({
    userId: p.id,
    userName: p.name,
    amount: eachAmount,
  }));

  return buildDraft({
    type,
    amount: round2(eachAmount * participants.length),
    date: format(now, "yyyy-MM-dd"),
    paidBy: input.sender.id,
    participants,
    userSelectionMode: "mentioned",
    splits,
    sourceText: lines.join("\n"),
    categories: input.categories,
    confidence: 0.95,
  });
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

    if (!participants.some((p) => p.id === user.id)) {
      participants.push(user);
    }
    splits.push({ userId: user.id, userName: user.name, amount });
  }

  if (splits.length === 0) return null;
  const totalAmount = round2(splits.reduce((sum, s) => sum + s.amount, 0));

  return buildDraft({
    type,
    amount: totalAmount,
    date: format(now, "yyyy-MM-dd"),
    paidBy: input.sender.id,
    participants,
    userSelectionMode: "mentioned",
    splits,
    sourceText: lines.join("\n"),
    categories: input.categories,
    confidence: 0.94,
  });
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
    if (!user) {
      return null;
    }
    if (!participants.some((p) => p.id === user.id)) {
      participants.push(user);
    }
  }

  if (participants.length === 0) return null;

  return buildDraft({
    type,
    amount: firstAmount,
    date: format(now, "yyyy-MM-dd"),
    paidBy: input.sender.id,
    participants,
    userSelectionMode: "mentioned",
    splits: [],
    sourceText: lines.join("\n"),
    categories: input.categories,
    confidence: 0.9,
  });
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
    if (!user) {
      return null;
    }
    if (!participants.some((p) => p.id === user.id)) {
      participants.push(user);
    }
  }

  if (participants.length === 0) return null;

  return buildDraft({
    type: "general",
    amount: firstAmount,
    date: format(now, "yyyy-MM-dd"),
    paidBy: input.sender.id,
    participants,
    userSelectionMode: "mentioned",
    splits: [],
    sourceText: text,
    categories: input.categories,
    confidence: 0.89,
  });
}

export function inferCategory(type: string, categories: ParserCategory[]): ParserCategory | undefined {
  const normalizedType = normalizeToken(type);

  const learned = learnedTypeToCategory.get(normalizedType);
  if (learned) {
    const cached = categories.find((c) => normalizeToken(c.name) === learned);
    if (cached) return cached;
  }

  for (const [label, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => containsWordOrPhrase(normalizedType, w))) {
      const preferred = CATEGORY_PREFERRED_NAMES[label] || [];
      const found =
        preferred.map((name) => findCategoryByWord(name, categories)).find(Boolean) ||
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

function parseLine(line: string, input: ParserInput, now: Date): ParsedExpenseDraft[] {
  const withDate = extractDate(line, now);
  const cleaned = normalizeContextWords(withDate.text);
  if (!cleaned) return [];

  const leadingNameAmount = cleaned.match(PATTERNS.leadingNameAmount);
  if (leadingNameAmount) {
    const amount = Number.parseFloat(leadingNameAmount[2]);
    if (!Number.isNaN(amount) && amount > 0) {
      const detected = detectParticipants(cleaned, input.users, input.sender);
      return [
        buildDraft({
          type: leadingNameAmount[1],
          amount,
          date: withDate.date,
          paidBy: input.sender.id,
          participants: detected.participants,
          userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
          splits: [],
          sourceText: line,
          categories: input.categories,
          confidence: 0.84,
        }),
      ];
    }
  }

  const eachSplit = parseEachSplit(cleaned, input.users);
  if (eachSplit) {
    return [
      buildDraft({
        type: eachSplit.type,
        amount: eachSplit.totalAmount,
        date: withDate.date,
        paidBy: input.sender.id,
        participants: eachSplit.participants,
        userSelectionMode: "mentioned",
        splits: eachSplit.splits,
        sourceText: line,
        categories: input.categories,
        confidence: 0.93,
      }),
    ];
  }

  const eachNoNames = parseEachSplitWithoutNames(cleaned, input.users);
  if (eachNoNames) {
    return [
      buildDraft({
        type: eachNoNames.type,
        amount: eachNoNames.eachAmount,
        date: withDate.date,
        paidBy: input.sender.id,
        participants: eachNoNames.participants,
        userSelectionMode: "default-all",
        splits: [],
        perHeadAmount: eachNoNames.eachAmount,
        sourceText: line,
        categories: input.categories,
        confidence: 0.91,
      }),
    ];
  }

  const namedSplit = parseNamedSplitWithTotal(cleaned, input.users);
  if (namedSplit) {
    return [
      buildDraft({
        type: namedSplit.type,
        amount: namedSplit.totalAmount,
        date: withDate.date,
        paidBy: input.sender.id,
        participants: namedSplit.participants,
        userSelectionMode: "mentioned",
        splits: namedSplit.splits,
        sourceText: line,
        categories: input.categories,
        confidence: namedSplit.confidence,
      }),
    ];
  }

  const namedSplitNoTotal = parseNamedSplitWithoutTotal(cleaned, input.users);
  if (namedSplitNoTotal) {
    return [
      buildDraft({
        type: namedSplitNoTotal.type,
        amount: namedSplitNoTotal.totalAmount,
        date: withDate.date,
        paidBy: input.sender.id,
        participants: namedSplitNoTotal.participants,
        userSelectionMode: "mentioned",
        splits: namedSplitNoTotal.splits,
        sourceText: line,
        categories: input.categories,
        confidence: 0.9,
      }),
    ];
  }

  const multi = parseMultiItems(cleaned, input, withDate.date, line);
  if (multi.length > 0) return multi;

  const multiAmountFirst = parseMultiItemsAmountFirst(cleaned, input, withDate.date, line);
  if (multiAmountFirst.length > 0) return multiAmountFirst;

  const simpleExpr = cleaned.match(PATTERNS.simpleTypeAmountExpression);
  if (simpleExpr) {
    const amount = parseAmountExpression(simpleExpr[2]);
    if (amount !== null) {
      const detected = detectParticipants(cleaned, input.users, input.sender);
      return [
        buildDraft({
          type: simpleExpr[1],
          amount,
          date: withDate.date,
          paidBy: input.sender.id,
          participants: detected.participants,
          userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
          splits: [],
          sourceText: line,
          categories: input.categories,
          confidence: 0.87,
        }),
      ];
    }
  }

  const amountOnly = cleaned.match(PATTERNS.amountOnly);
  if (amountOnly) {
    return [
      buildDraft({
        type: "general",
        amount: Number.parseFloat(amountOnly[1]),
        date: withDate.date,
        paidBy: input.sender.id,
        participants: input.users,
        userSelectionMode: "default-all",
        splits: [],
        sourceText: line,
        categories: input.categories,
        confidence: 0.65,
      }),
    ];
  }

  const simple = cleaned.match(PATTERNS.simpleTypeAmount);
  if (simple) {
    const detected = detectParticipants(cleaned, input.users, input.sender);
    return [
      buildDraft({
        type: simple[1],
        amount: Number.parseFloat(simple[2]),
        date: withDate.date,
        paidBy: input.sender.id,
        participants: detected.participants,
        userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
        splits: [],
        sourceText: line,
        categories: input.categories,
        confidence: 0.88,
      }),
    ];
  }

  const reverse = cleaned.match(PATTERNS.amountThenType);
  if (reverse) {
    const detected = detectParticipants(cleaned, input.users, input.sender);
    return [
      buildDraft({
        type: reverse[2],
        amount: Number.parseFloat(reverse[1]),
        date: withDate.date,
        paidBy: input.sender.id,
        participants: detected.participants,
        userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
        splits: [],
        sourceText: line,
        categories: input.categories,
        confidence: 0.81,
      }),
    ];
  }

  const fallback = parseGeneralNaturalLine(cleaned, input, withDate.date, line);
  return fallback ? [fallback] : [];
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

  return {
    type: "general",
    totalAmount: round2(amount * participants.length),
    participants,
    splits: participants.map((p) => ({ userId: p.id, userName: p.name, amount })),
  };
}

function parseEachSplitWithoutNames(text: string, users: ParserUser[]): { type: string; eachAmount: number; participants: ParserUser[] } | null {
  let typeRaw: string | undefined;
  let amountRaw: string | undefined;

  const a = text.match(PATTERNS.eachSplitNoNamesTypeEachAmount);
  if (a) {
    typeRaw = a[1];
    amountRaw = a[2];
  }

  const b = !typeRaw ? text.match(PATTERNS.eachSplitNoNamesTypeAmountEach) : null;
  if (b) {
    typeRaw = b[1];
    amountRaw = b[2];
  }

  const c = !typeRaw ? text.match(PATTERNS.eachSplitNoNamesEachTypeAmount) : null;
  if (c) {
    typeRaw = c[1];
    amountRaw = c[2];
  }

  const d = !typeRaw ? text.match(PATTERNS.eachSplitNoNamesAmountTypeEach) : null;
  if (d) {
    typeRaw = d[2];
    amountRaw = d[1];
  }

  if (!typeRaw || !amountRaw) return null;

  const eachAmount = Number.parseFloat(amountRaw);
  if (Number.isNaN(eachAmount) || eachAmount <= 0) return null;

  const participants = users;
  if (participants.length === 0) return null;

  return {
    type: normalizeExpenseType(typeRaw),
    eachAmount,
    participants,
  };
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

  return {
    type,
    totalAmount,
    participants,
    splits,
    confidence: diff <= 1 ? 0.95 : 0.8,
  };
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

  const totalAmount = round2(splits.reduce((sum, s) => sum + s.amount, 0));
  return { type, totalAmount, participants, splits };
}

function parseMultiItems(text: string, input: ParserInput, date: string, sourceText: string): ParsedExpenseDraft[] {
  const matches = Array.from(text.matchAll(PATTERNS.multiItem));
  if (matches.length <= 1) return [];

  const detected = detectParticipants(text, input.users, input.sender);

  return matches
    .map((match) => {
      const amount = Number.parseFloat(match[2]);
      if (Number.isNaN(amount) || amount <= 0) return null;

      return buildDraft({
        type: sanitizeTypeText(match[1], detected.participants),
        amount,
        date,
        paidBy: input.sender.id,
        participants: detected.participants,
        userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
        splits: [],
        sourceText,
        categories: input.categories,
        confidence: 0.86,
      });
    })
    .filter((v): v is ParsedExpenseDraft => v !== null);
}

function parseMultiItemsAmountFirst(text: string, input: ParserInput, date: string, sourceText: string): ParsedExpenseDraft[] {
  const matches = Array.from(text.matchAll(PATTERNS.multiItemAmountFirst));
  if (matches.length <= 1) return [];

  const detected = detectParticipants(text, input.users, input.sender);

  return matches
    .map((match) => {
      const amount = Number.parseFloat(match[1]);
      if (Number.isNaN(amount) || amount <= 0) return null;

      return buildDraft({
        type: sanitizeTypeText(match[2], detected.participants),
        amount,
        date,
        paidBy: input.sender.id,
        participants: detected.participants,
        userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
        splits: [],
        sourceText,
        categories: input.categories,
        confidence: 0.86,
      });
    })
    .filter((v): v is ParsedExpenseDraft => v !== null);
}

function parseGeneralNaturalLine(text: string, input: ParserInput, date: string, sourceText: string): ParsedExpenseDraft | null {
  const amountMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (!amountMatch) return null;

  const amount = Number.parseFloat(amountMatch[1]);
  if (Number.isNaN(amount) || amount <= 0) return null;

  const before = text.slice(0, amountMatch.index).trim();
  const after = text.slice((amountMatch.index || 0) + amountMatch[1].length).trim();
  const detected = detectParticipants(text, input.users, input.sender);

  return buildDraft({
    type: sanitizeTypeText(after || before || "general", detected.participants),
    amount,
    date,
    paidBy: input.sender.id,
    participants: detected.participants,
    userSelectionMode: detected.explicitMention ? "mentioned" : "default-all",
    splits: [],
    sourceText,
    categories: input.categories,
    confidence: 0.62,
  });
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

  return {
    participants: found.length > 0 ? found : users,
    explicitMention,
  };
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

  return {
    date: format(resolved, "yyyy-MM-dd"),
    text: cleaned.replace(/\s{2,}/g, " ").trim(),
  };
}

function buildDraft(args: {
  type: string;
  amount: number;
  date: string;
  paidBy: string;
  participants: ParserUser[];
  userSelectionMode: "mentioned" | "default-all";
  splits: ParsedSplitHint[];
  perHeadAmount?: number;
  sourceText: string;
  categories: ParserCategory[];
  confidence: number;
}): ParsedExpenseDraft {
  const type = normalizeExpenseType(args.type || "general");
  return {
    type,
    amount: round2(args.amount),
    date: args.date,
    paidBy: args.paidBy,
    participants: args.participants,
    userSelectionMode: args.userSelectionMode,
    splits: args.splits,
    perHeadAmount: args.perHeadAmount,
    confidence: args.confidence,
    sourceText: args.sourceText,
    categoryHint: inferCategory(type, args.categories)?.name,
  };
}

function sanitizeTypeText(raw: string, participants: ParserUser[]): string {
  let value = normalizeExpenseType(raw)
    .replaceAll(/^and\s+/g, "")
    .replaceAll(/^me\s+and\s+/g, "")
    .replaceAll(/^me\s+/g, "")
    .trim();

  for (const participant of participants) {
    const first = normalizeToken(participant.name).split(" ")[0];
    if (!first) continue;
    value = value.replace(new RegExp(`^${escapeRegex(first)}\\s+`, "i"), "").trim();
  }

  return value || "general";
}

function normalizeText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("₹", " ").replaceAll("rs.", " ").replaceAll("rs", " ").trim();
}

function normalizeContextWords(text: string): string {
  return text
    .replaceAll(/\bmeans to\b/gi, " ")
    .replaceAll(/\bfor\b/gi, " for ")
    .replaceAll(/\s{2,}/g, " ")
    .trim();
}

function parseAmountExpression(value: string): number | null {
  if (!value.includes("+")) {
    const n = Number.parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }

  const parts = value
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => Number.parseFloat(p));

  if (parts.length < 2 || parts.some((n) => Number.isNaN(n))) return null;
  return round2(parts.reduce((sum, n) => sum + n, 0));
}

function normalizeExpenseType(type: string): string {
  return normalizeToken(type).replace(/\bexpense\b/g, " ").replace(/\bfor\b/g, " ").replace(/\s+/g, " ").trim() || "general";
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s+&-]/g, " ").replace(/\s+/g, " ").trim();
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

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
