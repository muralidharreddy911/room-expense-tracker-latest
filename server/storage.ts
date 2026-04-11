import { users, categories, monthStatus, settlements, expenses, activeUsersByMonth, type User, type InsertUser } from "@shared/schema";
import { db } from "./db";
import { and, eq } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: string, password: string): Promise<void>;
  deleteUser(id: string): Promise<void>;

  // Combined State Fetch
  getAppState(): Promise<any>;

  // Expenses
  createExpense(expense: any): Promise<any>;
  updateExpense(id: string, expense: any): Promise<any>;
  deleteExpense(id: string): Promise<void>;

  // Categories
  createCategory(category: any): Promise<any>;
  deleteCategory(id: string): Promise<void>;

  // Month Status
  upsertMonthStatus(month: string, isLocked: boolean): Promise<any>;
  deleteMonth(month: string): Promise<void>;

  // Active users by month
  getActiveUsers(month: string): Promise<User[]>;
  setActiveUsers(month: string, userIds: string[]): Promise<void>;

  // Settlements
  createSettlement(settlement: any): Promise<any>;
  updateSettlementStatus(id: string, status: string): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPassword(id: string, password: string): Promise<void> {
    await db.update(users).set({ password }).where(eq(users.id, id));
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getAppState(): Promise<any> {
    const [allUsers, allCategories, allExpenses, allMonthStatus, allSettlements] = await Promise.all([
      db.select().from(users),
      db.select().from(categories),
      db.select().from(expenses),
      db.select().from(monthStatus),
      db.select().from(settlements)
    ]);

    return {
      users: allUsers,
      categories: allCategories,
      expenses: allExpenses,
      monthStatus: allMonthStatus,
      settlements: allSettlements
    };
  }

  async createExpense(expense: any): Promise<any> {
    const [created] = await db.insert(expenses).values(expense).returning();
    return created;
  }

  async updateExpense(id: string, expense: any): Promise<any> {
    const [updated] = await db.update(expenses).set(expense).where(eq(expenses.id, id)).returning();
    return updated;
  }

  async deleteExpense(id: string): Promise<void> {
    await db.delete(expenses).where(eq(expenses.id, id));
  }

  async createCategory(category: any): Promise<any> {
    const [created] = await db.insert(categories).values(category).returning();
    return created;
  }

  async deleteCategory(id: string): Promise<void> {
    await db.delete(categories).where(eq(categories.id, id));
  }

  async upsertMonthStatus(month: string, isLocked: boolean): Promise<any> {
    const [existing] = await db.select().from(monthStatus).where(eq(monthStatus.month, month));
    if (existing) {
      const [updated] = await db.update(monthStatus).set({ isLocked }).where(eq(monthStatus.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(monthStatus).values({ month, isLocked }).returning();
      return created;
    }
  }

  async deleteMonth(month: string): Promise<void> {
    await db.delete(monthStatus).where(eq(monthStatus.month, month));
  }

  async getActiveUsers(month: string): Promise<User[]> {
    const links = await db
      .select()
      .from(activeUsersByMonth)
      .where(and(eq(activeUsersByMonth.month, month), eq(activeUsersByMonth.isActive, true)));

    if (links.length === 0) {
      return [];
    }

    const allUsers = await db.select().from(users);
    const activeIds = new Set(links.map((l) => l.userId));
    return allUsers.filter((u) => activeIds.has(u.id));
  }

  async setActiveUsers(month: string, userIds: string[]): Promise<void> {
    await db.delete(activeUsersByMonth).where(eq(activeUsersByMonth.month, month));

    if (userIds.length === 0) {
      return;
    }

    await db.insert(activeUsersByMonth).values(
      userIds.map((userId) => ({
        month,
        userId,
        isActive: true,
        updatedAt: new Date().toISOString(),
      }))
    );
  }

  async createSettlement(settlement: any): Promise<any> {
    const [created] = await db.insert(settlements).values(settlement).returning();
    return created;
  }

  async updateSettlementStatus(id: string, status: string): Promise<any> {
    const [updated] = await db.update(settlements).set({ status }).where(eq(settlements.id, id)).returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
