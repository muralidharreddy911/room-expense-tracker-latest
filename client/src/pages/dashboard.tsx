import { useApp } from "@/hooks/use-app-store";
import { SummaryCard } from "@/components/summary-card";
import { AddExpenseDialog } from "@/components/add-expense-dialog";
import { format, parseISO } from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Receipt, TrendingUp, Users, Wallet, Lock, CalendarX, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";

export default function Dashboard() {
  const {
    expenses, currentUser, users, categories,
    isMonthLocked, availableMonths, refreshState,
  } = useApp();

  // ── Month Selector (only admin-created months) ───────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Default to the most recent unlocked month (or first available)
  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      // Prefer an unlocked month
      const firstUnlocked = availableMonths.find(m => !isMonthLocked(m));
      setSelectedMonth(firstUnlocked ?? availableMonths[0]);
    }
  }, [availableMonths]);

  const isLocked = selectedMonth ? isMonthLocked(selectedMonth) : false;

  // ── Filter expenses for selected month only ──────────────────────────────────
  // If month is locked, show its historical data (read-only view)
  const monthExpenses = selectedMonth
    ? expenses.filter(e => e.month === selectedMonth)
    : [];

  // ── Summary Calculations ─────────────────────────────────────────────────────
  const totalGroupSpend = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

  const myPaid = monthExpenses
    .filter(e => e.paidBy === currentUser?.id)
    .reduce((sum, e) => sum + e.amount, 0);

  const myShare = monthExpenses.reduce((sum, e) => {
    const mySplit = e.splits.find(s => s.userId === currentUser?.id);
    return sum + (mySplit?.amount || 0);
  }, 0);

  const netBalance = myPaid - myShare;

  // ── Per-user balance (who paid how much vs their share) ─────────────────────
  const userBalances = users.map(u => {
    const paid = monthExpenses
      .filter(e => e.paidBy === u.id)
      .reduce((sum, e) => sum + e.amount, 0);
    const share = monthExpenses.reduce((sum, e) => {
      const split = e.splits.find(s => s.userId === u.id);
      return sum + (split?.amount || 0);
    }, 0);
    return { user: u, paid, share, net: paid - share };
  });

  // ── Category Chart ───────────────────────────────────────────────────────────
  const categoryData = categories.map(cat => {
    const amount = monthExpenses
      .filter(e => e.categoryId === cat.id)
      .reduce((sum, e) => sum + e.amount, 0);
    return { name: cat.name, amount };
  }).filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount);

  // ── Recent Activity ──────────────────────────────────────────────────────────
  const recentExpenses = [...monthExpenses]
    .sort((a, b) => (b.serialNo ?? 0) - (a.serialNo ?? 0))
    .slice(0, 5);

  const hasNoMonths = availableMonths.length === 0;
  const hasNoData = monthExpenses.length === 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            {hasNoMonths
              ? "No active months yet"
              : selectedMonth
              ? `Overview for ${format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}${isLocked ? ' (Locked)' : ''}`
              : "Select a month"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Month Selector */}
          {!hasNoMonths && (
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Month" />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map(month => (
                  <SelectItem key={month} value={month}>
                    <span className="flex items-center gap-2">
                      {format(parseISO(`${month}-01`), 'MMMM yyyy')}
                      {isMonthLocked(month) && <Lock className="w-3 h-3 text-amber-500" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button variant="outline" size="icon" onClick={refreshState} title="Refresh data">
            <RefreshCw className="w-4 h-4" />
          </Button>

          {/* Only show Add Expense when there's an active unlocked month */}
          {!isLocked && selectedMonth && !hasNoMonths && <AddExpenseDialog />}
        </div>
      </div>

      {/* ── No Months / Locked Banner ── */}
      {(hasNoMonths || (!selectedMonth)) && (
        <div className="border rounded-xl p-8 flex flex-col items-center gap-4 text-center bg-muted/30 border-dashed text-muted-foreground">
          <CalendarX className="w-10 h-10 opacity-40" />
          <div>
            <p className="font-semibold text-lg">No active month</p>
            <p className="text-sm mt-1 opacity-75">
              The Admin has not set an active month yet. Go to Admin → Month Management to add one.
            </p>
          </div>
        </div>
      )}

      {/* ── Locked month notice (still show data below) ── */}
      {isLocked && selectedMonth && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center gap-3 text-amber-800 dark:text-amber-200">
          <Lock className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">
            {format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')} is locked.
            Viewing historical data (read-only).
          </p>
        </div>
      )}

      {/* ── Summary Cards (shown for all months, locked or not) ── */}
      {selectedMonth && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="Total Group Spend"
              amount={totalGroupSpend}
              icon={<Receipt className="h-4 w-4" />}
              description={hasNoData ? "No expenses yet" : "All expenses this month"}
            />
            <SummaryCard
              title="My Share"
              amount={myShare}
              icon={<Users className="h-4 w-4" />}
              description={hasNoData ? "No expenses yet" : "What you consumed"}
            />
            <SummaryCard
              title="I Paid"
              amount={myPaid}
              icon={<Wallet className="h-4 w-4" />}
              description={hasNoData ? "No expenses yet" : "Out of pocket"}
            />
            <SummaryCard
              title={netBalance >= 0 ? "To Receive" : "To Pay"}
              amount={Math.abs(netBalance)}
              type={netBalance >= 0 ? "positive" : "negative"}
              icon={<TrendingUp className="h-4 w-4" />}
              description={hasNoData ? "No expenses yet" : "Estimated settlement"}
            />
          </div>

          {/* ── Charts + Recent Activity ── */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
            {/* Category Chart */}
            <Card className="col-span-4 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle>Spending by Category</CardTitle>
              </CardHeader>
              <CardContent className="pl-2">
                {categoryData.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                    No expenses recorded yet this month.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={categoryData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="name"
                        stroke="#888888"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="#888888"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={value => `₹${value}`}
                      />
                      <Tooltip
                        cursor={{ fill: 'hsl(var(--accent)/0.1)' }}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--popover))',
                          borderRadius: '8px',
                          border: '1px solid hsl(var(--border))',
                        }}
                      />
                      <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                        {categoryData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={`hsl(var(--chart-${(index % 5) + 1}))`} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="col-span-3 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {recentExpenses.length === 0 ? (
                  <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm text-center px-4">
                    No expenses recorded yet this month.
                  </div>
                ) : (
                  <ScrollArea className="h-[300px] pr-4">
                    <div className="space-y-6">
                      {recentExpenses.map(expense => {
                        const payer = users.find(u => u.id === expense.paidBy);
                        const category = categories.find(c => c.id === expense.categoryId);
                        return (
                          <div key={expense.id} className="flex items-center">
                            <Avatar className="h-9 w-9">
                              <AvatarImage src={payer?.avatar} alt={payer?.name} />
                              <AvatarFallback>{payer?.name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="ml-4 space-y-1 flex-1 min-w-0">
                              <p className="text-sm font-medium leading-none truncate">
                                <span className="text-muted-foreground text-xs mr-1">#{expense.serialNo}</span>
                                {expense.description}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {payer?.name} paid • {format(parseISO(expense.date), 'MMM d')} • {category?.name}
                              </p>
                            </div>
                            <div className="ml-auto font-medium font-display">
                              ₹{expense.amount.toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── User Balances ── */}
          {monthExpenses.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Member Balances — {selectedMonth && format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {userBalances.map(({ user, paid, share, net }) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={user.avatar} />
                        <AvatarFallback>{user.name[0]}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Paid ₹{paid.toFixed(0)} · Share ₹{share.toFixed(0)}
                        </p>
                      </div>
                      <div className={`text-sm font-bold font-mono ${net >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                        {net >= 0 ? '+' : ''}₹{net.toFixed(0)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
