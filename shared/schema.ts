import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, jsonb, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  password: text("password").notNull(),
  role: text("role").notNull().default("member"),
  avatar: text("avatar"),
});

export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  isDefault: boolean("is_default").default(false),
});

export const monthStatus = pgTable("month_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  month: text("month").notNull().unique(), // YYYY-MM
  isLocked: boolean("is_locked").default(false),
});

export const settlements = pgTable("settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromUser: text("from_user").notNull(),
  toUser: text("to_user").notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("pending"),
  month: text("month").notNull(),
  createdAt: text("created_at").notNull(),
});

export const expenses = pgTable("expenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(),
  month: text("month").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  categoryId: text("category_id").notNull(),
  paidBy: text("paid_by").notNull(),
  splitType: text("split_type").notNull(),
  splits: jsonb("splits").notNull(), // User splits {userId, amount} array
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  name: true,
  role: true,
  avatar: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

