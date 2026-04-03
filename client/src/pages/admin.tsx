import { useApp } from "@/hooks/use-app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Lock, Unlock, Plus, Trash2, UserPlus, Tag } from "lucide-react";
import { format, subMonths } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export default function AdminPage() {
  const { categories, addCategory, deleteCategory, monthStatus, lockMonth, unlockMonth, addMonth, users, addUser, removeUser } = useApp();
  const [newCategory, setNewCategory] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "member">("member");
  const [newMonth, setNewMonth] = useState(format(new Date(), 'yyyy-MM'));

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCategory.trim()) {
      addCategory(newCategory.trim());
      setNewCategory("");
    }
  };

  const handleAddMonth = (e: React.FormEvent) => {
    e.preventDefault();
    addMonth(newMonth);
  };

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (newUserName.trim() && newUserPassword.trim()) {
      addUser(newUserName.trim(), newUserRole, newUserPassword.trim());
      setNewUserName("");
      setNewUserPassword("");
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          Manage system settings, categories, and month locking.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Member Management ── */}
        <Card>
          <CardHeader>
            <CardTitle>Member Management</CardTitle>
            <CardDescription>Add or remove room members.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleAddUser} className="space-y-3">
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Full Name"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                  />
                  <Select value={newUserRole} onValueChange={(v: any) => setNewUserRole(v)}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Password"
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                  />
                  <Button type="submit" size="icon">
                    <UserPlus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </form>
            <div className="space-y-2">
              {users.map(user => (
                <div key={user.id} className="flex items-center justify-between p-2 rounded-lg border bg-card">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.avatar} />
                      <AvatarFallback>{user.name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium leading-none">{user.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{user.role}</p>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove Member?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to remove <strong>{user.name}</strong>? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90"
                          onClick={() => removeUser(user.id)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Expense Categories ── */}
        <Card>
          <CardHeader>
            <CardTitle>Expense Categories</CardTitle>
            <CardDescription>Add or remove expense categories.</CardDescription>
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
                <div
                  key={cat.id}
                  className="group flex items-center gap-1.5 px-3 py-1.5 bg-secondary rounded-full text-sm border border-transparent hover:border-destructive/30 transition-colors"
                >
                  <Tag className="w-3 h-3 text-muted-foreground" />
                  <span>{cat.name}</span>
                  {cat.isDefault && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1 ml-1 opacity-60">default</Badge>
                  )}
                  {/* Delete button with confirmation */}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button
                        className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title="Delete category"
                        type="button"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Category?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete the category <strong>"{cat.name}"</strong>?
                          <br /><br />
                          If this category is used in existing expenses, the deletion will be prevented.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive hover:bg-destructive/90"
                          onClick={() => deleteCategory(cat.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Month Management ── */}
        <Card>
          <CardHeader>
            <CardTitle>Month Management</CardTitle>
            <CardDescription>Add new months and lock completed ones.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleAddMonth} className="flex gap-2">
              <Input
                type="month"
                value={newMonth}
                onChange={(e) => setNewMonth(e.target.value)}
              />
              <Button type="submit" size="icon">
                <Plus className="w-4 h-4" />
              </Button>
            </form>
            <div className="space-y-2">
              {monthStatus.sort((a, b) => b.month.localeCompare(a.month)).map(status => {
                const month = status.month;
                const isLocked = status.isLocked;

                return (
                  <div key={month} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {isLocked ? <Lock className="w-4 h-4 text-amber-600" /> : <Unlock className="w-4 h-4 text-green-600" />}
                      <span className="font-medium font-mono">{month}</span>
                    </div>
                    {isLocked ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-50">Unlock</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Unlock Month?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Unlocking <strong>{month}</strong> will allow expenses and settlements to be added again.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => unlockMonth(month)}>Unlock</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="secondary">Lock Month</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Lock Month?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Locking <strong>{month}</strong> will prevent any further edits or expense additions. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => lockMonth(month)}>Lock</AlertDialogAction>
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
      </div>
    </div>
  );
}
