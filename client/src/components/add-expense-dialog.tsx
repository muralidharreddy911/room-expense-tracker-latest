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
  FormDescription,
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

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: "",
      amount: 0,
      date: new Date(),
      categoryId: categories[0]?.id || "",
      paidBy: currentUser?.id || "",
      splitType: "equal",
      participants: users.map(u => u.id), // Default everyone
      customSplits: {},
    },
  });

  // Reset form when opening
  useEffect(() => {
    if (open && currentUser) {
      form.reset({
        description: "",
        amount: 0,
        date: new Date(),
        categoryId: categories[0]?.id || "",
        paidBy: currentUser.id,
        splitType: "equal",
        participants: users.map(u => u.id),
        customSplits: {},
      });
    }
  }, [open, currentUser, users, categories, form]);

  const splitType = form.watch("splitType");
  const amount = form.watch("amount");
  const participants = form.watch("participants");
  const customSplits = form.watch("customSplits");

  // Calculate remaining correctly — only sum amounts for selected participants
  const participantSplitTotal = participants.reduce((acc, userId) => {
    const val = Number(customSplits?.[userId]);
    return acc + (isNaN(val) ? 0 : val);
  }, 0);
  const remaining = Number(amount || 0) - participantSplitTotal;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (data: ExpenseFormValues) => {
    const month = format(data.date, 'yyyy-MM');
    if (isMonthLocked(month)) {
      form.setError("date", { message: "This month is locked and cannot be edited." });
      return;
    }

    // Validate custom splits don't exceed total
    if (data.splitType === 'custom') {
      const total = data.participants.reduce((acc, userId) => {
        const val = Number(data.customSplits?.[userId]);
        return acc + (isNaN(val) ? 0 : val);
      }, 0);
      if (total > data.amount + 0.01) {
        form.setError("customSplits" as any, { message: `Split total (₹${total.toFixed(2)}) exceeds expense amount (₹${data.amount.toFixed(2)})` });
        return;
      }
    }

    let splits: Split[] = [];

    if (data.splitType === 'equal') {
      const splitAmount = data.amount / data.participants.length;
      splits = data.participants.map(userId => ({
        userId,
        amount: Number(splitAmount.toFixed(2))
      }));
      // Fix rounding errors
      const currentSum = splits.reduce((sum, s) => sum + s.amount, 0);
      const diff = Number((data.amount - currentSum).toFixed(2));
      if (diff !== 0 && splits.length > 0) {
        splits[0].amount = Number((splits[0].amount + diff).toFixed(2));
      }
    } else {
      splits = data.participants.map(userId => ({
        userId,
        amount: Number(Number(data.customSplits?.[userId] || 0).toFixed(2))
      }));
    }

    const newExpense: Expense = {
      id: `e${Date.now()}`,
      date: format(data.date, 'yyyy-MM-dd'),
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
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((cat) => (
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
                          <Button
                            variant={"outline"}
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
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
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                        />
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
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="participants"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel className="text-base">Split Among</FormLabel>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {users.map((item) => (
                      <FormField
                        key={item.id}
                        control={form.control}
                        name="participants"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={item.id}
                              className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-3 shadow-sm hover:bg-accent/50 transition-colors"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(item.id)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...field.value, item.id])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== item.id
                                          )
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal cursor-pointer flex-1">
                                {item.name}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

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

            {splitType === 'custom' && (
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
                   Remaining: <span className={cn("font-bold", 
                    remaining < -0.01
                      ? "text-destructive" 
                      : remaining > 0.01
                      ? "text-amber-500"
                      : "text-green-600"
                   )}>
                     ₹{remaining.toFixed(2)}
                   </span>
                   {remaining > 0.01 && (
                     <span className="ml-2 text-xs text-amber-500">(unallocated)</span>
                   )}
                   {remaining < -0.01 && (
                     <span className="ml-2 text-xs text-destructive">(exceeds total!)</span>
                   )}
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
