import { User, Category, Expense, MonthStatus, Settlement } from './types';
import { subDays, format } from 'date-fns';

export const INITIAL_USERS: User[] = [
  { id: 'u1', username: 'admin', name: 'Alex (Admin)', role: 'admin', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex', password: 'admin' },
  { id: 'u2', username: 'ben', name: 'Ben', role: 'member', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ben', password: 'password' },
  { id: 'u3', username: 'charlie', name: 'Charlie', role: 'member', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Charlie', password: 'password' },
  { id: 'u4', username: 'david', name: 'David', role: 'member', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David', password: 'password' },
];

export const INITIAL_CATEGORIES: Category[] = [
  { id: 'c1', name: 'Food', isDefault: true },
  { id: 'c2', name: 'Groceries', isDefault: true },
  { id: 'c3', name: 'Power', isDefault: true },
  { id: 'c4', name: 'Water', isDefault: true },
  { id: 'c5', name: 'Rent', isDefault: true },
  { id: 'c6', name: 'Internet', isDefault: true },
  { id: 'c7', name: 'Others', isDefault: true },
];

const today = new Date();
const currentMonth = format(today, 'yyyy-MM');
const lastMonth = format(subDays(today, 30), 'yyyy-MM');

export const INITIAL_EXPENSES: Expense[] = [
  {
    id: 'e1',
    date: format(subDays(today, 2), 'yyyy-MM-dd'),
    month: currentMonth,
    description: 'Weekly Groceries',
    amount: 150.00,
    categoryId: 'c2',
    paidBy: 'u1',
    splitType: 'equal',
    splits: [
      { userId: 'u1', amount: 37.50 },
      { userId: 'u2', amount: 37.50 },
      { userId: 'u3', amount: 37.50 },
      { userId: 'u4', amount: 37.50 },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'e2',
    date: format(subDays(today, 5), 'yyyy-MM-dd'),
    month: currentMonth,
    description: 'Pizza Night',
    amount: 45.00,
    categoryId: 'c1',
    paidBy: 'u2',
    splitType: 'equal',
    splits: [
      { userId: 'u1', amount: 15.00 },
      { userId: 'u2', amount: 15.00 },
      { userId: 'u3', amount: 15.00 },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'e3',
    date: format(subDays(today, 10), 'yyyy-MM-dd'),
    month: currentMonth,
    description: 'WiFi Bill',
    amount: 60.00,
    categoryId: 'c6',
    paidBy: 'u1',
    splitType: 'equal',
    splits: [
      { userId: 'u1', amount: 15.00 },
      { userId: 'u2', amount: 15.00 },
      { userId: 'u3', amount: 15.00 },
      { userId: 'u4', amount: 15.00 },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'e4',
    date: format(subDays(today, 35), 'yyyy-MM-dd'),
    month: lastMonth,
    description: 'Last Month Rent',
    amount: 2000.00,
    categoryId: 'c5',
    paidBy: 'u1',
    splitType: 'equal',
    splits: [
      { userId: 'u1', amount: 500.00 },
      { userId: 'u2', amount: 500.00 },
      { userId: 'u3', amount: 500.00 },
      { userId: 'u4', amount: 500.00 },
    ],
    createdAt: new Date().toISOString(),
  }
];

export const INITIAL_MONTH_STATUS: MonthStatus[] = [
  { month: lastMonth, isLocked: true },
  { month: currentMonth, isLocked: false },
];

export const INITIAL_SETTLEMENTS: Settlement[] = [
    {
        id: 's1',
        fromUser: 'u2',
        toUser: 'u1',
        amount: 500,
        status: 'paid',
        month: lastMonth,
        createdAt: format(subDays(today, 32), 'yyyy-MM-dd')
    }
];
