import { useApp } from "@/hooks/use-app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";
import { Lock, Unlock, Plus } from "lucide-react";
import { format, subMonths } from "date-fns";

export default function AdminPage() {
  const { categories, addCategory, monthStatus, lockMonth } = useApp();
  const [newCategory, setNewCategory] = useState("");

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCategory.trim()) {
      addCategory(newCategory.trim());
      setNewCategory("");
    }
  };

  const months = [
    format(new Date(), 'yyyy-MM'),
    format(subMonths(new Date(), 1), 'yyyy-MM'),
    format(subMonths(new Date(), 2), 'yyyy-MM'),
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          Manage system settings, categories, and month locking.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Expense Categories</CardTitle>
            <CardDescription>Add new categories for expenses.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleAddCategory} className="flex gap-2">
              <Input 
                placeholder="New Category Name" 
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
              <Button type="submit" size="icon">
                <Plus className="w-4 h-4" />
              </Button>
            </form>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <div key={cat.id} className="px-3 py-1 bg-secondary rounded-full text-sm flex items-center gap-2">
                  {cat.name}
                  {cat.isDefault && <span className="text-[10px] text-muted-foreground uppercase tracking-widest opacity-50">Default</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Month Management</CardTitle>
            <CardDescription>Lock past months to prevent edits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {months.map(month => {
              const status = monthStatus.find(m => m.month === month);
              const isLocked = status?.isLocked;

              return (
                <div key={month} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    {isLocked ? <Lock className="w-4 h-4 text-amber-600" /> : <Unlock className="w-4 h-4 text-green-600" />}
                    <span className="font-medium font-mono">{month}</span>
                  </div>
                  {isLocked ? (
                    <Button size="sm" variant="outline" disabled>Locked</Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => lockMonth(month)}>
                      Lock Month
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
