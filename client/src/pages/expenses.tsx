import { useApp } from "@/hooks/use-app-store";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddExpenseDialog } from "@/components/add-expense-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, AlertCircle } from "lucide-react";
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
import { cn } from "@/lib/utils";

export default function ExpensesPage() {
  const { expenses, users, categories, currentUser, deleteExpense, isMonthLocked } = useApp();
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));

  // Get unique months from expenses for the filter
  const months = Array.from(new Set(expenses.map(e => e.month))).sort().reverse();
  if (!months.includes(selectedMonth)) months.unshift(selectedMonth);

  const filteredExpenses = expenses
    .filter(e => e.month === selectedMonth)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const isLocked = isMonthLocked(selectedMonth);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
          <p className="text-muted-foreground">
            Manage and track shared bills.
          </p>
        </div>
        <div className="flex items-center gap-2">
           <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select Month" />
            </SelectTrigger>
            <SelectContent>
              {months.map(month => (
                <SelectItem key={month} value={month}>
                  {format(parseISO(`${month}-01`), 'MMMM yyyy')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isLocked && <AddExpenseDialog />}
        </div>
      </div>

      {isLocked && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 rounded-lg flex items-center gap-2 text-amber-800 dark:text-amber-200">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">This month is locked. No further edits or additions allowed.</p>
        </div>
      )}

      <div className="space-y-4">
        {filteredExpenses.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No expenses recorded for this month.
          </div>
        ) : (
          filteredExpenses.map((expense) => {
            const payer = users.find(u => u.id === expense.paidBy);
            const category = categories.find(c => c.id === expense.categoryId);
            const canDelete = !isLocked && currentUser?.id === expense.paidBy;

            return (
              <Card key={expense.id} className="overflow-hidden hover:border-primary/50 transition-colors group">
                <CardHeader className="p-4 sm:p-6 bg-secondary/10 flex flex-row items-start justify-between space-y-0">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center justify-center bg-background border rounded-lg p-2 w-14 h-14 shadow-sm">
                      <span className="text-xs font-bold text-muted-foreground uppercase">
                        {format(parseISO(expense.date), 'MMM')}
                      </span>
                      <span className="text-xl font-bold font-display">
                        {format(parseISO(expense.date), 'dd')}
                      </span>
                    </div>
                    <div>
                      <CardTitle className="text-lg font-semibold flex items-center gap-2">
                        {expense.description}
                        <Badge variant="outline" className="font-normal text-xs bg-background">
                          {category?.name}
                        </Badge>
                      </CardTitle>
                      <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                        Paid by 
                        <Avatar className="w-5 h-5 ml-1 mr-1 border border-border">
                          <AvatarImage src={payer?.avatar} />
                          <AvatarFallback>{payer?.name[0]}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">{payer?.name}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="text-right">
                      <div className="text-xl font-bold font-display">
                        ₹{expense.amount.toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {expense.splitType === 'equal' ? 'Split Equally' : 'Custom Split'}
                      </div>
                    </div>
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This action cannot be undone. This will permanently remove this transaction.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => deleteExpense(expense.id)}
                              className="bg-destructive hover:bg-destructive/90"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 bg-muted/5 border-t text-sm">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {expense.splits.map((split) => {
                      const user = users.find(u => u.id === split.userId);
                      const isPayer = split.userId === expense.paidBy;
                      
                      if (split.amount === 0) return null;

                      return (
                        <div key={split.userId} className="flex items-center gap-2 p-2 rounded bg-background border border-border/50">
                          <Avatar className="w-6 h-6">
                            <AvatarImage src={user?.avatar} />
                            <AvatarFallback>{user?.name[0]}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-xs font-medium">
                              {user?.name} {isPayer && "(Payer)"}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              ₹{split.amount.toFixed(2)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
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
