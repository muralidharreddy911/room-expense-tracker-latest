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

  const debts: Record<string, Record<string, number>> = {};

  monthExpenses.forEach(expense => {
    expense.splits.forEach(split => {
      if (split.userId !== expense.paidBy) {
        if (!debts[split.userId]) debts[split.userId] = {};
        debts[split.userId][expense.paidBy] =
          (debts[split.userId][expense.paidBy] || 0) + split.amount;
      }
    });
  });

  // Subtract settlements that belong to this month (paid only)
  settlements
    .filter(s => s.status === 'paid' && s.month === selectedMonth)
    .forEach(s => {
      if (debts[s.fromUser]?.[s.toUser]) {
        debts[s.fromUser][s.toUser] = Math.max(0, debts[s.fromUser][s.toUser] - s.amount);
      }
    });

  // ── Balances from current user's perspective ────────────────────────────────
  /** 
   * myDebts: people I owe money to (I am debtor)
   * owedToMe: people who owe me money (I am creditor = receiver)
   */
  const myDebts: { to: string; amount: number }[] = [];
  const owedToMe: { from: string; amount: number }[] = [];

  users.forEach(u => {
    if (u.id === currentUser?.id) return;
    const iOweThem = debts[currentUser!.id]?.[u.id] || 0;
    const theyOweMe = debts[u.id]?.[currentUser!.id] || 0;
    const net = theyOweMe - iOweThem;
    if (net > 0.01) owedToMe.push({ from: u.id, amount: net });
    else if (net < -0.01) myDebts.push({ to: u.id, amount: Math.abs(net) });
  });

  // ── Net Balance (single source of truth — always equals Dashboard's myPaid - myShare) ──
  // sum(owedToMe) - sum(myDebts) == dashboard netBalance mathematically
  const totalOwedToMe = owedToMe.reduce((sum, d) => sum + d.amount, 0);
  const totalIOweThem = myDebts.reduce((sum, d) => sum + d.amount, 0);
  const netSettlementBalance = totalOwedToMe - totalIOweThem;

  // ── Settlement Handler ——— RECEIVER marks as received ──────────────────────
  // currentUser is the CREDITOR (receiver). They mark the debt as received.
  const handleMarkReceived = (fromUserId: string, amount: number) => {
    addSettlement({
      id: `s${Date.now()}`,
      fromUser: fromUserId,         // debtor
      toUser: currentUser!.id,      // creditor = current user (receiver)
      amount: Number(amount.toFixed(2)),
      status: 'paid',
      month: selectedMonth,
      createdAt: new Date().toISOString(),
    });
  };

  // ── Settlements history for selected month ──────────────────────────────────
  const monthSettlements = settlements
    .filter(s => s.month === selectedMonth)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const paidSettlements = monthSettlements.filter(s => s.status === 'paid');
  const pendingSettlements = monthSettlements.filter(s => s.status === 'pending');

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

      {/* ── Settlement ownership info banner ── */}
      <div className="flex items-start gap-3 text-sm p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          <strong>How settlements work:</strong> The <em>receiver</em> (person who is owed money) confirms when
          they've been paid. Only the receiver can click "Mark as Received".
        </p>
      </div>

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
              Pay them in person — the <strong>receiver</strong> will confirm receipt.
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
                      <p className="text-xs text-muted-foreground">Pay in person</p>
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
              People who owe you money. Confirm once you've received payment.
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

                      {/* Only RECEIVER (current user) can mark as received */}
                      {!isLocked ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20"
                            >
                              <CheckCircle2 className="w-3 h-3 mr-1" />
                              Mark as Received
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Confirm Receipt</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you confirming that <strong>{user?.name}</strong> has paid you{" "}
                                <strong>₹{debt.amount.toFixed(2)}</strong>?
                                <br /><br />
                                This will be recorded as a completed settlement for{" "}
                                {selectedMonth && format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => handleMarkReceived(debt.from, debt.amount)}
                              >
                                Yes, Mark as Received
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Lock className="w-2.5 h-2.5" /> Month Locked
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Pending Settlements (toUser = receiver can confirm) ── */}
      {pendingSettlements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Settlements
            </CardTitle>
            <CardDescription>
              Payments in progress — the receiver can mark these as completed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingSettlements.map(settlement => {
                const from = users.find(u => u.id === settlement.fromUser);
                const to = users.find(u => u.id === settlement.toUser);
                // Only the RECEIVER (toUser) can mark as paid
                const isReceiver = currentUser?.id === settlement.toUser;
                return (
                  <div key={settlement.id} className="flex items-center gap-4 py-3 border-b last:border-0">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-medium text-sm">{from?.name}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{to?.name}</span>
                    </div>
                    <div className="font-mono font-bold">₹{settlement.amount.toFixed(2)}</div>
                    <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
                    {isReceiver && !isLocked && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="border-green-500 text-green-600 hover:bg-green-50">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Confirm Received
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Settlement</AlertDialogTitle>
                            <AlertDialogDescription>
                              Confirm that you received ₹{settlement.amount.toFixed(2)} from {from?.name}?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => updateSettlement(settlement.id, 'paid')}
                            >
                              Yes, Confirm
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Settlement History (paid) for selected month ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Settlement History
            {selectedMonth && (
              <Badge variant="outline" className="ml-2 font-normal text-xs">
                {format(parseISO(`${selectedMonth}-01`), 'MMMM yyyy')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Completed payments for the selected month.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {paidSettlements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No completed settlements for this month yet.
              </p>
            ) : (
              paidSettlements.map(settlement => {
                const from = users.find(u => u.id === settlement.fromUser);
                const to = users.find(u => u.id === settlement.toUser);
                return (
                  <div key={settlement.id} className="flex items-center gap-4 py-3 border-b last:border-0">
                    <div className="flex items-center gap-2 flex-1">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={from?.avatar} />
                        <AvatarFallback>{from?.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm">{from?.name}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={to?.avatar} />
                        <AvatarFallback>{to?.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm">{to?.name}</span>
                    </div>
                    <div className="font-mono font-bold text-green-600">
                      ₹{settlement.amount.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(parseISO(settlement.createdAt), 'MMM d, yyyy')}
                    </div>
                    <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950/20">
                      <CheckCircle2 className="w-3 h-3 mr-1" />Settled
                    </Badge>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
