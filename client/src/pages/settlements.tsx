import { useApp } from "@/hooks/use-app-store";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

export default function SettlementsPage() {
  const { expenses, users, currentUser, settlements, addSettlement, updateSettlement } = useApp();

  // ── Debt Calculation ──────────────────────────────────────────────────────
  const debts: Record<string, Record<string, number>> = {};

  expenses.forEach(expense => {
    expense.splits.forEach(split => {
      if (split.userId !== expense.paidBy) {
        if (!debts[split.userId]) debts[split.userId] = {};
        debts[split.userId][expense.paidBy] = (debts[split.userId][expense.paidBy] || 0) + split.amount;
      }
    });
  });

  // Subtract already-paid settlements
  settlements
    .filter(s => s.status === 'paid')
    .forEach(settlement => {
      if (debts[settlement.fromUser]?.[settlement.toUser]) {
        debts[settlement.fromUser][settlement.toUser] -= settlement.amount;
      }
    });

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

  // ── Settlement Handler ────────────────────────────────────────────────────
  const handleSettle = (toUserId: string, amount: number) => {
    addSettlement({
      id: `s${Date.now()}`,
      fromUser: currentUser!.id,
      toUser: toUserId,
      amount: Number(amount.toFixed(2)),
      status: 'paid',
      month: format(new Date(), 'yyyy-MM'),
      createdAt: new Date().toISOString(),
    });
  };

  // ── Recent Settlements (paid) ─────────────────────────────────────────────
  const recentSettlements = settlements
    .filter(s => s.status === 'paid')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // ── Pending Settlements (pending) ─────────────────────────────────────────
  const pendingSettlements = settlements
    .filter(s => s.status === 'pending')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
        <p className="text-muted-foreground">Track balances and settle up debts.</p>
      </div>

      {/* ── Balances ── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* To Pay */}
        <Card className="border-l-4 border-l-destructive shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-destructive" />
              To Pay
              <span className="text-sm font-normal text-muted-foreground ml-auto">
                Total: ₹{myDebts.reduce((acc, curr) => acc + curr.amount, 0).toFixed(2)}
              </span>
            </CardTitle>
            <CardDescription>People you owe money to</CardDescription>
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
                  <div key={debt.to} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback>{user?.name[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user?.name}</p>
                        <p className="text-xs text-muted-foreground">You owe them</p>
                      </div>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <p className="text-lg font-bold font-display text-destructive">
                        ₹{debt.amount.toFixed(2)}
                      </p>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="border-green-500 text-green-600 hover:bg-green-50">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Settle
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Settlement</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to mark this settlement as completed?
                              <br /><br />
                              You are paying <strong>₹{debt.amount.toFixed(2)}</strong> to <strong>{user?.name}</strong>.
                              <br />
                              This will be recorded in Recent Settlements.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => handleSettle(debt.to, debt.amount)}
                            >
                              OK – Mark as Settled
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* To Receive */}
        <Card className="border-l-4 border-l-green-500 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              To Receive
              <span className="text-sm font-normal text-muted-foreground ml-auto">
                Total: ₹{owedToMe.reduce((acc, curr) => acc + curr.amount, 0).toFixed(2)}
              </span>
            </CardTitle>
            <CardDescription>People who owe you money</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {owedToMe.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-md text-sm">
                No one owes you anything right now.
              </div>
            ) : (
              owedToMe.map(debt => {
                const user = users.find(u => u.id === debt.from);
                return (
                  <div key={debt.from} className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback>{user?.name[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user?.name}</p>
                        <p className="text-xs text-muted-foreground">Owes you</p>
                      </div>
                    </div>
                    <p className="text-lg font-bold font-display text-green-600">
                      ₹{debt.amount.toFixed(2)}
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Pending Settlements ── */}
      {pendingSettlements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Settlements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingSettlements.map(settlement => {
                const from = users.find(u => u.id === settlement.fromUser);
                const to = users.find(u => u.id === settlement.toUser);
                return (
                  <div key={settlement.id} className="flex items-center gap-4 py-3 border-b last:border-0">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-medium text-sm">{from?.name}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{to?.name}</span>
                    </div>
                    <div className="font-mono font-bold">₹{settlement.amount.toFixed(2)}</div>
                    <Badge variant="outline" className="text-amber-600 border-amber-300">Pending</Badge>
                    {currentUser?.id === settlement.fromUser && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="border-green-500 text-green-600 hover:bg-green-50">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Settle
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Settlement</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to mark this settlement as completed?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => updateSettlement(settlement.id, 'paid')}
                            >
                              OK – Mark as Settled
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

      {/* ── Recent Settlements (paid) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            Recent Settlements
          </CardTitle>
          <CardDescription>Completed payment history</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {recentSettlements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No completed settlements yet.
              </p>
            ) : (
              recentSettlements.map(settlement => {
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
                    <div className="font-mono font-bold text-green-600">₹{settlement.amount.toFixed(2)}</div>
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
