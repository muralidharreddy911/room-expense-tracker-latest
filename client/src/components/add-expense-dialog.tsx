import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { useApp } from "@/hooks/use-app-store";
import { Expense, Split } from "@/lib/types";

const expenseSchema = z.object({
  description: z.string().min(2, "Description is required"),
  amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  date: z.date(),
  categoryId: z.string().min(1, "Category is required"),
  paidBy: z.string().min(1, "Payer is required"),
  splitType: z.enum(["equal", "custom"]),
  participants: z.array(z.string()).min(1, "Select at least one participant"),
  customSplits: z.record(z.string(), z.coerce.number()).optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

export function AddExpenseDialog({ children }: { children?: React.ReactNode }) {
  const { users, categories, currentUser, addExpense, isMonthLocked } = useApp();
  const [open, setOpen] = useState(false);

  // ── Participant selection managed as plain React state ─────────────────────
  // Reason: form.watch("participants") can become undefined during RHF
  // internal re-renders, causing .includes()/.reduce() to throw and blank page.
  // React.useState is always a defined array — no race conditions possible.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [splitData, setSplitData] = useState<Record<string, number>>({});

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      date: new Date(),
      categoryId: categories[0]?.id || "",
      paidBy: currentUser?.id || "",
      splitType: "equal",
      participants: [],
      customSplits: {},
    },
  });

  // Reset everything when dialog opens
  useEffect(() => {
    if (open && currentUser) {
      const initial = (users || []).map(u => u.id);
      setSelectedIds(initial);
      setSplitData({});
      form.reset({
        description: "",
        amount: 0,
        date: new Date(),
        categoryId: categories[0]?.id || "",
        paidBy: currentUser.id,
        splitType: "equal",
        participants: initial,
        customSplits: {},
      });
    }
  }, [open]); // Only react to dialog open/close

  // Sync state → RHF form fields
  useEffect(() => {
    form.setValue("participants", selectedIds);
  }, [selectedIds]);

  useEffect(() => {
    form.setValue("customSplits", splitData);
  }, [splitData]);

  const splitType = form.watch("splitType");
  const amount = form.watch("amount");
  const customSplits = form.watch("customSplits");

  // Safe array calculation using reliable local state
  const participantSplitTotal = (selectedIds || []).reduce((acc, userId) => {
    const val = Number(splitData?.[userId]);
    return acc + (isNaN(val) ? 0 : val);
  }, 0);
  const remaining = Number(amount || 0) - participantSplitTotal;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (data: ExpenseFormValues) => {
    const month = format(data.date, "yyyy-MM");
    if (isMonthLocked(month)) {
      form.setError("date", { message: "This month is locked and cannot be edited." });
      return;
    }

    if (data.splitType === "custom") {
      const total = data.participants.reduce((acc, userId) => {
        const val = Number(data.customSplits?.[userId]);
        return acc + (isNaN(val) ? 0 : val);
      }, 0);
      
      const diff = Math.abs(total - data.amount);
      if (diff > 0.01) {
        form.setError("customSplits" as any, {
          message: `Split total must equal total amount. (Total: ₹${total.toFixed(2)} vs Amount: ₹${data.amount.toFixed(2)})`,
        });
        return;
      }
    }

    let splits: Split[] = [];
    if (data.splitType === "equal") {
      const splitAmount = data.amount / data.participants.length;
      splits = data.participants.map(userId => ({
        userId,
        amount: Number(splitAmount.toFixed(2)),
      }));
      const currentSum = splits.reduce((sum, s) => sum + s.amount, 0);
      const diff = Number((data.amount - currentSum).toFixed(2));
      if (diff !== 0 && splits.length > 0) {
        splits[0].amount = Number((splits[0].amount + diff).toFixed(2));
      }
    } else {
      splits = data.participants.map(userId => ({
        userId,
        amount: Number(Number(data.customSplits?.[userId] || 0).toFixed(2)),
      }));
    }

    const newExpense: Expense = {
      id: `e${Date.now()}`,
      date: format(data.date, "yyyy-MM-dd"),
      month,
      description: data.description,
      amount: data.amount,
      categoryId: data.categoryId,
      paidBy: data.paidBy,
      splitType: data.splitType,
      splits,
      createdAt: new Date().toISOString(),
    };

    try {
      setIsSubmitting(true);
      await addExpense(newExpense);
      setOpen(false);
    } catch (err) {
      console.error("Failed to add expense:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Participant toggle helpers ──────────────────────────────────────────────
  const allSelected = (users || []).length > 0 && (users || []).every(u => (selectedIds || []).includes(u.id));

  const handleSelectAll = () => {
    setSelectedIds([]);
  };

  const handleToggle = (userId: string) => {
    setSelectedIds(prev => {
      const safePrev = prev || [];
      return safePrev.includes(userId)
        ? safePrev.filter(id => id !== userId)
        : [...safePrev, userId];
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || <Button>Add Expense</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Expense</DialogTitle>
          <DialogDescription>
            Create a transaction and split it among roommates.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Weekly Groceries" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-2.5 text-muted-foreground">₹</span>
                        <Input type="number" step="0.01" className="pl-7 font-mono" placeholder="0.00" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map(cat => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange}
                          disabled={date => date > new Date() || date < new Date("1900-01-01")}
                          initialFocus />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paidBy"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Paid By</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {users.map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* ── Participants — plain React state, no RHF field.value ── */}
            <div className="space-y-2">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium leading-none">Split Among</label>
                {/* Unselect All - use type=button to prevent form submit */}
                <button
                  type="button"
                  className="flex items-center gap-2 group cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
                  onClick={handleSelectAll}
                >
                  Unselect All
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(users || []).map(user => {
                  const isChecked = (selectedIds || []).includes(user.id);
                  return (
                    <div
                      key={user.id}
                      className="flex flex-row items-center gap-3 rounded-md border p-3 shadow-sm hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        id={`add-member-${user.id}`}
                        checked={isChecked}
                        onCheckedChange={() => handleToggle(user.id)}
                        className="shrink-0"
                      />
                      <label
                        htmlFor={`add-member-${user.id}`}
                        className="text-sm font-normal flex-1 cursor-pointer select-none"
                      >
                        {user.name}
                      </label>
                    </div>
                  );
                })}
              </div>

              {/* Show validation error from RHF schema safely */}
              {form.formState.errors.participants?.message && (
                <p className="text-[0.8rem] font-medium text-destructive">
                  {String(form.formState.errors.participants.message)}
                </p>
              )}
            </div>

            <FormField
              control={form.control}
              name="splitType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Split Type</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Button type="button" variant={field.value === "equal" ? "default" : "outline"} className="flex-1" onClick={() => field.onChange("equal")}>Equal</Button>
                      <Button type="button" variant={field.value === "custom" ? "default" : "outline"} className="flex-1" onClick={() => field.onChange("custom")}>Custom</Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {splitType === "custom" && (
              <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium mb-2">Enter Amounts</p>
                <div className="space-y-2 max-h-[30vh] overflow-y-auto">
                  {(users || []).filter(u => (selectedIds || []).includes(u.id)).map(u => (
                    <div key={u.id} className="flex items-center gap-2 space-y-0 p-1">
                      <label className="w-24 truncate text-sm font-medium">{u.name}</label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        className="bg-background flex-1"
                        value={splitData[u.id] || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSplitData(prev => ({
                            ...prev,
                            [u.id]: val === "" ? 0 : Number(val)
                          }));
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="pt-2 text-right text-sm">
                  Remaining: <span className={cn("font-bold",
                    remaining < -0.01 ? "text-destructive"
                      : remaining > 0.01 ? "text-amber-500"
                      : "text-green-600"
                  )}>₹{remaining.toFixed(2)}</span>
                  {remaining > 0.01 && <span className="ml-2 text-xs text-amber-500">(unallocated)</span>}
                  {remaining < -0.01 && <span className="ml-2 text-xs text-destructive">(exceeds total!)</span>}
                </div>
                <p className="text-[0.8rem] font-medium text-destructive">
                  {(form.formState.errors.customSplits as any)?.message}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>
                {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</> : "Add Expense"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
