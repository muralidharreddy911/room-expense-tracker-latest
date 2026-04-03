import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { CalendarIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

const editExpenseSchema = z.object({
  description: z.string().min(2, "Description is required"),
  amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  date: z.date(),
  categoryId: z.string().min(1, "Category is required"),
  splitType: z.enum(["equal", "custom"]),
  participants: z.array(z.string()).min(1, "Select at least one participant"),
  customSplits: z.record(z.string(), z.coerce.number()).optional(),
});

type EditExpenseFormValues = z.infer<typeof editExpenseSchema>;

interface EditExpenseDialogProps {
  expense: Expense;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditExpenseDialog({ expense, open, onOpenChange }: EditExpenseDialogProps) {
  const { users, categories, currentUser, updateExpense, isMonthLocked } = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The month this expense belongs to — date must stay within it
  const expenseMonth = expense.month; // YYYY-MM
  const monthStart = startOfMonth(parseISO(`${expenseMonth}-01`));
  const monthEnd = endOfMonth(parseISO(`${expenseMonth}-01`));

  const form = useForm<EditExpenseFormValues>({
    resolver: zodResolver(editExpenseSchema),
    defaultValues: {
      description: expense.description,
      amount: expense.amount,
      date: parseISO(expense.date),
      categoryId: expense.categoryId,
      splitType: expense.splitType,
      participants: expense.splits.map(s => s.userId),
      customSplits: Object.fromEntries(
        expense.splits.map(s => [s.userId, s.amount])
      ),
    },
  });

  // Sync form when expense changes (e.g., different expense opened)
  useEffect(() => {
    if (open) {
      form.reset({
        description: expense.description,
        amount: expense.amount,
        date: parseISO(expense.date),
        categoryId: expense.categoryId,
        splitType: expense.splitType,
        participants: expense.splits.map(s => s.userId),
        customSplits: Object.fromEntries(
          expense.splits.map(s => [s.userId, s.amount])
        ),
      });
    }
  }, [open, expense]);

  const splitType = form.watch("splitType");
  const amount = form.watch("amount");
  const participants = form.watch("participants");
  const customSplits = form.watch("customSplits");

  const participantSplitTotal = participants.reduce((acc, userId) => {
    const val = Number(customSplits?.[userId]);
    return acc + (isNaN(val) ? 0 : val);
  }, 0);
  const remaining = Number(amount || 0) - participantSplitTotal;

  const onSubmit = async (data: EditExpenseFormValues) => {
    if (isMonthLocked(expenseMonth)) {
      form.setError("date", { message: "This month is locked and cannot be edited." });
      return;
    }

    // Date must stay within the same month
    const newMonth = format(data.date, "yyyy-MM");
    if (newMonth !== expenseMonth) {
      form.setError("date", {
        message: `Date must stay within ${format(parseISO(`${expenseMonth}-01`), "MMMM yyyy")}.`,
      });
      return;
    }

    // Validate custom splits
    if (data.splitType === "custom") {
      const total = data.participants.reduce((acc, userId) => {
        const val = Number(data.customSplits?.[userId]);
        return acc + (isNaN(val) ? 0 : val);
      }, 0);
      if (total > data.amount + 0.01) {
        form.setError("customSplits" as any, {
          message: `Split total (₹${total.toFixed(2)}) exceeds expense amount (₹${data.amount.toFixed(2)})`,
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
      // Fix rounding error — put diff on first participant
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

    const updatedExpense: Expense = {
      ...expense, // preserve id, serialNo, paidBy, createdAt, month
      date: format(data.date, "yyyy-MM-dd"),
      description: data.description,
      amount: data.amount,
      categoryId: data.categoryId,
      splitType: data.splitType,
      splits,
    };

    try {
      setIsSubmitting(true);
      await updateExpense(updatedExpense);
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to update expense:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const payer = users.find(u => u.id === expense.paidBy);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Expense</DialogTitle>
          <DialogDescription>
            Editing <strong>#{expense.serialNo}</strong> — Paid by{" "}
            <strong>{payer?.name ?? "Unknown"}</strong>. Date must stay in{" "}
            {format(parseISO(`${expenseMonth}-01`), "MMMM yyyy")}.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* Description */}
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

            {/* Amount + Category */}
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
                        <Input
                          type="number"
                          step="0.01"
                          className="pl-7 font-mono"
                          placeholder="0.00"
                          {...field}
                        />
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
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map(cat => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Date (restricted to same month) */}
            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date (must stay in {format(parseISO(`${expenseMonth}-01`), "MMMM yyyy")})</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full pl-3 text-left font-normal",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {field.value
                            ? format(field.value, "PPP")
                            : <span>Pick a date</span>
                          }
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) =>
                          date > monthEnd || date < monthStart
                        }
                        defaultMonth={monthStart}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Payer (read-only) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Paid By</label>
              <div className="px-3 py-2 rounded-md bg-secondary/50 text-sm font-medium">
                {payer?.name ?? "Unknown"}
                <span className="ml-2 text-xs text-muted-foreground">(cannot be changed)</span>
              </div>
            </div>

            {/* Participants */}
            <FormField
              control={form.control}
              name="participants"
              render={() => (
                <FormItem>
                  <div className="mb-2 flex items-center justify-between">
                    <FormLabel className="text-base">Split Among</FormLabel>
                    {/* Select All / Unselect All */}
                    <div
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={() => {
                        const allIds = users.map(u => u.id);
                        const currentParticipants = form.getValues("participants");
                        const allSelected = allIds.every(id => currentParticipants.includes(id));
                        form.setValue("participants", allSelected ? [] : allIds, { shouldValidate: true });
                      }}
                    >
                      <Checkbox
                        checked={participants.length === users.length && users.length > 0}
                        className="pointer-events-none"
                      />
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors select-none">
                        {participants.length === users.length ? "Unselect All" : "Select All"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {users.map(item => (
                      <FormField
                        key={item.id}
                        control={form.control}
                        name="participants"
                        render={({ field }) => (
                          <FormItem
                            key={item.id}
                            className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-accent/50 transition-colors"
                          >
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(item.id)}
                                onCheckedChange={checked =>
                                  checked
                                    ? field.onChange([...field.value, item.id])
                                    : field.onChange(field.value?.filter(v => v !== item.id))
                                }
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer flex-1">
                              {item.name}
                              {item.id === expense.paidBy && (
                                <span className="ml-1 text-xs text-primary">(Payer)</span>
                              )}
                            </FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Split Type */}
            <FormField
              control={form.control}
              name="splitType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Split Type</FormLabel>
                  <FormControl>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={field.value === "equal" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => field.onChange("equal")}
                      >
                        Equal
                      </Button>
                      <Button
                        type="button"
                        variant={field.value === "custom" ? "default" : "outline"}
                        className="flex-1"
                        onClick={() => field.onChange("custom")}
                      >
                        Custom
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Custom Splits Input */}
            {splitType === "custom" && (
              <div className="space-y-2 p-4 bg-muted/50 rounded-lg">
                <p className="text-sm font-medium mb-2">Enter Amounts</p>
                {users.filter(u => participants.includes(u.id)).map(u => (
                  <FormField
                    key={u.id}
                    control={form.control}
                    name={`customSplits.${u.id}`}
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2 space-y-0">
                        <FormLabel className="w-24 truncate">{u.name}</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            placeholder="0.00"
                            className="bg-background"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                ))}
                <div className="pt-2 text-right text-sm">
                  Remaining:{" "}
                  <span className={cn("font-bold",
                    remaining < -0.01
                      ? "text-destructive"
                      : remaining > 0.01
                      ? "text-amber-500"
                      : "text-green-600"
                  )}>
                    ₹{remaining.toFixed(2)}
                  </span>
                  {remaining > 0.01 && <span className="ml-2 text-xs text-amber-500">(unallocated)</span>}
                  {remaining < -0.01 && <span className="ml-2 text-xs text-destructive">(exceeds total!)</span>}
                </div>
                <p className="text-[0.8rem] font-medium text-destructive">
                  {(form.formState.errors.customSplits as any)?.message}
                </p>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                  : "Save Changes"
                }
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
