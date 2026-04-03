import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { User, Expense, Category, MonthStatus, Settlement, Role } from '../lib/types';
import { useToast } from './use-toast';

interface AppState {
  currentUser: User | null;
  users: User[];
  expenses: Expense[];
  categories: Category[];
  monthStatus: MonthStatus[];
  settlements: Settlement[];
  isLoading: boolean;

  login: (username: string, password?: string) => void;
  logout: () => void;
  addUser: (name: string, role: Role, password?: string) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  addExpense: (expense: Expense) => Promise<void>;
  updateExpense: (expense: Expense) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addCategory: (name: string) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
  addMonth: (month: string) => Promise<void>;
  lockMonth: (month: string) => Promise<void>;
  unlockMonth: (month: string) => Promise<void>;
  addSettlement: (settlement: Settlement) => Promise<void>;
  updateSettlement: (id: string, status: 'paid' | 'pending') => Promise<void>;
  updateUserPassword: (userId: string, newPassword: string) => Promise<boolean>;
  refreshState: () => Promise<void>;

  // Helpers
  getExpensesByMonth: (month: string) => Expense[];
  isMonthLocked: (month: string) => boolean;
  /** All admin-created months, sorted newest first */
  availableMonths: string[];
  /** Most recent unlocked month, or null if all locked / none exists */
  activeMonth: string | null;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('currentUser');
    return saved ? JSON.parse(saved) : null;
  });

  const [users, setUsers] = useState<User[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [monthStatus, setMonthStatus] = useState<MonthStatus[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // ── Core state fetcher (extracted so it can be called after mutations) ──────
  const fetchState = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const r = await fetch('/api/state');
      if (!r.ok) throw new Error(`API returned ${r.status}`);
      const data = await r.json();
      setUsers(data.users || []);
      setCategories(data.categories || []);
      setExpenses(data.expenses || []);
      setMonthStatus(data.monthStatus || []);
      setSettlements(data.settlements || []);
    } catch (err) {
      console.error('Failed to fetch state:', err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchState(true);
  }, [fetchState]);

  // Expose a public refresh method (used by UI refresh button)
  const refreshState = useCallback(() => fetchState(false), [fetchState]);

  // ── Persist current user in localStorage ────────────────────────────────────
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('currentUser');
    }
  }, [currentUser]);

  // ── Derived helpers ─────────────────────────────────────────────────────────
  /**
   * All admin-created months from monthStatus, newest first.
   * NOTE: the current calendar month is NOT added automatically here —
   * only months explicitly created by Admin are shown.
   */
  const availableMonths = [...monthStatus]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map(m => m.month);

  /**
   * The most recent UNLOCKED month, or null if all are locked / none exist.
   */
  const activeMonth: string | null =
    monthStatus
      .filter(m => !m.isLocked)
      .sort((a, b) => b.month.localeCompare(a.month))[0]?.month ?? null;

  const getExpensesByMonth = (month: string) =>
    expenses.filter(e => e.month === month);

  const isMonthLocked = (month: string) =>
    monthStatus.find(m => m.month === month)?.isLocked ?? false;

  // ── Auth ────────────────────────────────────────────────────────────────────
  const login = (username: string, password?: string) => {
    const user = users.find(u => u.username === username || u.name === username || u.id === username);
    if (user) {
      if (user.password && user.password !== password) {
        toast({ title: 'Invalid password', variant: 'destructive' });
        return;
      }
      setCurrentUser(user);
      toast({ title: `Welcome back, ${user.name || user.username}` });
    } else {
      toast({ title: 'User not found', variant: 'destructive' });
    }
  };

  const logout = () => {
    setCurrentUser(null);
    toast({ title: 'Logged out' });
  };

  // ── Users ───────────────────────────────────────────────────────────────────
  const addUser = async (name: string, role: Role, password?: string) => {
    const payload = {
      username: name.toLowerCase().replace(/\s+/g, ''),
      name,
      role,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      password: password || 'password',
    };
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      await fetchState(); // sync all data
      toast({ title: 'User added' });
    } else {
      toast({ title: 'Failed to add user', variant: 'destructive' });
    }
  };

  const removeUser = async (userId: string) => {
    if (userId === currentUser?.id) {
      toast({ title: 'Cannot remove yourself', variant: 'destructive' });
      return;
    }
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchState();
      toast({ title: 'User removed' });
    }
  };

  // ── Expenses ────────────────────────────────────────────────────────────────
  const addExpense = async (expense: Expense) => {
    const payload = { ...expense, createdAt: new Date().toISOString() };
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      await fetchState(); // refresh so serial_no is correct
      toast({ title: 'Expense added' });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: 'Failed to add expense', description: err.error || '', variant: 'destructive' });
    }
  };

  const updateExpense = async (updated: Expense) => {
    const res = await fetch(`/api/expenses/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updated, requestingUserId: currentUser?.id }),
    });
    if (res.ok) {
      await fetchState();
      toast({ title: 'Expense updated' });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: 'Cannot update expense', description: err.error || 'An error occurred.', variant: 'destructive' });
    }
  };

  const deleteExpense = async (id: string) => {
    if (!currentUser) return;
    const res = await fetch(`/api/expenses/${id}?userId=${encodeURIComponent(currentUser.id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setExpenses(prev => prev.filter(e => e.id !== id)); // optimistic
      toast({ title: 'Expense deleted' });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: 'Cannot delete expense', description: err.error || 'An error occurred.', variant: 'destructive' });
    }
  };

  // ── Categories ──────────────────────────────────────────────────────────────
  const addCategory = async (name: string) => {
    // Client-side duplicate guard (case-insensitive)
    const duplicate = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      toast({ title: 'Category already exists.', variant: 'destructive' });
      return;
    }
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, isDefault: false }),
    });
    if (res.ok) {
      await fetchState();
      toast({ title: 'Category added' });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: err.error || 'Failed to add category', variant: 'destructive' });
    }
  };

  const deleteCategory = async (categoryId: string) => {
    const isUsed = expenses.some(e => e.categoryId === categoryId);
    if (isUsed) {
      toast({
        title: 'Cannot delete category',
        description: 'This category is used in existing expenses. Remove those expenses first.',
        variant: 'destructive',
      });
      return;
    }
    const res = await fetch(`/api/categories/${categoryId}`, { method: 'DELETE' });
    if (res.ok) {
      setCategories(prev => prev.filter(c => c.id !== categoryId));
      toast({ title: 'Category deleted' });
    } else {
      toast({ title: 'Failed to delete category', variant: 'destructive' });
    }
  };

  // ── Month Management ────────────────────────────────────────────────────────
  const addMonth = async (month: string) => {
    const existing = monthStatus.find(m => m.month === month);
    if (existing) {
      toast({ title: `Month ${month} already exists`, variant: 'destructive' });
      return;
    }
    const res = await fetch('/api/months', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, isLocked: false }),
    });
    if (res.ok) {
      await fetchState();
      toast({ title: `Month ${month} activated` });
    }
  };

  const lockMonth = async (month: string) => {
    const res = await fetch('/api/months', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, isLocked: true }),
    });
    if (res.ok) {
      await fetchState();
      toast({ title: `Month ${month} locked` });
    }
  };

  const unlockMonth = async (month: string) => {
    const res = await fetch(`/api/months/${encodeURIComponent(month)}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchState();
      toast({ title: `Month ${month} unlocked` });
    }
  };

  // ── Settlements ─────────────────────────────────────────────────────────────
  const addSettlement = async (settlement: Settlement) => {
    const payload = { ...settlement, createdAt: new Date().toISOString() };
    const res = await fetch('/api/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      await fetchState(); // refresh so balances update for all
      toast({ title: 'Settlement recorded' });
    }
  };

  const updateSettlement = async (id: string, status: 'paid' | 'pending') => {
    const res = await fetch(`/api/settlements/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      await fetchState();
      toast({ title: `Settlement marked as ${status}` });
    }
  };

  // ── Password ────────────────────────────────────────────────────────────────
  const updateUserPassword = async (userId: string, newPassword: string): Promise<boolean> => {
    const res = await fetch(`/api/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    });
    if (res.ok) {
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, password: newPassword } : u));
      if (currentUser?.id === userId) {
        const updatedUser = { ...currentUser, password: newPassword };
        setCurrentUser(updatedUser);
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      }
      toast({ title: 'Password updated successfully', description: 'Please log in again with your new password.' });
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: 'Failed to update password', description: err.error || 'Please try again.', variant: 'destructive' });
      return false;
    }
  };

  return (
    <AppContext.Provider value={{
      currentUser,
      users,
      expenses,
      categories,
      monthStatus,
      settlements,
      isLoading,
      login,
      logout,
      addUser,
      removeUser,
      addExpense,
      updateExpense,
      deleteExpense,
      addCategory,
      deleteCategory,
      addMonth,
      lockMonth,
      unlockMonth,
      addSettlement,
      updateSettlement,
      updateUserPassword,
      refreshState,
      getExpensesByMonth,
      isMonthLocked,
      availableMonths,
      activeMonth,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
