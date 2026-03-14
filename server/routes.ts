import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { INITIAL_USERS, INITIAL_CATEGORIES } from "../client/src/lib/mock-data";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Seed Defaults
  try {
    const defaultUsername = "Admin";
    const existingAdmin = await storage.getUserByUsername(defaultUsername);
    if (!existingAdmin) {
      // Seed first user
      await storage.createUser({
        username: "Admin",
        name: "Admin", // Assuming UI name field is populated
        role: "admin",
        password: "Admin123",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Admin"
      });
      console.log("Default Admin user successfully created.");
      
      // Also strictly seed the initial categories since otherwise they won't exist in new DB
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

  // Month
  app.post("/api/months", async (req, res) => {
    try {
      const { month, isLocked } = req.body;
      const m = await storage.upsertMonthStatus(month, isLocked);
      res.json(m);
    } catch (e) { res.status(500).json({ error: "Failed" }); }
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
