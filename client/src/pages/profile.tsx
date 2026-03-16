import { useApp } from "@/hooks/use-app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShieldCheck, Key, Loader2, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ProfilePage() {
  const { currentUser, updateUserPassword, users, logout } = useApp();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Always read the latest password from the live users list (not cached currentUser)
  const liveUser = users.find(u => u.id === currentUser?.id);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser || !liveUser) return;

    // Validate current password against live DB-fetched user record
    if (currentPassword !== liveUser.password) {
      toast({
        title: "Error",
        description: "Current password is incorrect",
        variant: "destructive"
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive"
      });
      return;
    }

    if (newPassword.length < 4) {
      toast({
        title: "Error",
        description: "Password must be at least 4 characters long",
        variant: "destructive"
      });
      return;
    }

    if (newPassword === currentPassword) {
      toast({
        title: "Error",
        description: "New password must be different from current password",
        variant: "destructive"
      });
      return;
    }

    setIsSaving(true);
    try {
      const success = await updateUserPassword(currentUser.id, newPassword);
      if (success) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        // Auto-logout so the user must re-authenticate with the new password
        // This also clears the stale session and forces a fresh login
        setTimeout(() => {
          logout();
        }, 1500); // Give time for the toast to show
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">My Profile</h1>
        <p className="text-muted-foreground">
          Manage your account settings and security.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Account Info */}
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
            <CardDescription>Your personal details and role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-4">
              <Avatar className="h-20 w-20 border-2 border-primary/10">
                <AvatarImage src={currentUser?.avatar} />
                <AvatarFallback className="text-2xl">{currentUser?.name[0]}</AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <h3 className="text-xl font-bold">{currentUser?.name}</h3>
                <div className="flex items-center gap-2 text-sm text-muted-foreground capitalize">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  {currentUser?.role}
                </div>
              </div>
            </div>

            <div className="grid gap-4 pt-4">
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Username</Label>
                <div className="px-3 py-2 bg-secondary/50 rounded-md font-mono text-sm">
                  {currentUser?.username}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Display Name</Label>
                <div className="px-3 py-2 bg-secondary/50 rounded-md text-sm">
                  {currentUser?.name}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5" />
              Change Password
            </CardTitle>
            <CardDescription>
              Update your login credentials. You will be logged out automatically after changing your password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">Current Password</Label>
                <Input
                  id="current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">New Password</Label>
                <Input
                  id="new"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 4 chars)"
                  required
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm New Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  disabled={isSaving}
                />
              </div>

              {/* Password match indicator */}
              {confirmPassword.length > 0 && (
                <p className={`text-xs font-medium ${newPassword === confirmPassword ? 'text-green-600' : 'text-destructive'}`}>
                  {newPassword === confirmPassword ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isSaving}>
                {isSaving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>
                ) : (
                  <><LogOut className="mr-2 h-4 w-4" />Update Password & Re-login</>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
