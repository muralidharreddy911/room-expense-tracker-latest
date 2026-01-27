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

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType, adminOnly?: boolean }) {
  const { currentUser } = useApp();

  if (!currentUser) return <AuthPage />;
  if (adminOnly && currentUser.role !== 'admin') return <NotFound />; // Or Redirect to Dashboard

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  const { currentUser } = useApp();

  if (!currentUser) {
    return <AuthPage />;
  }

  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/expenses" component={() => <ProtectedRoute component={Expenses} />} />
      <Route path="/settlements" component={() => <ProtectedRoute component={Settlements} />} />
      <Route path="/admin" component={() => <ProtectedRoute component={Admin} adminOnly />} />
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
