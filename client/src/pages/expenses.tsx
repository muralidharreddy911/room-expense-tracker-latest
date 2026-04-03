import { useApp } from "@/hooks/use-app-store";
import { format, parseISO } from "date-fns";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddExpenseDialog } from "@/components/add-expense-dialog";
import { EditExpenseDialog } from "@/components/edit-expense-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, AlertCircle, Lock, Loader2, Pencil, RefreshCw, CalendarX } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Expense } from "@/lib/types";

export default function ExpensesPage() {
  const {
    expenses, users, categories, currentUser,
    deleteExpense, isMonthLocked, availableMonths, refreshState,
  } = useApp();

  // ── Month selector — only shows admin-created months (no auto calendar month) ──
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expenseToEdit, setExpenseToEdit] = useState<Expense | null>(null);

  // Set default to most recent available month once loaded
  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0]); // already sorted newest first
    }
  }, [availableMonths]);

  const isLocked = selectedMonth ? isMonthLocked(selectedMonth) : false;

  const filteredExpenses = expenses
    .filter(e => e.month === selectedMonth)
    .sort((a, b) => {
      // Sort by serial number (ascending) — date-independent
      const sa = a.serialNo ?? 0;
      const sb = b.serialNo ?? 0;
      if (sa !== sb) return sa - sb;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  const handleDelete = async (expenseId: string) => {
    setDeletingId(expenseId);
    try {
      await deleteExpense(expenseId);
    } finally {
      setDeletingId(null);
    }
  };

  const totalForMonth = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);

  // No months created yet
  if (availableMonths.length === 0) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
            <p className="text-muted-foreground">Manage and track shared bills.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshState}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
        <div className="border rounded-xl p-12 flex flex-col items-center gap-4 text-center bg-muted/30 border-dashed text-muted-foreground">
          <CalendarX className="w-10 h-10 opacity-40" />
          <div>
            <p className="font-semibold text-lg">No months available</p>
            <p className="text-sm mt-1 opacity-75">
              Ask the Admin to create a month from Admin → Month Management before adding expenses.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-in fade-in duration-500">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Expenses</h1>
            <p className="text-muted-foreground">Manage and track shared bills.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
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

            <Button variant="outline" size="icon" onClick={refreshState} title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </Button>

            {!isLocked && selectedMonth && <AddExpenseDialog />}
          </div>
        </div>

        {/* ── Locked Month Banner ── */}
        {isLocked && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 rounded-lg flex items-center gap-3 text-amber-800 dark:text-amber-200">
            <Lock className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm font-medium">
              This month is locked by Admin. No expenses can be added, edited, or deleted.
            </p>
          </div>
        )}

        {/* ── Month Summary ── */}
        {filteredExpenses.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <span className="text-sm text-muted-foreground">
              {filteredExpenses.length} expense{filteredExpenses.length !== 1 ? 's' : ''} this month
            </span>
            <span className="text-sm font-semibold">
              Total: <span className="font-mono">₹{totalForMonth.toFixed(2)}</span>
            </span>
          </div>
        )}

        {/* ── Expense List ── */}
        <div className="space-y-4">
          {filteredExpenses.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
              <AlertCircle className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No expenses recorded for this month.</p>
              {!isLocked && (
                <p className="text-xs mt-1">Click "Add Expense" to get started.</p>
              )}
            </div>
          ) : (
            filteredExpenses.map((expense) => {
              const payer = users.find(u => u.id === expense.paidBy);
              const category = categories.find(c => c.id === expense.categoryId);
              const isDeleting = deletingId === expense.id;

              // Only the payer can delete/edit, only in unlocked months
              const isPayer = currentUser?.id === expense.paidBy;
              const canDelete = !isLocked && isPayer;
              const canEdit = !isLocked && isPayer;

              return (
                <Card
                  key={expense.id}
                  className={cn(
                    "overflow-hidden transition-all group",
                    isDeleting ? "opacity-50 scale-[0.99]" : "hover:border-primary/50"
                  )}
                >
                  <CardHeader className="p-4 sm:p-6 bg-secondary/10 flex flex-row items-start justify-between space-y-0">
                    {/* ── Left: Serial + Date + Info ── */}
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      {/* Serial + Date badge */}
                      <div className="flex flex-col items-center justify-center bg-background border rounded-lg p-2 w-14 h-14 shadow-sm flex-shrink-0">
                        <span className="text-[10px] font-bold text-primary/70 uppercase tracking-wide">
                          #{expense.serialNo ?? '—'}
                        </span>
                        <span className="text-xs font-bold text-muted-foreground uppercase">
                          {format(parseISO(expense.date), 'MMM')}
                        </span>
                        <span className="text-lg font-bold font-display leading-tight">
                          {format(parseISO(expense.date), 'dd')}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-lg font-semibold flex items-center gap-2 flex-wrap">
                          <span className="truncate">{expense.description}</span>
                          <Badge variant="outline" className="font-normal text-xs bg-background flex-shrink-0">
                            {category?.name ?? "—"}
                          </Badge>
                          {isLocked && (
                            <Badge variant="secondary" className="font-normal text-xs flex-shrink-0 gap-1">
                              <Lock className="w-2.5 h-2.5" /> Locked
                            </Badge>
                          )}
                        </CardTitle>
                        <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                          Paid by
                          <Avatar className="w-5 h-5 ml-1 mr-1 border border-border">
                            <AvatarImage src={payer?.avatar} />
                            <AvatarFallback>{payer?.name?.[0]}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">{payer?.name}</span>
                        </div>
                      </div>
                    </div>

                    {/* ── Right: Amount + Actions ── */}
                    <div className="flex items-start gap-1 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-xl font-bold font-display">
                          ₹{expense.amount.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {expense.splitType === 'equal' ? 'Split Equally' : 'Custom Split'}
                        </div>
                      </div>

                      {/* Edit button */}
                      {canEdit ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => setExpenseToEdit(expense)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Edit expense</p></TooltipContent>
                        </Tooltip>
                      ) : null}

                      {/* Delete button */}
                      {canDelete ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                              disabled={isDeleting}
                            >
                              {isDeleting
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />
                              }
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Expense?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete{" "}
                                <strong>"{expense.description}"</strong> worth{" "}
                                <strong>₹{expense.amount.toFixed(2)}</strong>?
                                <br /><br />
                                This action cannot be undone. All split balances will be recalculated automatically.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(expense.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Confirm Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : isLocked ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="h-8 w-8 flex items-center justify-center text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Lock className="w-4 h-4" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent><p>This month is locked. Deletion is not allowed.</p></TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </CardHeader>

                  {/* ── Splits footer ── */}
                  <CardContent className="p-4 bg-muted/5 border-t text-sm">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {expense.splits.map(split => {
                        const user = users.find(u => u.id === split.userId);
                        const isSplitPayer = split.userId === expense.paidBy;
                        if (split.amount === 0) return null;
                        return (
                          <div key={split.userId} className="flex items-center gap-2 p-2 rounded bg-background border border-border/50">
                            <Avatar className="w-6 h-6">
                              <AvatarImage src={user?.avatar} />
                              <AvatarFallback>{user?.name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="truncate text-xs font-medium">
                                {user?.name} {isSplitPayer && <span className="text-primary">(Payer)</span>}
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

        {/* ── Edit Dialog (mounted once, controlled by state) ── */}
        {expenseToEdit && (
          <EditExpenseDialog
            expense={expenseToEdit}
            open={!!expenseToEdit}
            onOpenChange={open => !open && setExpenseToEdit(null)}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
