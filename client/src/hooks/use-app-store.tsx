import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  addSettlement: (settlement: Settlement) => Promise<void>;
  updateSettlement: (id: string, status: 'paid' | 'pending') => Promise<void>;
  updateUserPassword: (userId: string, newPassword: string) => Promise<boolean>;
  
  // Helpers
  getExpensesByMonth: (month: string) => Expense[];
  isMonthLocked: (month: string) => boolean;
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

  // Fetch from the Backend API entirely
  useEffect(() => {
    setIsLoading(true);
    fetch('/api/state')
      .then(r => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        setUsers(data.users || []);
        setCategories(data.categories || []);
        setExpenses(data.expenses || []);
        setMonthStatus(data.monthStatus || []);
        setSettlements(data.settlements || []);
      })
      .catch(err => console.error("Failed to fetch initial state:", err))
      .finally(() => setIsLoading(false));
  }, []);

  // Sync current user caching
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('currentUser', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('currentUser');
    }
  }, [currentUser]);

  const login = (username: string, password?: string) => {
    // Note: The UI may pass `userId` or `username` based on dropdowns. The backend uses `username`.
    // Searching by either ID or Username to be safe.
    const user = users.find(u => u.username === username || u.name === username || u.id === username);
    if (user) {
      if (user.password && user.password !== password) {
        toast({ title: "Invalid password", variant: "destructive" });
        return;
      }
      setCurrentUser(user);
      toast({ title: `Welcome back, ${user.name || user.username}` });
    } else {
      toast({ title: "User not found", variant: "destructive" });
    }
  };

  const logout = () => {
    setCurrentUser(null);
    toast({ title: "Logged out" });
  };

  const addUser = async (name: string, role: Role, password?: string) => {
    const payload = {
      username: name.toLowerCase().replace(/\s+/g, ''),
      name,
      role,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      password: password || 'password'
    };
    
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const newUser = await res.json();
      setUsers(prev => [...prev, newUser]);
      toast({ title: "User added" });
    } else {
      toast({ title: "Failed to add user", variant: "destructive" });
    }
  };

  const removeUser = async (userId: string) => {
    if (userId === currentUser?.id) {
      toast({ title: "Cannot remove yourself", variant: "destructive" });
      return;
    }
    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== userId));
      toast({ title: "User removed" });
    }
  };

  const addExpense = async (expense: Expense) => {
    // Generate ISO strings and format for PG
    const payload = { ...expense, createdAt: new Date().toISOString() };
    const res = await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const newExp = await res.json();
      setExpenses(prev => [newExp, ...prev]);
      toast({ title: "Expense added" });
    }
  };

  const updateExpense = async (updated: Expense) => {
    const res = await fetch(`/api/expenses/${updated.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    if (res.ok) {
      const savedExp = await res.json();
      setExpenses(prev => prev.map(e => e.id === savedExp.id ? savedExp : e));
      toast({ title: "Expense updated" });
    }
  };

  const deleteExpense = async (id: string) => {
    const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setExpenses(prev => prev.filter(e => e.id !== id));
      toast({ title: "Expense deleted" });
    }
  };

  const addCategory = async (name: string) => {
    // Duplicate check on frontend
    const duplicate = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      toast({ title: "Category already exists.", variant: "destructive" });
      return;
    }
    const payload = { name, isDefault: false };
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const newCat = await res.json();
      setCategories(prev => [...prev, newCat]);
      toast({ title: "Category added" });
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: err.error || "Failed to add category", variant: "destructive" });
    }
  };

  const deleteCategory = async (categoryId: string) => {
    // Safety: check if category is used in any expense
    const isUsed = expenses.some(e => e.categoryId === categoryId);
    if (isUsed) {
      toast({
        title: "Cannot delete category",
        description: "This category is used in existing expenses. Remove those expenses first.",
        variant: "destructive"
      });
      return;
    }
    const res = await fetch(`/api/categories/${categoryId}`, { method: 'DELETE' });
    if (res.ok) {
      setCategories(prev => prev.filter(c => c.id !== categoryId));
      toast({ title: "Category deleted" });
    } else {
      toast({ title: "Failed to delete category", variant: "destructive" });
    }
  };

  const addMonth = async (month: string) => {
    const existing = monthStatus.find(m => m.month === month);
    if (existing) return;
    
    const res = await fetch('/api/months', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, isLocked: false })
    });
    if (res.ok) {
      const newStatus = await res.json();
      setMonthStatus(prev => [...prev, newStatus]);
      toast({ title: `Month ${month} added` });
    }
  };

  const lockMonth = async (month: string) => {
    const res = await fetch('/api/months', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, isLocked: true })
    });
    if (res.ok) {
      const newStatus = await res.json();
      setMonthStatus(prev => {
        const remaining = prev.filter(m => m.month !== newStatus.month);
        return [...remaining, newStatus];
      });
      toast({ title: `Month ${month} locked` });
    }
  };

  const addSettlement = async (settlement: Settlement) => {
    const payload = { ...settlement, createdAt: new Date().toISOString() };
    const res = await fetch('/api/settlements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const newSet = await res.json();
      setSettlements(prev => [...prev, newSet]);
      toast({ title: "Settlement recorded" });
    }
  };

  const updateSettlement = async (id: string, status: 'paid' | 'pending') => {
    const res = await fetch(`/api/settlements/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) {
      const savedSet = await res.json();
      setSettlements(prev => prev.map(s => s.id === id ? savedSet : s));
      toast({ title: `Settlement marked as ${status}` });
    }
  };

  const updateUserPassword = async (userId: string, newPassword: string): Promise<boolean> => {
    const res = await fetch(`/api/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    });
    if (res.ok) {
      // Update the user list in state so login still works in same session
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, password: newPassword } : u));
      // Also update cached currentUser so stale password check doesn't confuse things
      if (currentUser?.id === userId) {
        const updatedUser = { ...currentUser, password: newPassword };
        setCurrentUser(updatedUser);
        localStorage.setItem('currentUser', JSON.stringify(updatedUser));
      }
      toast({ title: "Password updated successfully", description: "Please log in again with your new password." });
      return true;
    } else {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Failed to update password", description: err.error || "Please try again.", variant: "destructive" });
      return false;
    }
  };

  const getExpensesByMonth = (month: string) => {
    return expenses.filter(e => e.month === month);
  };

  const isMonthLocked = (month: string) => {
    return monthStatus.find(m => m.month === month)?.isLocked || false;
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
      addSettlement,
      updateSettlement,
      updateUserPassword,
      getExpensesByMonth,
      isMonthLocked
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
