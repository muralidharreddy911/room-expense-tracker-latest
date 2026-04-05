import { useApp } from "@/hooks/use-app-store";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowRight, CheckCircle2, Clock, Lock, RefreshCw, CalendarX, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState, useEffect } from "react";

export default function SettlementsPage() {
  const {
    expenses, users, currentUser, settlements,
    addSettlement, updateSettlement,
    isMonthLocked, availableMonths, refreshState,
  } = useApp();

  // ── Month Selector ──────────────────────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshState();
      setSelectedMonth(''); // reset so useEffect picks the latest active month
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      // Prefer the most recent unlocked month
      const firstUnlocked = availableMonths.find(m => !isMonthLocked(m));
      setSelectedMonth(firstUnlocked ?? availableMonths[0]);
    }
  }, [availableMonths]);

  const isLocked = selectedMonth ? isMonthLocked(selectedMonth) : false;

  // ── Per-Month Debt Calculation ──────────────────────────────────────────────
  // Only use expenses from the selected month
  const monthExpenses = expenses.filter(e => e.month === selectedMonth);

  // 1. Calculate base net balances exactly matching Dashboard
  const baseNetBalances: Record<string, number> = {};
  users.forEach(u => { baseNetBalances[u.id] = 0; });

  monthExpenses.forEach(expense => {
    // Payer's balance increases (they paid, they are owed this back)
    if (baseNetBalances[expense.paidBy] !== undefined) {
      baseNetBalances[expense.paidBy] += expense.amount;
    }
    // Participants' balance decreases by their share (they consumed this)
    expense.splits.forEach(split => {
      if (baseNetBalances[split.userId] !== undefined) {
        baseNetBalances[split.userId] -= split.amount;
      }
    });
  });

  // 2. Separate into debtors and creditors
  // balances < 0 mean they owe money (debtors)
  // balances > 0 mean they should receive money (creditors)
  const debtors = users.map(u => ({ id: u.id, balance: baseNetBalances[u.id] })).filter(u => u.balance < -0.01);
  const creditors = users.map(u => ({ id: u.id, balance: baseNetBalances[u.id] })).filter(u => u.balance > 0.01);

  // Sort them to be deterministic (largest debtor pays largest creditor first)
  debtors.sort((a, b) => a.balance - b.balance); // smallest negative first
  creditors.sort((a, b) => b.balance - a.balance); // largest positive first

  // 3. Compute optimal pairwise settlements matches based purely on Net Balances
  const computedDebts: { from: string; to: string; amount: number }[] = [];

  let i = 0; // index for debtors
  let j = 0; // index for creditors
  
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    
    // amount to settle is the min of what debtor owes and creditor is owed
    const debtorOweRef = Math.abs(debtor.balance);
    const creditorOwedRef = creditor.balance;
    const settleAmount = Math.min(debtorOweRef, creditorOwedRef);
    
    if (settleAmount > 0.01) {
      computedDebts.push({ from: debtor.id, to: creditor.id, amount: settleAmount });
    }
    
    // adjust temporary balances for next iteration
    debtor.balance += settleAmount;
    creditor.balance -= settleAmount;
    
    if (Math.abs(debtor.balance) < 0.01) i++;
    if (Math.abs(creditor.balance) < 0.01) j++;
  }

  // 4. Subtract already paid settlements from these specific computed debt lines
  // This ensures a user's original "Base Debt" (e.g. 1370) does not get mathematically shifted
  // by indirect cross-payments before being displayed.
  settlements
    .filter(s => s.status === 'paid' && s.month === selectedMonth)
    .forEach(s => {
      const line = computedDebts.find(d => d.from === s.fromUser && d.to === s.toUser);
      if (line) {
        line.amount -= s.amount;
        if (line.amount < 0) line.amount = 0;
      }
    });

  // 5. Build final arrays for the current user
  const myDebts: { to: string; amount: number }[] = [];
  const owedToMe: { from: string; amount: number }[] = [];

  computedDebts.forEach(d => {
    if (d.amount > 0.01) {
      if (d.from === currentUser?.id) {
        myDebts.push({ to: d.to, amount: d.amount });
      } else if (d.to === currentUser?.id) {
        owedToMe.push({ from: d.from, amount: d.amount });
      }
    }
  });

  // ── Net Balance (single source of truth — always equals Dashboard's myPaid - myShare) ──
  // sum(owedToMe) - sum(myDebts) == dashboard netBalance mathematically
  const totalOwedToMe = owedToMe.reduce((sum, d) => sum + d.amount, 0);
  const totalIOweThem = myDebts.reduce((sum, d) => sum + d.amount, 0);
  const netSettlementBalance = totalOwedToMe - totalIOweThem;

  // ── No months guard ─────────────────────────────────────────────────────────
  if (availableMonths.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
            <p className="text-muted-foreground">Track balances and settle up debts.</p>
          </div>
        </div>
        <div className="border rounded-xl p-12 flex flex-col items-center gap-4 text-center bg-muted/30 border-dashed text-muted-foreground">
          <CalendarX className="w-10 h-10 opacity-40" />
          <div>
            <p className="font-semibold text-lg">No months available</p>
            <p className="text-sm mt-1 opacity-75">
              Ask the Admin to create a month from Admin → Month Management.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
          <p className="text-muted-foreground">Track balances and settle up debts — per month.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Month Selector */}
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
          <Button variant="outline" size="icon" onClick={handleRefresh} disabled={isRefreshing} title="Refresh">
            <RefreshCw className={`w-4 h-4 transition-transform ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── Locked Month Notice ── */}
      {isLocked && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 rounded-lg flex items-center gap-3 text-amber-800 dark:text-amber-200">
          <Lock className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">
            {selectedMonth && format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')} is locked.
            No new settlements can be recorded for this month.
          </p>
        </div>
      )}

      {/* ── Net Balance Summary (matches Dashboard exactly) ── */}
      {selectedMonth && (
        <div className={`flex items-center justify-between p-4 rounded-lg border-2 ${
          netSettlementBalance > 0.01
            ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
            : netSettlementBalance < -0.01
            ? 'border-destructive bg-red-50 dark:bg-red-950/20'
            : 'border-border bg-muted/30'
        }`}>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Your Net Balance — {format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              To Receive (₹{totalOwedToMe.toFixed(2)}) − To Pay (₹{totalIOweThem.toFixed(2)}) · Matches Dashboard
            </p>
          </div>
          <div className={`text-2xl font-bold font-mono ${
            netSettlementBalance >= 0 ? 'text-green-600' : 'text-destructive'
          }`}>
            {netSettlementBalance >= 0 ? '+' : ''}₹{Math.abs(netSettlementBalance).toFixed(2)}
          </div>
        </div>
      )}

      {/* ── Balances ── */}
      <div className="grid gap-6 md:grid-cols-2">

        {/* ── To Pay (read-only info for current user as debtor) ── */}
        <Card className="border-l-4 border-l-destructive shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-destructive" />
              To Pay
              <span className="text-sm font-normal text-muted-foreground ml-auto">
                ₹{totalIOweThem.toFixed(2)}
              </span>
            </CardTitle>
            <CardDescription>
              Amounts you owe to others this month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {myDebts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground bg-green-50 dark:bg-green-950/20 rounded-md gap-2">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
                <p className="text-sm font-medium">You're all settled up!</p>
              </div>
            ) : (
              myDebts.map(debt => {
                const user = users.find(u => u.id === debt.to);
                return (
                  <div
                    key={debt.to}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback>{user?.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user?.name}</p>
                        <p className="text-xs text-muted-foreground">You owe them</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold font-display text-destructive">
                        ₹{debt.amount.toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">To Pay</p>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── To Receive (receiver clicks "Mark as Received") ── */}
        <Card className="border-l-4 border-l-green-500 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              To Receive
              <span className="text-sm font-normal text-muted-foreground ml-auto">
              Total: ₹{totalOwedToMe.toFixed(2)}
              </span>
            </CardTitle>
            <CardDescription>
              People who owe you money this month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {owedToMe.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-md text-sm">
                No one owes you anything this month.
              </div>
            ) : (
              owedToMe.map(debt => {
                const user = users.find(u => u.id === debt.from);
                return (
                  <div
                    key={debt.from}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback>{user?.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user?.name}</p>
                        <p className="text-xs text-muted-foreground">Owes you</p>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <p className="text-lg font-bold font-display text-green-600">
                        ₹{debt.amount.toFixed(2)}
                      </p>

                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
