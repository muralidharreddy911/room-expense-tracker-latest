import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Expense, Category, MonthStatus, Settlement, Role } from '../lib/types';
import { INITIAL_USERS, INITIAL_EXPENSES, INITIAL_CATEGORIES, INITIAL_MONTH_STATUS, INITIAL_SETTLEMENTS } from '../lib/mock-data';
import { useToast } from './use-toast';

interface AppState {
  currentUser: User | null;
  users: User[];
  expenses: Expense[];
  categories: Category[];
  monthStatus: MonthStatus[];
  settlements: Settlement[];
  
  login: (userId: string, password?: string) => void;
  logout: () => void;
  addUser: (name: string, role: Role, password?: string) => void;
  removeUser: (userId: string) => void;
  addExpense: (expense: Expense) => void;
  updateExpense: (expense: Expense) => void;
  deleteExpense: (id: string) => void;
  addCategory: (name: string) => void;
  addMonth: (month: string) => void;
  lockMonth: (month: string) => void;
  addSettlement: (settlement: Settlement) => void;
  updateSettlement: (id: string, status: 'paid' | 'pending') => void;
  updateUserPassword: (userId: string, newPassword: string) => void;
  
  // Helpers
  getExpensesByMonth: (month: string) => Expense[];
  isMonthLocked: (month: string) => boolean;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  
  // Load from localStorage or use initial mock data
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('currentUser');
    return saved ? JSON.parse(saved) : null;
  });

  const [users, setUsers] = useState<User[]>(() => {
    // Force a clear of old mock data if it exists in local storage
    const saved = localStorage.getItem('users');
    if (saved) {
      const parsed = JSON.parse(saved);
      // If we find 'Alex (Admin)' in the saved data, we clear it to reset to Muralidhar
      if (parsed.some((u: any) => u.name.includes('Alex'))) {
        localStorage.clear();
        return INITIAL_USERS;
      }
      return parsed;
    }
    return INITIAL_USERS;
  });
  
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const saved = localStorage.getItem('expenses');
    return saved ? JSON.parse(saved) : INITIAL_EXPENSES;
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('categories');
    return saved ? JSON.parse(saved) : INITIAL_CATEGORIES;
  });

  const [monthStatus, setMonthStatus] = useState<MonthStatus[]>(() => {
    const saved = localStorage.getItem('monthStatus');
    return saved ? JSON.parse(saved) : INITIAL_MONTH_STATUS;
  });

  const [settlements, setSettlements] = useState<Settlement[]>(() => {
    const saved = localStorage.getItem('settlements');
    return saved ? JSON.parse(saved) : INITIAL_SETTLEMENTS;
  });

  // Persistence effects
  useEffect(() => localStorage.setItem('currentUser', JSON.stringify(currentUser)), [currentUser]);
  useEffect(() => localStorage.setItem('users', JSON.stringify(users)), [users]);
  useEffect(() => localStorage.setItem('expenses', JSON.stringify(expenses)), [expenses]);
  useEffect(() => localStorage.setItem('categories', JSON.stringify(categories)), [categories]);
  useEffect(() => localStorage.setItem('monthStatus', JSON.stringify(monthStatus)), [monthStatus]);
  useEffect(() => localStorage.setItem('settlements', JSON.stringify(settlements)), [settlements]);

  const login = (userId: string, password?: string) => {
    const user = users.find(u => u.id === userId);
    if (user) {
      if (user.password && user.password !== password) {
        toast({ title: "Invalid password", variant: "destructive" });
        return;
      }
      setCurrentUser(user);
      toast({ title: `Welcome back, ${user.name}` });
    }
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
    toast({ title: "Logged out" });
  };

  const addUser = (name: string, role: Role, password?: string) => {
    const newUser: User = {
      id: `u${Date.now()}`,
      username: name.toLowerCase().replace(/\s+/g, ''),
      name,
      role,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      password: password || 'password'
    };
    setUsers(prev => [...prev, newUser]);
    toast({ title: "User added" });
  };

  const removeUser = (userId: string) => {
    if (userId === currentUser?.id) {
      toast({ title: "Cannot remove yourself", variant: "destructive" });
      return;
    }
    setUsers(prev => prev.filter(u => u.id !== userId));
    toast({ title: "User removed" });
  };

  const addExpense = (expense: Expense) => {
    setExpenses(prev => [expense, ...prev]);
    toast({ title: "Expense added" });
  };

  const updateExpense = (updated: Expense) => {
    setExpenses(prev => prev.map(e => e.id === updated.id ? updated : e));
    toast({ title: "Expense updated" });
  };

  const deleteExpense = (id: string) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
    toast({ title: "Expense deleted" });
  };

  const addCategory = (name: string) => {
    const newCat: Category = { id: `c${Date.now()}`, name };
    setCategories(prev => [...prev, newCat]);
    toast({ title: "Category added" });
  };

  const addMonth = (month: string) => {
    setMonthStatus(prev => {
      if (prev.find(m => m.month === month)) return prev;
      return [...prev, { month, isLocked: false }];
    });
    toast({ title: `Month ${month} added` });
  };

  const lockMonth = (month: string) => {
    setMonthStatus(prev => {
      const existing = prev.find(m => m.month === month);
      if (existing) {
        return prev.map(m => m.month === month ? { ...m, isLocked: true } : m);
      }
      return [...prev, { month, isLocked: true }];
    });
    toast({ title: `Month ${month} locked` });
  };

  const addSettlement = (settlement: Settlement) => {
    setSettlements(prev => [...prev, settlement]);
    toast({ title: "Settlement recorded" });
  };

  const updateSettlement = (id: string, status: 'paid' | 'pending') => {
    setSettlements(prev => prev.map(s => s.id === id ? { ...s, status } : s));
    toast({ title: `Settlement marked as ${status}` });
  };

  const updateUserPassword = (userId: string, newPassword: string) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, password: newPassword } : u));
    if (currentUser?.id === userId) {
      setCurrentUser(prev => prev ? { ...prev, password: newPassword } : null);
    }
    toast({ title: "Password updated successfully" });
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
      login,
      logout,
      addUser,
      removeUser,
      addExpense,
      updateExpense,
      deleteExpense,
      addCategory,
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
