import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { db } from "../../db";
import { userRoles } from "@shared/schema";
import { eq } from "drizzle-orm";

export const BOOTSTRAP_ADMIN_EMAIL = "jmoure@formic.co";

export async function resolveUserRole(userId: string, email: string | undefined): Promise<string> {
  if (email === BOOTSTRAP_ADMIN_EMAIL) return "admin";
  const [row] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  return row?.role || "requester";
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const email: string | undefined = req.user?.claims?.email;
      if (!email || !email.endsWith("@formic.co")) {
        req.logout(() => {
          req.session?.destroy(() => {});
        });
        return res.status(403).json({ message: "Access restricted to @formic.co email addresses" });
      }

      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      const role = await resolveUserRole(userId, email);
      res.json({ ...user, role });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/auth/user/preferences", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { defaultViewId } = req.body;
      const user = await authStorage.updateUserPreferences(userId, {
        defaultViewId: defaultViewId ?? null,
      });
      res.json(user);
    } catch (error) {
      console.error("Error updating user preferences:", error);
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });
}
