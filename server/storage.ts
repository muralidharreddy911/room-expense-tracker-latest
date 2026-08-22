import { users, categories, monthStatus, settlements, expenses, activeUsersByMonth, cleaningAttendance, type User, type InsertUser, type CleaningAttendanceRecord } from "@shared/schema";
import { db } from "./db";
import { and, eq, or } from "drizzle-orm";

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

  // Cleaning Attendance
  createCleaningAttendance(attendance: any): Promise<any>;
  updateCleaningAttendanceStatus(id: string, status: string, approvedBy?: string): Promise<any>;
  getCleaningAttendanceByMonth(month: string): Promise<any[]>;
  getCleaningAttendance(id: string): Promise<any | undefined>;
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
      db.select().from(settlements),
    ]);

    // Try to fetch cleaning attendance, but don't fail if table doesn't exist
    let allCleaningAttendance: any[] = [];
    try {
      allCleaningAttendance = await db.select().from(cleaningAttendance);
    } catch (err) {
      // Table might not exist yet - log and continue
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (!errorMsg.includes('does not exist')) {
        // Only log if it's not a "table doesn't exist" error
        console.warn("Warning: Could not fetch cleaning attendance:", errorMsg);
      }
    }

    return {
      users: allUsers,
      categories: allCategories,
      expenses: allExpenses,
      monthStatus: allMonthStatus,
      settlements: allSettlements,
      cleaningAttendance: allCleaningAttendance
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

  // Cleaning Attendance Methods
  async createCleaningAttendance(attendance: any): Promise<any> {
    // Validate required fields
    const requiredFields = ['date', 'month', 'cleaningType', 'userId', 'status', 'createdAt'];
    const missingFields = requiredFields.filter(field => !(field in attendance));
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    // Log field types and values for debugging
    console.log('Cleaning attendance insert values:');
    console.log('  date:', typeof attendance.date, attendance.date);
    console.log('  month:', typeof attendance.month, attendance.month);
    console.log('  cleaningType:', typeof attendance.cleaningType, attendance.cleaningType);
    console.log('  userId:', typeof attendance.userId, attendance.userId);
    console.log('  remarks:', typeof attendance.remarks, attendance.remarks);
    console.log('  status:', typeof attendance.status, attendance.status);
    console.log('  createdAt:', typeof attendance.createdAt, attendance.createdAt);
    console.log('  approvedBy:', typeof attendance.approvedBy, attendance.approvedBy);
    console.log('  approvedAt:', typeof attendance.approvedAt, attendance.approvedAt);

    try {
      const [created] = await db.insert(cleaningAttendance).values(attendance).returning();
      console.log('Successfully inserted attendance record:', created);
      return created;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Drizzle insert error:', errMsg);
      if (errMsg.includes('column') || errMsg.includes('does not exist')) {
        console.error('This looks like a schema/table issue. Check if cleaningAttendance table exists.');
      }
      throw err;
    }
  }

  async updateCleaningAttendanceStatus(id: string, status: string, approvedBy?: string): Promise<any> {
    const updateData: any = { status };
    if (approvedBy) {
      updateData.approvedBy = approvedBy;
      updateData.approvedAt = new Date().toISOString();
    }
    const [updated] = await db.update(cleaningAttendance).set(updateData).where(eq(cleaningAttendance.id, id)).returning();
    return updated;
  }

  async getCleaningAttendanceByMonth(month: string): Promise<any[]> {
    return await db.select().from(cleaningAttendance).where(eq(cleaningAttendance.month, month));
  }

  async getCleaningAttendance(id: string): Promise<any | undefined> {
    const [record] = await db.select().from(cleaningAttendance).where(eq(cleaningAttendance.id, id));
    return record;
  }
}

export const storage = new DatabaseStorage();
