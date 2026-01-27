import { useApp } from "@/hooks/use-app-store";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, ArrowRight } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettlementsPage() {
  const { expenses, users, currentUser, settlements, addSettlement } = useApp();
  
  // Calculate debts
  const debts: Record<string, Record<string, number>> = {}; // from -> to -> amount

  // 1. Sum up expenses (who owes whom)
  expenses.forEach(expense => {
    expense.splits.forEach(split => {
      if (split.userId !== expense.paidBy) {
        if (!debts[split.userId]) debts[split.userId] = {};
        debts[split.userId][expense.paidBy] = (debts[split.userId][expense.paidBy] || 0) + split.amount;
      }
    });
  });

  // 2. Subtract settlements (payments already made)
  settlements.forEach(settlement => {
    if (settlement.status === 'paid') {
      // If A paid B, reduce A's debt to B
      if (debts[settlement.fromUser] && debts[settlement.fromUser][settlement.toUser]) {
        debts[settlement.fromUser][settlement.toUser] -= settlement.amount;
      } 
      // Note: If debt goes negative, it means B owes A now. 
      // For simplicity in this mock, we'll just track positive debts roughly or let them float.
      // But properly: A owes B 50. A pays 50. Debt is 0.
    }
  });

  // 3. Simplify debts (Netting) - Optional, but good for UI. 
  // Let's just list "To Pay" and "To Receive" for the current user.

  const myDebts: { to: string; amount: number }[] = [];
  const owedToMe: { from: string; amount: number }[] = [];

  users.forEach(u => {
    if (u.id === currentUser?.id) return;

    // What I owe them
    const iOweThem = debts[currentUser!.id]?.[u.id] || 0;
    // What they owe me
    const theyOweMe = debts[u.id]?.[currentUser!.id] || 0;

    const net = theyOweMe - iOweThem;

    if (net > 0.01) {
      owedToMe.push({ from: u.id, amount: net });
    } else if (net < -0.01) {
      myDebts.push({ to: u.id, amount: Math.abs(net) });
    }
  });

  const handleSettle = (toUserId: string, amount: number) => {
    addSettlement({
      id: `s${Date.now()}`,
      fromUser: currentUser!.id,
      toUser: toUserId,
      amount: amount,
      status: 'paid',
      month: format(new Date(), 'yyyy-MM'),
      createdAt: new Date().toISOString()
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settlements</h1>
        <p className="text-muted-foreground">
          Track balances and settle up debts.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-l-4 border-l-destructive shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              To Pay
              <span className="text-sm font-normal text-muted-foreground ml-auto">
                Total: ₹{myDebts.reduce((acc, curr) => acc + curr.amount, 0).toFixed(2)}
              </span>
            </CardTitle>
            <CardDescription>People you owe money to</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             {myDebts.length === 0 ? (
               <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-md">
                 You're all settled up!
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
                          <p className="text-sm text-muted-foreground">Owed</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold font-display text-destructive mb-1">
                          ₹{debt.amount.toFixed(2)}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => handleSettle(debt.to, debt.amount)}>
                          Mark Paid
                        </Button>
                      </div>
                    </div>
                  );
                })
             )}
          </CardContent>
        </Card>

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
          <CardContent className="space-y-4">
            {owedToMe.length === 0 ? (
               <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-md">
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
                          <p className="text-sm text-muted-foreground">Owes you</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold font-display text-green-600">
                          ₹{debt.amount.toFixed(2)}
                        </p>
                        {/* <Button size="sm" variant="ghost" disabled>
                          Remind
                        </Button> */}
                      </div>
                    </div>
                  );
                })
             )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Recent Settlements</CardTitle>
        </CardHeader>
        <CardContent>
           <div className="space-y-2">
             {settlements.slice(-5).reverse().map(settlement => {
               const from = users.find(u => u.id === settlement.fromUser);
               const to = users.find(u => u.id === settlement.toUser);
               return (
                 <div key={settlement.id} className="flex items-center gap-4 py-3 border-b last:border-0">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-medium text-sm">{from?.name}</span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{to?.name}</span>
                    </div>
                    <div className="font-mono font-bold">
                      ₹{settlement.amount.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(parseISO(settlement.createdAt), 'MMM d, yyyy')}
                    </div>
                 </div>
               );
             })}
             {settlements.length === 0 && (
               <p className="text-sm text-muted-foreground">No settlements recorded yet.</p>
             )}
           </div>
        </CardContent>
      </Card>
    </div>
  );
}
