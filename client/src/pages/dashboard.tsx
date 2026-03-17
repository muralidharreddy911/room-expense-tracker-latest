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
  Cell
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Receipt, TrendingUp, Users, Wallet, Lock, CalendarX } from "lucide-react";

export default function Dashboard() {
  const { expenses, currentUser, users, categories, monthStatus, isMonthLocked } = useApp();

  // ── Active Month Resolution ──────────────────────────────────────────────
  // "Active month" = the most recent UNLOCKED month that the Admin has added.
  // If no unlocked month exists at all, the active month is considered "none"
  // (all months are locked → nothing to show on Dashboard).
  const currentMonth = () => {
    const unlocked = monthStatus
      .filter(m => !m.isLocked)
      .sort((a, b) => b.month.localeCompare(a.month));

    if (unlocked.length > 0) return unlocked[0].month;

    // No month added yet at all → use the real calendar month
    if (monthStatus.length === 0) return format(new Date(), 'yyyy-MM');

    // All months are locked → return null to indicate "no active month"
    return null;
  };

  const activeMonth = currentMonth();
  const activeMonthLocked = activeMonth ? isMonthLocked(activeMonth) : true;

  // ── Filter expenses STRICTLY to the active month & only if it is unlocked ─
  // Per requirement: once month is locked, dashboard shows empty.
  const monthExpenses = activeMonth && !activeMonthLocked
    ? expenses.filter(e => e.month === activeMonth)
    : [];

  // ── Summary Calculations ──────────────────────────────────────────────────
  const totalGroupSpend = monthExpenses.reduce((sum, e) => sum + e.amount, 0);

  const myPaid = monthExpenses
    .filter(e => e.paidBy === currentUser?.id)
    .reduce((sum, e) => sum + e.amount, 0);

  const myShare = monthExpenses.reduce((sum, e) => {
    const mySplit = e.splits.find(s => s.userId === currentUser?.id);
    return sum + (mySplit?.amount || 0);
  }, 0);

  const netBalance = myPaid - myShare;

  // ── Category Chart ────────────────────────────────────────────────────────
  // Only for expenses in the active unlocked month
  const categoryData = categories.map(cat => {
    const amount = monthExpenses
      .filter(e => e.categoryId === cat.id)
      .reduce((sum, e) => sum + e.amount, 0);
    return { name: cat.name, amount };
  }).filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount);

  // ── Recent Activity ───────────────────────────────────────────────────────
  // Only recent expenses from the active month (not all months)
  const recentExpenses = [...monthExpenses]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  // ── Locked / No-Active-Month empty state ─────────────────────────────────
  const isNoActiveMonth = !activeMonth || activeMonthLocked;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            {activeMonth && !activeMonthLocked
              ? `Overview for ${format(parseISO(`${activeMonth}-01`), 'MMMM yyyy')}`
              : activeMonth && activeMonthLocked
              ? `${format(parseISO(`${activeMonth}-01`), 'MMMM yyyy')} is locked`
              : "No active month set"}
          </p>
        </div>
        {/* Only show Add Expense when there's an active unlocked month */}
        {!isNoActiveMonth && <AddExpenseDialog />}
      </div>

      {/* ── Locked / No-Active-Month Banner ── */}
      {isNoActiveMonth && (
        <div className={`border rounded-xl p-8 flex flex-col items-center gap-4 text-center ${
          activeMonth && activeMonthLocked
            ? "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200"
            : "bg-muted/30 border-dashed text-muted-foreground"
        }`}>
          {activeMonth && activeMonthLocked
            ? <Lock className="w-10 h-10 opacity-60" />
            : <CalendarX className="w-10 h-10 opacity-40" />
          }
          <div>
            <p className="font-semibold text-lg">
              {activeMonth && activeMonthLocked
                ? "This month is locked"
                : "No active month"}
            </p>
            <p className="text-sm mt-1 opacity-75">
              {activeMonth && activeMonthLocked
                ? "No data available for the current month. The Admin has locked it. Ask the Admin to open a new month."
                : "The Admin has not set an active month yet. Go to Admin → Month Management to add one."}
            </p>
          </div>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Total Group Spend"
          amount={totalGroupSpend}
          icon={<Receipt className="h-4 w-4" />}
          description={isNoActiveMonth ? "No active month" : "All expenses this month"}
        />
        <SummaryCard
          title="My Share"
          amount={myShare}
          icon={<Users className="h-4 w-4" />}
          description={isNoActiveMonth ? "No active month" : "What you consumed"}
        />
        <SummaryCard
          title="I Paid"
          amount={myPaid}
          icon={<Wallet className="h-4 w-4" />}
          description={isNoActiveMonth ? "No active month" : "Out of pocket"}
        />
        <SummaryCard
          title={netBalance >= 0 ? "To Receive" : "To Pay"}
          amount={Math.abs(netBalance)}
          type={netBalance >= 0 ? "positive" : "negative"}
          icon={<TrendingUp className="h-4 w-4" />}
          description={isNoActiveMonth ? "No active month" : "Estimated settlement"}
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
                {isNoActiveMonth
                  ? "No active month data to display."
                  : "No expenses recorded yet this month."}
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
                    tickFormatter={(value) => `₹${value}`}
                  />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--accent)/0.1)' }}
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      borderRadius: '8px',
                      border: '1px solid hsl(var(--border))'
                    }}
                  />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={`hsl(var(--chart-${(index % 5) + 1}))`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity (current month only) */}
        <Card className="col-span-3 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentExpenses.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm text-center px-4">
                {isNoActiveMonth
                  ? "No active month data to display."
                  : "No expenses recorded yet this month."}
              </div>
            ) : (
              <ScrollArea className="h-[300px] pr-4">
                <div className="space-y-6">
                  {recentExpenses.map((expense) => {
                    const payer = users.find(u => u.id === expense.paidBy);
                    const category = categories.find(c => c.id === expense.categoryId);
                    return (
                      <div key={expense.id} className="flex items-center">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={payer?.avatar} alt={payer?.name} />
                          <AvatarFallback>{payer?.name?.[0]}</AvatarFallback>
                        </Avatar>
                        <div className="ml-4 space-y-1">
                          <p className="text-sm font-medium leading-none">{expense.description}</p>
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
    </div>
  );
}
