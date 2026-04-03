export type Role = 'admin' | 'member';

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  avatar?: string;
  password?: string;
}

export interface Category {
  id: string;
  name: string;
  isDefault?: boolean;
}

export type SplitType = 'equal' | 'custom';

export interface Split {
  userId: string;
  amount: number;
}

export interface Expense {
  id: string;
  date: string; // ISO 8601
  month: string; // YYYY-MM
  description: string;
  amount: number;
  categoryId: string;
  paidBy: string; // userId
  splitType: SplitType;
  splits: Split[];
  serialNo?: number; // Auto-incremental display ID
  createdAt: string;
}

export interface Settlement {
  id: string;
  fromUser: string;
  toUser: string;
  amount: number;
  status: 'pending' | 'paid';
  month: string; // YYYY-MM related to this settlement
  createdAt: string;
}

export interface MonthStatus {
  id?: string;
  month: string; // YYYY-MM
  isLocked: boolean;
}
