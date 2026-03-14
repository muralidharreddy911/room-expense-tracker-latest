import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // put application routes here
  // prefix all routes with /api

  // Ensure default Admin user exists
  try {
    const defaultUsername = "Admin";
    const existingAdmin = await storage.getUserByUsername(defaultUsername);
    if (!existingAdmin) {
      await storage.createUser({
        username: defaultUsername,
        password: "Admin123", // Consider hashing this if authentication is added later
      });
      console.log("Default Admin user successfully created.");
    }
  } catch (error) {
    console.error("Failed to seed default Admin user:", error);
  }

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  return httpServer;
}
