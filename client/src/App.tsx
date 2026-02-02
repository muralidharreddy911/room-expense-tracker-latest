import { Switch, Route } from "wouter";
import { AppProvider, useApp } from "@/hooks/use-app-store";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import AuthPage from "@/pages/auth";

// Lazy load these later if needed, but simple imports are fine for now
import Dashboard from "@/pages/dashboard";
import Expenses from "@/pages/expenses";
import Settlements from "@/pages/settlements";
import Admin from "@/pages/admin";
import Profile from "@/pages/profile";

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType, adminOnly?: boolean }) {
  const { currentUser } = useApp();

  if (!currentUser) return <AuthPage />;
  
  // If we're trying to access the admin page but we're not an admin, redirect to dashboard
  if (adminOnly && currentUser.role !== 'admin') {
    // Check if we are already at the root to avoid infinite loops
    if (window.location.pathname !== '/') {
      window.location.replace('/');
    }
    return null;
  }

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/expenses" component={() => <ProtectedRoute component={Expenses} />} />
      <Route path="/settlements" component={() => <ProtectedRoute component={Settlements} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={Admin} adminOnly />} />
      <Route path="/profile" component={() => <ProtectedRoute component={Profile} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <AppProvider>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </AppProvider>
  );
}

export default App;
