// Load environment variables from .env.local if present (development)
if (process.env.NODE_ENV !== "production") {
  try {
    const fs = require("fs");
    const path = require("path");
    const envFile = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envFile)) {
      const contents = fs.readFileSync(envFile, "utf-8");
      contents.split("\n").forEach((line: string) => {
        const [key, ...valueParts] = line.split("=");
        if (key && key.trim() && !key.startsWith("#")) {
          const value = valueParts.join("=").trim();
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = value;
          }
        }
      });
    }
  } catch (err) {
    // Ignore errors loading .env.local
  }
}

import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
const httpServer = createServer(app);

app.use(cors());

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Raw request logger — fires before body parsers so we capture even rejected requests
app.use((req: any, _res, next) => {
  if (req.method === "POST" && req.path.includes("slack")) {
    console.log(`[slack-raw] POST ${req.path} content-type=${req.headers["content-type"] || "none"} content-length=${req.headers["content-length"] || "?"}`);
  }
  next();
});

app.use(
  express.json({
    limit: "15mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "2mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const snippet = JSON.stringify(capturedJsonResponse).slice(0, 120);
        logLine += ` :: ${snippet}${snippet.length >= 120 ? "…" : ""}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    await db.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`);
    await db.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS submitted_by TEXT`);
    await db.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parts_needed BOOLEAN DEFAULT false`);
    log("database schema verified");
    // Backfill submitted_by from nextStepsHistory[0].updatedBy where missing
    const backfillResult = await db.execute(sql`
      UPDATE tickets
      SET submitted_by = next_steps_history->0->>'updatedBy'
      WHERE submitted_by IS NULL
        AND next_steps_history IS NOT NULL
        AND jsonb_array_length(next_steps_history) > 0
        AND (next_steps_history->0->>'updatedBy') NOT IN ('', 'External', 'Unknown')
    `);
    if ((backfillResult as any).rowCount > 0) {
      log(`submitted_by backfill: updated ${(backfillResult as any).rowCount} tickets`);
    }
    // Dynamically normalize email/malformed submitted_by values using Slack lookup
    try {
      const { lookupSlackNameByEmail, getSlackMembers } = await import("./slack");
      // Fetch all Slack members so email→name cache is warm
      await getSlackMembers();

      // Find all tickets where submitted_by looks like an email or a CamelCase blob
      const toFix = await db.execute(sql`
        SELECT DISTINCT submitted_by FROM tickets
        WHERE submitted_by IS NOT NULL
          AND submitted_by NOT IN ('External','Unknown','System','Agent Test')
          AND trim(submitted_by) <> ''
          AND (
            submitted_by LIKE '%@%'
            OR submitted_by ~ '^[A-Z][a-z]+[A-Z]'
          )
      `);

      let fixedCount = 0;
      for (const row of toFix.rows as any[]) {
        const raw: string = row.submitted_by;
        let resolved: string | null = null;

        if (raw.includes('@')) {
          // Email — look up via Slack
          resolved = await lookupSlackNameByEmail(raw);
        } else if (/^[A-Z][a-z]+[A-Z]/.test(raw)) {
          // CamelCase blob like "JesseMoure" — split into "Jesse Moure"
          resolved = raw.replace(/([a-z])([A-Z])/g, '$1 $2');
        }

        if (resolved && resolved !== raw) {
          await db.execute(sql`
            UPDATE tickets SET submitted_by = ${resolved}
            WHERE submitted_by = ${raw}
          `);
          fixedCount++;
        }
      }
      if (fixedCount > 0) {
        log(`submitted_by normalize: fixed ${fixedCount} distinct values via Slack lookup`);
      }
    } catch (normalizeErr: any) {
      console.warn("submitted_by normalize warning:", normalizeErr.message);
    }
  } catch (err: any) {
    console.error("Schema migration warning:", err.message);
  }

  // Seed canonical issue/solution buckets if tables are empty
  try {
    const issueCount = await db.execute(sql`SELECT COUNT(*) as c FROM issue_buckets`);
    const isEmpty = Number((issueCount.rows[0] as any).c) === 0;
    if (isEmpty) {
      await db.execute(sql`
        INSERT INTO issue_buckets (id, name, description, count) VALUES
          (4,  'Configuration / Recipe Error',   'Incorrect recipe settings, operator configuration mistakes, or use of unauthorized materials/equipment', 0),
          (5,  'Feature Request / Enhancement',  'Customer requesting new features, component upgrades, or system enhancements', 0),
          (6,  'Software / Network Issue',       'Software bugs, network connectivity failures, and database corruption or duplication issues', 0),
          (8,  'Test / Invalid Ticket',          'Test ticket or invalid submission with no actual issue', 0),
          (9,  'Supplier / Material Change',     'Supplier changed material dimensions or specifications, requiring system recalibration or offset adjustment', 0),
          (12, 'Mechanical / Hardware Issue',    'Hardware failures, component wear, mechanical damage, pneumatic issues, loose fasteners, and missing hardware', 0),
          (14, 'Sensor Issue',                   'Sensor false triggers, axis mastering loss, calibration problems, and environmental interference with sensors', 0),
          (21, 'Pending / Unresolved',           'Ticket closed with root cause not determined, or issue not yet reproduced or resolved', 0),
          (22, 'Information Request',            'Customer requests for documentation, specifications, inventory verification, or general information', 0)
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`SELECT setval('issue_buckets_id_seq', 30, true)`);

      await db.execute(sql`
        INSERT INTO solution_buckets (id, name, description, count) VALUES
          (3,  'Recipe / Software Correction',     'Resolved by correcting recipe parameters, updating software, adjusting robot programs, or recalibrating thresholds and offsets', 0),
          (4,  'Remote Support & Configuration',   'Issue resolved via remote access session to correct configuration settings, re-master axes, or restore system state', 0),
          (7,  'No Action Required',               'Ticket closed without technical action: test tickets, duplicates, unresolved submissions, or information-only responses', 0),
          (8,  'Mechanical Repair & Adjustment',   'Hands-on mechanical fixes: lubrication, connector tightening, pneumatic work, fastener upgrades, sensor installation, or physical recalibration', 0),
          (9,  'Manual Recovery & System Restart', 'System restored by manual jog, power cycle, network restart, or cable reconnection without physical parts work', 0),
          (10, 'Escalation to Engineering',        'Issue escalated or routed to product engineering or Solutions team for root cause analysis or product development', 0),
          (12, 'Parts / Component Replacement',    'Resolved by replacing or swapping physical components: suction cups, cables, wire harnesses, batteries, or equipment', 0),
          (15, 'Pending / Deferred Resolution',    'Ticket closed pending further investigation, customer response, or future issue recurrence', 0),
          (22, 'Training & Knowledge Transfer',    'Resolved through operator training session or knowledge transfer to build internal capability', 0),
          (27, 'Sensor Maintenance & Calibration', 'Cleaned, repositioned, or calibrated sensors; adjusted detection thresholds or gripper pick positions', 0)
        ON CONFLICT (id) DO NOTHING
      `);
      await db.execute(sql`SELECT setval('solution_buckets_id_seq', 30, true)`);
      log("Seeded canonical issue/solution buckets");
    }
  } catch (err: any) {
    console.error("Bucket seed warning:", err.message);
  }

  await setupAuth(app);
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);
  
  // Auto-sync customer directory from Airtable on startup.
  // Uses a cheap LAST_MODIFIED_TIME check first so it only does the full
  // paginated fetch when Airtable actually has changes since last sync.
  (async () => {
    try {
      const { storage } = await import("./storage");
      const { fetchCustomerDirectoryFromAirtable } = await import("./airtable");
      const meta = await storage.getCustomerDirectoryMeta();
      // Pass lastSyncAt as `since` — if set, the function will do a quick
      // single-request change check before pulling all records.
      const since = meta.lastSyncAt ? new Date(meta.lastSyncAt) : undefined;
      if (since) {
        log("Customer directory: checking Airtable for changes...", "startup");
      } else {
        log("Customer directory: no prior sync — doing full fetch from Airtable...", "startup");
      }
      const result = await fetchCustomerDirectoryFromAirtable(since);
      if (!result.changed) {
        await storage.updateCustomerDirectoryMeta(meta.recordCount ?? 0, meta.airtableChecksum ?? "");
        log(`Customer directory unchanged — ${meta.recordCount} customers already up-to-date`, "startup");
      } else {
        const count = await storage.upsertCustomerDirectory(result.entries);
        await storage.updateCustomerDirectoryMeta(count, result.checksum);
        log(`Customer directory synced: ${count} customers stored locally`, "startup");
      }
    } catch (err: any) {
      console.warn("Could not sync customer directory:", err.message);
    }
  })();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
