import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { INITIAL_CATEGORIES } from "../client/src/lib/mock-data";
import { invalidateActiveUsersCache, registerTelegramWebhookRoute } from "./services/telegram-bot-service";

export function registerRoutes(
  httpServer: Server,
  app: Express
): Server {
  registerTelegramWebhookRoute(app);
  
  // Seed Defaults Asynchronously
  (async () => {
    try {
      // Only seed if database has ZERO users (prevents re-seeding after admin deletion)
      const allUsers = await storage.getUsers();
      if (allUsers.length === 0) {
        await storage.createUser({
          username: "Admin",
          name: "Admin",
          role: "admin",
          password: "Admin123",
          avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin"
        });
        console.log("Default Admin user successfully created.");
        const { categories } = await storage.getAppState();
        if (categories.length === 0) {
          for (const cat of INITIAL_CATEGORIES) {
            await storage.createCategory({ name: cat.name, isDefault: cat.isDefault });
          }
        }
      }
    } catch (error) {
      console.error("Failed to seed default Admin user:", error);
    }
  })();

  // --- API ROUTES ---

  app.get("/api/state", async (req: Request, res: Response) => {
    try {
      const state = await storage.getAppState();
      res.json(state);
    } catch (e) {
      res.status(500).json({ error: "Failed to load state" });
    }
  });

  // Users
  app.get("/api/users", async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json(allUsers);
    } catch (e) {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const user = await storage.createUser(req.body);
      res.json(user);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.put("/api/users/:id/password", async (req, res) => {
    try {
      await storage.updateUserPassword(req.params.id, req.body.password);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.get("/api/active-users", async (req, res) => {
    try {
      const month = String(req.query.month || "");
      if (!month) {
        res.status(400).json({ error: "month query param is required (YYYY-MM)" });
        return;
      }

      const allUsers = await storage.getUsers();
      let activeUsers: Awaited<ReturnType<typeof storage.getActiveUsers>> = [];
      try {
        activeUsers = await storage.getActiveUsers(month);
      } catch (error) {
        console.error("Failed to read active users for month, defaulting to all users:", error);
      }
      const effective = activeUsers.length > 0 ? activeUsers : allUsers;

      res.json({
        month,
        userIds: effective.map((u) => u.id),
        users: effective,
        source: activeUsers.length > 0 ? "custom" : "default-all",
      });
    } catch (e) {
      res.status(500).json({ error: "Failed" });
    }
  });

  app.post("/api/active-users", async (req, res) => {
    try {
      const month = String(req.body?.month || "");
      const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];

      if (!month) {
        res.status(400).json({ error: "month is required" });
        return;
      }

      await storage.setActiveUsers(month, userIds);
      invalidateActiveUsersCache(month);
      res.json({ success: true, month, userIds });
    } catch (e) {
      res.status(500).json({ error: "Failed" });
    }
  });

  // Expenses
  app.post("/api/expenses", async (req, res) => {
    try {
      const e = await storage.createExpense(req.body);
      res.json(e);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.put("/api/expenses/:id", async (req, res) => {
    try {
      const e = await storage.updateExpense(req.params.id, req.body);
      res.json(e);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.delete("/api/expenses/:id", async (req, res) => {
    try {
      await storage.deleteExpense(req.params.id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  // Categories
  app.post("/api/categories", async (req, res) => {
    try {
      const c = await storage.createCategory(req.body);
      res.json(c);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.delete("/api/categories/:id", async (req, res) => {
    try {
      await storage.deleteCategory(req.params.id);
      res.json({ success: true });
    } catch (e: any) { res.status(409).json({ error: e.message || "Failed" }); }
  });

  // Month
  app.post("/api/months", async (req, res) => {
    try {
      const { month, isLocked } = req.body;
      const m = await storage.upsertMonthStatus(month, isLocked);
      res.json(m);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  // Unlock month
  app.delete("/api/months/:month", async (req, res) => {
    try {
      const m = await storage.upsertMonthStatus(req.params.month, false);
      res.json(m);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  // Delete month completely
  app.delete("/api/months/:month/delete", async (req, res) => {
    try {
      await storage.deleteMonth(req.params.month);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message || "Failed to delete month" }); }
  });

  // Settlements
  app.post("/api/settlements", async (req, res) => {
    try {
      const s = await storage.createSettlement(req.body);
      res.json(s);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  app.put("/api/settlements/:id", async (req, res) => {
    try {
      const s = await storage.updateSettlementStatus(req.params.id, req.body.status);
      res.json(s);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
  });

  return httpServer;
}
