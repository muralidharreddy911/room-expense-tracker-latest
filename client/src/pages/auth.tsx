import { useApp } from "@/hooks/use-app-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function AuthPage() {
  const { users, login, isLoading } = useApp();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    if (password.length > 0) {
      login(selectedUser, password);
    } else {
      toast({
        title: "Error",
        description: "Please enter your password",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F8F9FA] p-4 relative overflow-hidden">
      {/* Background Texture */}
      <div
        className="absolute inset-0 z-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: 'url(/src/assets/geometric-pattern.png)',
          backgroundSize: '400px',
        }}
      />

      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/50">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 bg-primary rounded-lg flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
            <span className="text-primary-foreground font-display text-2xl font-bold">R</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Welcome Back</CardTitle>
          <CardDescription>Select your profile to continue</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedUser ? (
            <>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="text-sm">Loading profiles...</p>
                </div>
              ) : users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                  <p className="text-sm font-medium">No profiles found.</p>
                  <p className="text-xs">Please check that the server is running and the database is connected.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  {users.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedUser(user.id)}
                      className="flex flex-col items-center p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-accent/5 transition-all group active:scale-95"
                    >
                      <Avatar className="w-16 h-16 mb-3 border-2 border-transparent group-hover:border-primary transition-colors">
                        <AvatarImage src={user.avatar} />
                        <AvatarFallback>{(user.name || user.username).charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-sm text-foreground/80 group-hover:text-primary">
                        {user.name || user.username}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize mt-1 px-2 py-0.5 rounded-full bg-secondary">
                        {user.role}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4 animate-in slide-in-from-right-8 fade-in duration-300">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 mb-6">
                <Avatar className="w-10 h-10">
                  <AvatarImage src={users.find(u => u.id === selectedUser)?.avatar} />
                  <AvatarFallback>
                    {(users.find(u => u.id === selectedUser)?.name || "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-medium text-sm">Logging in as</p>
                  <p className="font-bold">{users.find(u => u.id === selectedUser)?.name || users.find(u => u.id === selectedUser)?.username}</p>
                </div>
                <Button variant="ghost" size="sm" type="button" onClick={() => { setSelectedUser(null); setPassword(""); }}>
                  Change
                </Button>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password..."
                  autoFocus
                />
              </div>

              <Button type="submit" className="w-full text-base py-5 shadow-lg shadow-primary/20 transition-transform active:scale-[0.98]">
                Sign In
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
