import { useApp } from "@/hooks/use-app-store";
import { SummaryCard } from "@/components/summary-card";
import { AddExpenseDialog } from "@/components/add-expense-dialog";
import { format, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
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
import { Receipt, TrendingUp, Users, Wallet } from "lucide-react";

export default function Dashboard() {
  const { expenses, currentUser, users, getExpensesByMonth, categories, monthStatus } = useApp();
  
  // Get the most recent active (unlocked) month, or the latest month overall
  const currentMonth = monthStatus
    .filter(m => !m.isLocked)
    .sort((a, b) => b.month.localeCompare(a.month))[0]?.month 
    || monthStatus.sort((a, b) => b.month.localeCompare(a.month))[0]?.month
    || format(new Date(), 'yyyy-MM');

  const monthExpenses = getExpensesByMonth(currentMonth);

  // Calculations
  const totalGroupSpend = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
  
  const myPaid = monthExpenses
    .filter(e => e.paidBy === currentUser?.id)
    .reduce((sum, e) => sum + e.amount, 0);
    
  const myShare = monthExpenses.reduce((sum, e) => {
    const mySplit = e.splits.find(s => s.userId === currentUser?.id);
    return sum + (mySplit?.amount || 0);
  }, 0);

  const netBalance = myPaid - myShare;

  // Chart Data: Spending by Category
  const categoryData = categories.map(cat => {
    const amount = monthExpenses
      .filter(e => e.categoryId === cat.id)
      .reduce((sum, e) => sum + e.amount, 0);
    return { name: cat.name, amount };
  }).filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount);

  // Recent Activity
  const recentExpenses = [...expenses].sort((a, b) => 
    new Date(b.date).getTime() - new Date(a.date).getTime()
  ).slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview for {format(parseISO(`${currentMonth}-01`), 'MMMM yyyy')}
          </p>
        </div>
        <AddExpenseDialog />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard 
          title="Total Group Spend" 
          amount={totalGroupSpend} 
          icon={<Receipt className="h-4 w-4" />}
          description="All expenses this month"
        />
        <SummaryCard 
          title="My Share" 
          amount={myShare} 
          icon={<Users className="h-4 w-4" />}
          description="What you consumed"
        />
        <SummaryCard 
          title="I Paid" 
          amount={myPaid} 
          icon={<Wallet className="h-4 w-4" />}
          description="Out of pocket"
        />
        <SummaryCard 
          title={netBalance >= 0 ? "To Receive" : "To Pay"} 
          amount={Math.abs(netBalance)} 
          type={netBalance >= 0 ? "positive" : "negative"}
          icon={<TrendingUp className="h-4 w-4" />}
          description="Estimated settlement"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle>Spending by Category</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
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
          </CardContent>
        </Card>

        <Card className="col-span-3 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-6">
                {recentExpenses.map((expense) => {
                  const payer = users.find(u => u.id === expense.paidBy);
                  const category = categories.find(c => c.id === expense.categoryId);
                  
                  return (
                    <div key={expense.id} className="flex items-center">
                      <Avatar className="h-9 w-9">
                        <AvatarImage src={payer?.avatar} alt={payer?.name} />
                        <AvatarFallback>{payer?.name[0]}</AvatarFallback>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
