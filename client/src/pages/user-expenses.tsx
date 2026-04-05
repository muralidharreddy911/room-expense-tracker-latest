import { useApp } from "@/hooks/use-app-store";
import { format, parseISO } from "date-fns";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CalendarX, Receipt, UserSquare2, SlidersHorizontal, Lock, SearchX } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function UserExpensesPage() {
  const {
    expenses, users, categories,
    availableMonths, isMonthLocked
  } = useApp();

  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [viewMode, setViewMode] = useState<"all" | "payer">("all");

  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths]);

  useEffect(() => {
    if (users.length > 0 && !selectedUserId) {
      setSelectedUserId(users[0].id);
    }
  }, [users]);

  const isLocked = selectedMonth ? isMonthLocked(selectedMonth) : false;

  const filteredExpenses = useMemo(() => {
    if (!selectedMonth || !selectedUserId) return [];

    return expenses
      .filter(e => e.month === selectedMonth)
      .filter(e => {
        if (viewMode === 'payer') {
          return e.paidBy === selectedUserId;
        } else {
          return e.splits.some(s => s.userId === selectedUserId);
        }
      })
      .sort((a, b) => {
        const sa = a.serialNo ?? 0;
        const sb = b.serialNo ?? 0;
        if (sa !== sb) return sb - sa;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
  }, [expenses, selectedMonth, selectedUserId, viewMode]);

  const { totalAmount, expensesWithRunningTotal } = useMemo(() => {
    const list = [...filteredExpenses];
    let sum = 0;
    
    // Calculate running total from oldest (bottom) to newest (top)
    for (let i = list.length - 1; i >= 0; i--) {
      let amountToSum = 0;
      if (viewMode === 'payer') {
        amountToSum = list[i].amount;
      } else {
        const split = list[i].splits.find((s: any) => s.userId === selectedUserId);
        amountToSum = split ? split.amount : 0;
      }
      
      sum += amountToSum;
      (list[i] as any).runningTotal = sum;
    }
    
    return {
      totalAmount: sum,
      expensesWithRunningTotal: list,
    };
  }, [filteredExpenses, viewMode, selectedUserId]);

  if (availableMonths.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Expenses</h1>
          <p className="text-muted-foreground">Detailed expense tracking per user.</p>
        </div>
        <div className="border rounded-xl p-12 flex flex-col items-center gap-4 text-center bg-muted/30 border-dashed text-muted-foreground">
          <CalendarX className="w-10 h-10 opacity-40" />
          <p className="font-semibold text-lg">No months available</p>
        </div>
      </div>
    );
  }

  const selectedUser = users.find(u => u.id === selectedUserId);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Expenses</h1>
          <p className="text-muted-foreground">View and audit individual user expenses.</p>
        </div>
      </div>

      {/* Filters */}
      <Card className="shadow-sm border-2">
        <CardContent className="p-4 sm:p-6 pb-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="space-y-2 flex-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <CalendarX className="w-4 h-4 text-primary" /> Month
              </label>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="bg-background">
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
            </div>

            <div className="space-y-2 flex-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <UserSquare2 className="w-4 h-4 text-primary" /> Select User
              </label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="bg-background h-10">
                  <SelectValue placeholder="Select User" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={user.avatar} />
                          <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        {user.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2 flex-1">
              <label className="text-sm font-medium flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" /> View Mode
              </label>
              <Tabs value={viewMode} onValueChange={(val) => setViewMode(val as "all" | "payer")} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="all">Involved In</TabsTrigger>
                  <TabsTrigger value="payer">Added By</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Banner */}
      {selectedUser && (
        <div className="flex flex-col sm:flex-row gap-4 p-4 rounded-lg bg-primary/5 border border-primary/20 items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 border-2 border-background shadow-sm">
              <AvatarImage src={selectedUser.avatar} />
              <AvatarFallback>{selectedUser.name.charAt(0)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-semibold text-lg">{selectedUser.name}</p>
              <p className="text-sm text-muted-foreground">
                {viewMode === 'all' ? 'Expenses participated in' : 'Expenses added/paid directly'}
              </p>
            </div>
          </div>
          <div className="flex sm:text-right justify-center sm:justify-end">
            <div className="bg-primary/10 px-6 py-3 rounded-md border border-primary/20">
              <p className="text-sm text-primary font-semibold uppercase tracking-wider mb-1 text-center sm:text-right">Total Amount</p>
              <p className="text-3xl font-bold font-mono text-primary">₹{totalAmount.toFixed(2)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Expenses List */}
      <div className="space-y-4">
        {filteredExpenses.length === 0 ? (
          <div className="border rounded-xl p-12 flex flex-col items-center gap-4 text-center bg-card/50">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <SearchX className="w-6 h-6 text-muted-foreground opacity-50" />
            </div>
            <div>
              <p className="font-semibold text-lg">No expenses found</p>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                {selectedUser?.name} is not associated with any expenses for the selected criteria.
              </p>
            </div>
          </div>
        ) : (
          expensesWithRunningTotal.map((expense: any) => {
            const category = categories.find(c => c.id === expense.categoryId);
            const payer = users.find(u => u.id === expense.paidBy);
            const isPayer = expense.paidBy === selectedUserId;
            const mySplit = expense.splits.find((s: any) => s.userId === selectedUserId);
            
            return (
              <Card key={expense.id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row p-4 sm:p-5 gap-4">
                    
                    {/* Left: Metadata & Descriptions */}
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <span className="font-medium bg-muted px-2 py-0.5 rounded-full text-foreground/70">
                          #{expense.serialNo}
                        </span>
                        <span className="font-medium">
                          {format(new Date(expense.date), 'MMM dd, yyyy')}
                        </span>
                      </div>
                      
                      <div className="flex items-start gap-2">
                        <div className="text-2xl pt-1">🛒</div>
                        <div>
                          <p className="font-semibold text-lg text-foreground leading-tight">
                            {category?.name || 'Uncategorized'}
                          </p>
                          {expense.description && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {expense.description}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Amounts & Splits */}
                    <div className="sm:text-right flex flex-col sm:items-end justify-between min-w-[140px] pt-2 sm:pt-0 border-t sm:border-0 border-border/50">
                      <div className="font-display text-xl font-bold mb-1">
                        ₹{expense.amount.toFixed(2)}
                      </div>
                      
                      <div className="flex flex-col gap-1.5 sm:items-end w-full">
                        {isPayer ? (
                          <Badge variant="default" className="w-fit bg-primary/10 text-primary hover:bg-primary/20 border-0">
                            Paid by them
                          </Badge>
                        ) : (
                          <div className="flex items-center gap-2 text-sm justify-end w-max ml-auto">
                            <span className="text-muted-foreground">Paid by</span>
                            <div className="flex items-center gap-1.5 font-medium bg-muted/50 px-2 py-0.5 rounded-full">
                              <Avatar className="w-4 h-4">
                                <AvatarImage src={payer?.avatar} />
                                <AvatarFallback>{payer?.name?.charAt(0)}</AvatarFallback>
                              </Avatar>
                              {payer?.name}
                            </div>
                          </div>
                        )}
                        
                        {mySplit && (
                          <div className="text-sm bg-muted/30 px-2 py-1 rounded-md text-muted-foreground border mt-1">
                            Their share: <strong className="text-foreground">₹{mySplit.amount.toFixed(2)}</strong>
                          </div>
                        )}
                      </div>
                      
                    </div>

                    {/* Running Total Column */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center border-t sm:border-t-0 sm:border-l border-border/50 pt-3 sm:pt-0 sm:pl-5 min-w-[120px] bg-muted/10 sm:bg-transparent -mx-4 sm:mx-0 px-4 sm:px-0">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                        Cumulative
                      </p>
                      <div className="font-mono text-lg font-bold text-primary bg-primary/10 px-2 py-0.5 rounded shadow-sm border border-primary/20">
                        ₹{expense.runningTotal.toFixed(2)}
                      </div>
                    </div>

                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
