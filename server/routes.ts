import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { sql, eq, isNull } from "drizzle-orm";
import { ticketPriorityHistory, regionGroups, insertRegionGroupSchema, ROLE_KEYS, BUILTIN_ROLES, DEFAULT_ROLE_CONFIG, type RolePermissions } from "@shared/schema";
import { api } from "@shared/routes";
import { z } from "zod";
import { getUncachableSlackClient, postTicketToSlack, postThreadReply, postAssigneeDm, lookupSlackUserId, lookupSlackUserIdByEmail, mentionName, replaceNamesWithMentions, resolveAtMentions, getSlackMembers, getSlackChannelNamesForIds, buildSystemIdLabel, resolveSlackMentions, getBotUserId, lookupSlackNameByEmail, getWorkflowTriggerUrl } from "./slack";
import { sendEmail } from "./gmail";
import {
  fetchAirtableRecords,
  createAirtableRecord,
  fetchCustomerContacts,
  fetchContactDuplicates,
  fetchAllContactsWithCustomer,
  deleteAirtableContact,
  updateAirtableContactRecord,
  createAirtableContact,
  updateAirtableRecord,
  mapAirtableToTicket,
  getCustomerRecordId,
  getContactRecordId,
  getSiteRecordId,
  getCustomerNames,
  fetchSystemsForCustomer,
  getAsaRecordId,
  getAsaNumberForSystem,
  fetchCustomerDirectoryFromAirtable,
  fetchSystemRegion,
  fetchSystemMeta,
  getClosedFjdIds,
  fetchBillingSystemIds,
  updateJobsDbSync,
  getSystemMetaEntry,
  fetchAllJobsdbCustomerMappings,
  createPartsOrderRecord,
  getSiteChannelForSystemId,
} from "./airtable";
import { generateTitleSummary, polishText, generateCloseTicketFields } from "./ai-summary";
import { getOncall } from "./lib/opsCommand";
import { isAuthenticated } from "./replit_integrations/auth";
import { resolveUserRole, BOOTSTRAP_ADMIN_EMAIL } from "./replit_integrations/auth/routes";
import type { RequestHandler } from "express";

const requireFormicEmail: RequestHandler = (req: any, res, next) => {
  const email: string | undefined = req.user?.claims?.email;
  if (!email || !email.endsWith("@formic.co")) {
    req.logout(() => {});
    req.session?.destroy(() => {});
    return res.status(403).json({ message: "Access restricted to @formic.co email addresses" });
  }
  next();
};

// ---------------------------------------------------------------------------
// Resolve a human-readable display name for the authenticated user.
// Priority: auth first+last name → Slack profile lookup by email → email local part → fallback
async function resolveUserDisplayName(user: any, fallback = "Unknown"): Promise<string> {
  const firstName = user?.claims?.first_name;
  const lastName = user?.claims?.last_name;
  if (firstName || lastName) {
    return [firstName, lastName].filter(Boolean).join(" ");
  }
  const email: string | undefined = user?.claims?.email;
  if (email) {
    try {
      const slackName = await lookupSlackNameByEmail(email);
      if (slackName) return slackName;
    } catch {}
    // Use the local part of the email as a last resort (e.g. "cprice" from "cprice@formic.co")
    const localPart = email.split("@")[0];
    if (localPart) return localPart;
    return email;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Shared guard: prevents duplicate Slack notifications across all three
// ticket-creation paths (web app, Slack modal, sync).
//
// Returns:
//   { skip: true, existingThreadId?: string } — caller should skip the post
//     (and optionally link the ticket to the existing thread ID).
//   { skip: false } — safe to post.
//
// Priority order of checks:
//   1. Same ticketNumber already in DB  → always skip (even if other ticket's
//      slackMessageId is still null — avoids race between Airtable write and
//      slackMessageId save).
//   2. Same airtableRecordId already in DB → skip.
//   3. Same description + customer + system with a slackMessageId → skip.
// ---------------------------------------------------------------------------
async function checkSlackDuplicate(ticket: {
  id: number;
  ticketNumber?: string | null;
  airtableRecordId?: string | null;
  description?: string | null;
  customerName?: string | null;
  systemId?: string | null;
}): Promise<{ skip: boolean; existingThreadId?: string }> {
  const freshTickets = await storage.getTickets();

  if (ticket.ticketNumber) {
    const same = freshTickets.find(
      t => t.ticketNumber === ticket.ticketNumber && t.id !== ticket.id
    );
    if (same) {
      console.log(`[SlackDedup] Skipping post for ${ticket.ticketNumber} — ticket id=${same.id} already exists (slackMessageId=${same.slackMessageId ?? "null"})`);
      return { skip: true, existingThreadId: same.slackMessageId ?? undefined };
    }
  }

  if (ticket.airtableRecordId) {
    const same = freshTickets.find(
      t => t.airtableRecordId === ticket.airtableRecordId && t.id !== ticket.id
    );
    if (same) {
      console.log(`[SlackDedup] Skipping post for airtableRecordId=${ticket.airtableRecordId} — ticket id=${same.id} already exists`);
      return { skip: true, existingThreadId: same.slackMessageId ?? undefined };
    }
  }

  if (ticket.description && ticket.customerName) {
    const same = freshTickets.find(
      t =>
        t.description === ticket.description &&
        t.customerName === ticket.customerName &&
        (!ticket.systemId || t.systemId === ticket.systemId) &&
        t.slackMessageId &&
        t.id !== ticket.id
    );
    if (same) {
      console.log(`[SlackDedup] Skipping post for ticket id=${ticket.id} — content match with id=${same.id} (slackMessageId=${same.slackMessageId})`);
      return { skip: true, existingThreadId: same.slackMessageId ?? undefined };
    }
  }

  return { skip: false };
}

// ── Priority history helpers ──────────────────────────────────────────────────

async function openPriorityHistory(ticketId: number, priorityLabel: string | null | undefined, startedAt: Date = new Date()) {
  await db.insert(ticketPriorityHistory).values({ ticketId, priorityLabel: priorityLabel ?? null, startedAt, endedAt: null });
}

async function closePriorityHistory(ticketId: number, endedAt: Date = new Date()) {
  await db.execute(sql`
    UPDATE ticket_priority_history
    SET ended_at = ${endedAt}
    WHERE ticket_id = ${ticketId} AND ended_at IS NULL
  `);
}

async function rotatePriorityHistory(ticketId: number, newPriorityLabel: string | null | undefined, at: Date = new Date()) {
  await closePriorityHistory(ticketId, at);
  await openPriorityHistory(ticketId, newPriorityLabel, at);
}

// Module-level cache for open PM work orders (2-hour TTL)
interface MxOpenPMCache {
  wos: Array<{
    title: string; assetName: string | null; sysId: string | null;
    dueDate: string | null; assignedTo: string | null; woId: string | null; status: string;
    recurrence: string | null;
  }>;
  fetchedAt: number;
  totalScanned: number;
}
let _mxOpenPMCache: MxOpenPMCache | null = null;

const BUCKET_LIMIT = 10;

async function condenseBucketsIfNeeded(
  anthropic: any,
  type: "issue" | "solution"
): Promise<{ merged: number }> {
  const buckets = type === "issue"
    ? await storage.getIssueBuckets()
    : await storage.getSolutionBuckets();

  if (buckets.length <= BUCKET_LIMIT) return { merged: 0 };

  console.log(`[condense] ${type} buckets at ${buckets.length} — condensing to ${BUCKET_LIMIT}`);

  const bucketList = buckets
    .map(b => `[${b.id}] ${b.name} (${b.count} tickets): ${b.description || ""}`)
    .join("\n");

  const prompt = `You manage categorization for an industrial robotics field-service ticket system (Formic Technologies).
There are currently ${buckets.length} ${type} buckets, which exceeds the limit of ${BUCKET_LIMIT}.
Merge similar buckets to bring the total down to at most ${BUCKET_LIMIT}.

Current ${type} buckets:
${bucketList}

Rules:
- Keep buckets with the highest ticket counts where possible.
- Merge buckets that represent the same or very similar concepts.
- For each bucket being eliminated, specify which surviving bucket absorbs it.
- You may optionally update the surviving bucket's name or description to better reflect the merged content.
- Only include buckets being eliminated (merged away) in the response.

Respond with ONLY valid JSON (no markdown):
{
  "merges": [
    {
      "eliminateId": <number — id of bucket to remove>,
      "mergeIntoId": <number — id of surviving bucket>,
      "survivingName": "<updated name for surviving bucket, or null to keep existing>",
      "survivingDescription": "<updated description, or null to keep existing>"
    }
  ]
}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const rawContent = ((message.content[0] as any).text || "").trim();
  let parsed: { merges: Array<{ eliminateId: number; mergeIntoId: number; survivingName: string | null; survivingDescription: string | null }> };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    const match = rawContent.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Condense: invalid JSON from Claude");
    parsed = JSON.parse(match[0]);
  }

  let merged = 0;
  for (const merge of parsed.merges || []) {
    const { eliminateId, mergeIntoId, survivingName, survivingDescription } = merge;
    // Remap all tickets from the eliminated bucket to the surviving bucket
    if (type === "issue") {
      await storage.remapTicketIssueBucket(eliminateId, mergeIntoId);
    } else {
      await storage.remapTicketSolutionBucket(eliminateId, mergeIntoId);
    }
    // Optionally update surviving bucket metadata
    if (survivingName || survivingDescription) {
      const updateData: Record<string, string> = {};
      if (survivingName) updateData.name = survivingName;
      if (survivingDescription) updateData.description = survivingDescription;
      if (type === "issue") {
        await storage.updateIssueBucket(mergeIntoId, updateData);
      } else {
        await storage.updateSolutionBucket(mergeIntoId, updateData);
      }
    }
    // Delete the eliminated bucket
    if (type === "issue") {
      await storage.deleteIssueBucket(eliminateId);
    } else {
      await storage.deleteSolutionBucket(eliminateId);
    }
    merged++;
    console.log(`[condense] ${type} bucket ${eliminateId} merged into ${mergeIntoId}`);
  }

  // Recalculate counts for the surviving buckets
  if (type === "issue") {
    await storage.recalcIssueBucketCounts();
  } else {
    await storage.recalcSolutionBucketCounts();
  }

  const remaining = type === "issue"
    ? await storage.getIssueBuckets()
    : await storage.getSolutionBuckets();
  console.log(`[condense] ${type} buckets after condense: ${remaining.length}`);

  return { merged };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.tickets.list.path, isAuthenticated, requireFormicEmail, async (req, res) => {
    const allTickets = await storage.getTickets();
    res.json(allTickets);
  });

  // ── Customer Directory ──────────────────────────────────────────────────────
  app.get("/api/customers", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const entries = await storage.getCustomerDirectory();
    res.json(entries);
  });

  app.get("/api/customers/sync-status", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const meta = await storage.getCustomerDirectoryMeta();
    const STALE_HOURS = 24;
    const isStale = !meta.lastSyncAt ||
      (Date.now() - new Date(meta.lastSyncAt).getTime()) > STALE_HOURS * 60 * 60 * 1000;
    res.json({ lastSyncAt: meta.lastSyncAt, recordCount: meta.recordCount, isStale });
  });

  app.post("/api/customers/sync", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const meta = await storage.getCustomerDirectoryMeta();
      const since = meta.lastSyncAt ? new Date(meta.lastSyncAt) : undefined;
      const result = await fetchCustomerDirectoryFromAirtable(since);

      if (!result.changed) {
        // Nothing changed in Airtable — just refresh the timestamp
        await storage.updateCustomerDirectoryMeta(meta.recordCount ?? 0, meta.airtableChecksum ?? "");
        console.log(`[customerDirectory] No changes detected — skipped full fetch`);
        return res.json({ ok: true, changed: false, count: meta.recordCount ?? 0 });
      }

      const count = await storage.upsertCustomerDirectory(result.entries);
      await storage.updateCustomerDirectoryMeta(count, result.checksum);
      console.log(`[customerDirectory] Synced ${count} customers from Airtable`);
      res.json({ ok: true, changed: true, count, checksum: result.checksum });
    } catch (err: any) {
      console.error("[customerDirectory] Sync failed:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── AI helpers ──────────────────────────────────────────────────────────────
  app.post("/api/ai/polish-text", isAuthenticated, requireFormicEmail, async (req, res) => {
    const { rawText, mode, context } = req.body as {
      rawText: string;
      mode: "description" | "next-steps";
      context?: { ticketTitle?: string; customerName?: string; systemId?: string; assigneeName?: string };
    };
    if (!rawText?.trim()) return res.status(400).json({ message: "rawText is required" });
    if (mode !== "description" && mode !== "next-steps") return res.status(400).json({ message: "mode must be 'description' or 'next-steps'" });
    try {
      const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const result = await polishText(rawText, mode, { ...context, today });
      return res.json({ result });
    } catch (err: any) {
      console.error("AI polish-text failed:", err.message || err);
      return res.status(500).json({ message: err.message || "AI request failed" });
    }
  });

  app.post("/api/ai/close-assist", isAuthenticated, requireFormicEmail, async (req, res) => {
    const { rawText, context } = req.body as {
      rawText: string;
      context?: { ticketTitle?: string; customerName?: string; description?: string };
    };
    if (!rawText?.trim()) return res.status(400).json({ message: "rawText is required" });
    try {
      const result = await generateCloseTicketFields(rawText, context);
      return res.json(result);
    } catch (err: any) {
      console.error("AI close-assist failed:", err.message || err);
      return res.status(500).json({ message: err.message || "AI request failed" });
    }
  });

  app.post("/api/ai/regen-title", isAuthenticated, requireFormicEmail, async (req, res) => {
    const { description } = req.body as { description: string };
    if (!description?.trim()) return res.status(400).json({ message: "description is required" });
    try {
      const title = await generateTitleSummary(description);
      return res.json({ title });
    } catch (err: any) {
      return res.status(500).json({ message: err.message || "AI request failed" });
    }
  });

  app.post("/api/ai/smart-search", isAuthenticated, requireFormicEmail, async (req, res) => {
    const { query, currentUserName, availableAssignees, availableCustomers, availablePriorities, availableRegions, availableSystemIds } = req.body as {
      query: string;
      currentUserName: string;
      availableAssignees: string[];
      availableCustomers: string[];
      availablePriorities: string[];
      availableRegions: string[];
      availableSystemIds: string[];
    };
    if (!query?.trim()) return res.status(400).json({ message: "query is required" });
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const today = new Date().toISOString().split("T")[0];

      // Load recent failed searches to include in prompt for self-correction
      const recentFails = await storage.getRecentSmartSearchFails(10);
      const failExamplesBlock = recentFails.length > 0
        ? `\nRECENT SEARCHES THAT RETURNED ZERO RESULTS — learn from these and avoid the same filter mistakes:\n` +
          recentFails.map(f =>
            `- Query: "${f.query}"\n  Bad filters used: ${JSON.stringify(f.aiFilters)}\n  → If this query arrives again, produce different/broader filters to return results.`
          ).join("\n") + "\n"
        : "";

      const systemPrompt = `You are a filter interpreter for a field service ticket tracker called ISR (Incident/Support Request) at Formic Technologies.
Given a natural language search query from a user, decide whether it is a "simple" text search or a structured filter query.

Simple = the user is looking for a specific ticket by number, customer name, system ID, or short keyword (1-4 words, no priority levels, no complex conditions like time ranges or multi-attribute filters). NEVER use simple if the query mentions priority levels (P1, P2, P3, P4), escalation levels, assignees, customers, or any filterable attribute.
Filters = the user is expressing conditions like assignee, date ranges, status, priority, escalation level, region, etc.

Available filter values (use EXACT strings from these lists when setting filters):
- Assignees: ${JSON.stringify(availableAssignees)}
- Customers: ${JSON.stringify(availableCustomers)}
- Priorities: ${JSON.stringify(availablePriorities)}
- Regions: ${JSON.stringify(availableRegions)}
- System IDs: ${JSON.stringify(availableSystemIds)}
- Status values: ["open", "closed"]
- Escalation level values: ["Standard", "Elevated", "High", "Critical"]
  - "Standard" = not escalated (green)
  - "Elevated" = slightly escalated (amber)
  - "High" = high escalation, manager+ (orange)
  - "Critical" = critical escalation, admin only (red)
  - If the user says "escalated", "any escalation", "elevated or above" → use ["Elevated", "High", "Critical"]
  - If the user says "critical" → use ["Critical"]
  - If the user says "high" in an escalation context → use ["High", "Critical"]
- Current user name: "${currentUserName}"
- Today's date: ${today}

IMPORTANT RULES:
1. If the user says "me", "my", "assigned to me", "mine" → use "${currentUserName}" as the assignee.
2. "last N days" / "past N days" / "in the last N days" → set dateFilterDays to N.
3. "last week" → dateFilterDays: 7, "last month" → dateFilterDays: 30.
4. Default status is "open" unless the user explicitly asks for closed or all tickets.
5. For assignee/customer/region/systemId: match to the closest available value from the list above. If no close match, leave empty [].
6. For priority: you can use shorthand like "P1", "P2", "P3", "P4" or exact labels. Multiple priorities = multiple entries in array.
   - Priority team prefixes: "AT priority" or "AT tickets" means any ticket in the AT team (AT: P1, AT: P2, AT: P3, AT: P4) — use the bare prefix "AT". Similarly "FO priority" → "FO", "PD priority" → "PD", "CS priority" → "CS", "DL priority" → "DL". Use the prefix alone (e.g., "AT") to match all tickets of that team.
7. For priority + escalation combined queries like "P1 and P2 and escalated" or "P1, P2, or any escalated": set priority to ["P1","P2"] AND escalationLevel to ["Elevated","High","Critical"]. IMPORTANT: when both priority and escalationLevel are set, the system uses OR logic — tickets matching EITHER the priority OR the escalation level will appear. This is correct behavior for "find P1, P2, or escalated" queries.
   - CRITICAL: NEVER include "Standard" in escalationLevel for "any escalated" / "with escalations" queries. "Standard" means NOT escalated (the default). Use only ["Elevated","High","Critical"] for escalation queries.
8. titleSearch should ONLY contain keywords the user wants to find in the ticket TITLE. Do not put escalation status, priority levels, or other non-title concepts there. Leave it empty "" if not searching titles.
9. isrSearch should ONLY contain a ticket number or short ID to search across ticket number/customer/title/assignee fields. Leave it empty "" for structured filter queries.
10. If the query looks like a simple keyword search (short phrase, likely a customer or ticket number), return type "simple".
11. ONLY return valid JSON. No markdown, no explanation outside the JSON.

Return this exact JSON structure:
{
  "type": "simple" | "filters",
  "isrSearch": "string (only for type=simple, the raw search term)",
  "filters": {
    "status": ["open"],
    "priority": [],
    "assignee": [],
    "customer": [],
    "region": [],
    "systemId": [],
    "escalationLevel": [],
    "dateFilterDays": null,
    "submittedFrom": "",
    "submittedTo": "",
    "titleSearch": "",
    "isrSearch": ""
  },
  "explanation": "Short human-readable description of what filters were applied (only for type=filters)"
}${failExamplesBlock}`;

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        messages: [{ role: "user", content: query }],
        system: systemPrompt,
      });

      const raw = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
      // Strip markdown code fences if present
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      const parsed = JSON.parse(jsonText);
      console.log(`[smart-search] query="${query}" → type=${parsed.type} filters=${JSON.stringify(parsed.filters ?? parsed.isrSearch)}`);
      return res.json(parsed);
    } catch (err: any) {
      console.error("AI smart-search failed:", err.message || err);
      return res.status(500).json({ message: err.message || "AI request failed" });
    }
  });

  // Bucket CRUD
  app.get("/api/buckets", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const [issue, solution] = await Promise.all([
        storage.getIssueBuckets(),
        storage.getSolutionBuckets(),
      ]);
      res.json({ issueBuckets: issue, solutionBuckets: solution });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch buckets" });
    }
  });

  // Tags — return all unique tags in use across all tickets
  app.get("/api/tickets/tags", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const allTickets = await storage.getTickets();
      const tagSet = new Set<string>();
      allTickets.forEach(t => (t.tags ?? []).forEach((tag: string) => tagSet.add(tag)));
      res.json(Array.from(tagSet).sort());
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch tags" });
    }
  });

  // AI Bucketize — classify ticket resolution into named issue/solution buckets
  app.post("/api/ai/bucketize", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { ticketTitle, description, finalDetermination, finalSolution } = req.body as {
        ticketTitle?: string;
        description?: string;
        finalDetermination: string;
        finalSolution: string;
      };
      if (!finalDetermination?.trim() || !finalSolution?.trim()) {
        return res.status(400).json({ message: "finalDetermination and finalSolution are required" });
      }

      const [existingIssues, existingSolutions] = await Promise.all([
        storage.getIssueBuckets(),
        storage.getSolutionBuckets(),
      ]);

      const issueBucketList = existingIssues.map(b => `[${b.id}] ${b.name}: ${b.description || ""}`).join("\n") || "(none yet)";
      const solutionBucketList = existingSolutions.map(b => `[${b.id}] ${b.name}: ${b.description || ""}`).join("\n") || "(none yet)";

      const prompt = `You are classifying a resolved field service ticket into problem and solution categories.

Ticket title: ${ticketTitle || "(not provided)"}
Ticket description: ${description || "(not provided)"}
Final determination (root cause): ${finalDetermination}
Final solution (how it was resolved): ${finalSolution}

Existing ISSUE buckets:
${issueBucketList}

Existing SOLUTION buckets:
${solutionBucketList}

Your task:
1. Pick the best matching ISSUE bucket for the root cause. If no existing bucket fits well, create a new one.
2. Pick the best matching SOLUTION bucket for how it was resolved. If no existing bucket fits well, create a new one.

Respond with ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "issueBucket": {
    "existingId": <number or null>,
    "name": "<short category name, max 50 chars>",
    "description": "<brief description of what this bucket covers, max 120 chars>",
    "isNew": <true if creating a new bucket, false if using existing>
  },
  "solutionBucket": {
    "existingId": <number or null>,
    "name": "<short category name, max 50 chars>",
    "description": "<brief description of what this bucket covers, max 120 chars>",
    "isNew": <true if creating a new bucket, false if using existing>
  }
}`;

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      const rawContent = (message.content[0] as any).text?.trim() || "";
      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        const match = rawContent.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Claude returned invalid JSON");
        parsed = JSON.parse(match[0]);
      }

      // Resolve or create issue bucket
      let issueBucket: { id: number; name: string; description: string | null; isNew: boolean };
      if (!parsed.issueBucket.isNew && parsed.issueBucket.existingId) {
        const existing = existingIssues.find(b => b.id === parsed.issueBucket.existingId);
        if (existing) {
          issueBucket = { id: existing.id, name: existing.name, description: existing.description, isNew: false };
        } else {
          const created = await storage.createIssueBucket({ name: parsed.issueBucket.name, description: parsed.issueBucket.description, count: 0 });
          issueBucket = { id: created.id, name: created.name, description: created.description, isNew: true };
        }
      } else {
        const created = await storage.createIssueBucket({ name: parsed.issueBucket.name, description: parsed.issueBucket.description, count: 0 });
        issueBucket = { id: created.id, name: created.name, description: created.description, isNew: true };
      }

      // Resolve or create solution bucket
      let solutionBucket: { id: number; name: string; description: string | null; isNew: boolean };
      if (!parsed.solutionBucket.isNew && parsed.solutionBucket.existingId) {
        const existing = existingSolutions.find(b => b.id === parsed.solutionBucket.existingId);
        if (existing) {
          solutionBucket = { id: existing.id, name: existing.name, description: existing.description, isNew: false };
        } else {
          const created = await storage.createSolutionBucket({ name: parsed.solutionBucket.name, description: parsed.solutionBucket.description, count: 0 });
          solutionBucket = { id: created.id, name: created.name, description: created.description, isNew: true };
        }
      } else {
        const created = await storage.createSolutionBucket({ name: parsed.solutionBucket.name, description: parsed.solutionBucket.description, count: 0 });
        solutionBucket = { id: created.id, name: created.name, description: created.description, isNew: true };
      }

      // Kick off condense asynchronously if new buckets were created
      if (issueBucket.isNew || solutionBucket.isNew) {
        const anthropicForCondense = anthropic;
        setImmediate(async () => {
          try {
            if (issueBucket.isNew) await condenseBucketsIfNeeded(anthropicForCondense, "issue");
            if (solutionBucket.isNew) await condenseBucketsIfNeeded(anthropicForCondense, "solution");
          } catch (e: any) {
            console.error("[condense] background condense failed:", e.message);
          }
        });
      }

      return res.json({ issueBucket, solutionBucket });
    } catch (err: any) {
      console.error("Bucketize error:", err.message || err);
      return res.status(500).json({ message: err.message || "Bucketization failed" });
    }
  });

  // Bulk bucketize — classify all unclassified closed tickets in a single run
  app.post("/api/ai/bucketize-all", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    // Allow up to 10 minutes for large backlogs
    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const allTickets = await storage.getTickets();
      const unclassified = allTickets.filter(
        t => t.status === "closed" && (!t.issueBucketId || !t.solutionBucketId)
      );

      let processed = 0;
      let skipped = 0;
      let errors = 0;
      let newIssueBuckets = 0;
      let newSolutionBuckets = 0;

      for (const ticket of unclassified) {
        try {
          // Build context from available fields
          const determination =
            (ticket.resolution && ticket.resolution.trim().length > 10
              ? ticket.resolution
              : null) ??
            [ticket.description].filter(Boolean).join(" ").slice(0, 400) ??
            ticket.title;

          const solution =
            (ticket.nextSteps && ticket.nextSteps.trim().length > 5
              ? ticket.nextSteps
              : null) ??
            ticket.resolution ??
            "Ticket resolved — no additional details recorded";

          // Refresh bucket lists each iteration so new buckets appear as options
          const [existingIssues, existingSolutions] = await Promise.all([
            storage.getIssueBuckets(),
            storage.getSolutionBuckets(),
          ]);

          const issueBucketList =
            existingIssues.map(b => `[${b.id}] ${b.name}: ${b.description || ""}`).join("\n") ||
            "(none yet)";
          const solutionBucketList =
            existingSolutions.map(b => `[${b.id}] ${b.name}: ${b.description || ""}`).join("\n") ||
            "(none yet)";

          const prompt = `You are classifying a resolved field service ticket into problem and solution categories for an industrial robotics company (Formic Technologies).

Ticket title: ${ticket.title}
Ticket description: ${(ticket.description || "").slice(0, 300)}
Root cause / determination: ${determination.slice(0, 400)}
Resolution / solution: ${solution.slice(0, 400)}

Existing ISSUE buckets (root cause categories):
${issueBucketList}

Existing SOLUTION buckets (resolution categories):
${solutionBucketList}

Your task:
1. Pick the best matching ISSUE bucket for the root cause. Reuse an existing bucket if it fits reasonably well (don't create duplicates). Only create a new one if nothing fits.
2. Pick the best matching SOLUTION bucket for the resolution. Same rule — prefer existing buckets.
3. Use concise, reusable category names (e.g. "Software Fault", "Sensor Calibration", "Remote Support Fix", "Parts Replacement").

Respond with ONLY valid JSON in this exact shape (no markdown, no explanation):
{
  "issueBucket": {
    "existingId": <number or null>,
    "name": "<short category name, max 50 chars>",
    "description": "<brief description of what this bucket covers, max 120 chars>",
    "isNew": <true if creating a new bucket, false if using existing>
  },
  "solutionBucket": {
    "existingId": <number or null>,
    "name": "<short category name, max 50 chars>",
    "description": "<brief description of what this bucket covers, max 120 chars>",
    "isNew": <true if creating a new bucket, false if using existing>
  }
}`;

          const message = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 400,
            messages: [{ role: "user", content: prompt }],
          });

          const rawContent = ((message.content[0] as any).text || "").trim();
          let parsed: any;
          try {
            parsed = JSON.parse(rawContent);
          } catch {
            const match = rawContent.match(/\{[\s\S]*\}/);
            if (!match) throw new Error("Invalid JSON from Claude");
            parsed = JSON.parse(match[0]);
          }

          // Resolve or create issue bucket (only if ticket doesn't already have one)
          let issueBucketId = ticket.issueBucketId ?? null;
          if (!issueBucketId) {
            let issueBucket: { id: number };
            if (!parsed.issueBucket.isNew && parsed.issueBucket.existingId) {
              const ex = existingIssues.find(b => b.id === parsed.issueBucket.existingId);
              if (ex) {
                issueBucket = ex;
              } else {
                const created = await storage.createIssueBucket({
                  name: parsed.issueBucket.name,
                  description: parsed.issueBucket.description,
                  count: 0,
                });
                issueBucket = created;
                newIssueBuckets++;
              }
            } else {
              const created = await storage.createIssueBucket({
                name: parsed.issueBucket.name,
                description: parsed.issueBucket.description,
                count: 0,
              });
              issueBucket = created;
              newIssueBuckets++;
            }
            issueBucketId = issueBucket.id;
            await storage.incrementIssueBucketCount(issueBucketId);
          }

          // Resolve or create solution bucket
          let solutionBucketId = ticket.solutionBucketId ?? null;
          if (!solutionBucketId) {
            let solutionBucket: { id: number };
            if (!parsed.solutionBucket.isNew && parsed.solutionBucket.existingId) {
              const ex = existingSolutions.find(b => b.id === parsed.solutionBucket.existingId);
              if (ex) {
                solutionBucket = ex;
              } else {
                const created = await storage.createSolutionBucket({
                  name: parsed.solutionBucket.name,
                  description: parsed.solutionBucket.description,
                  count: 0,
                });
                solutionBucket = created;
                newSolutionBuckets++;
              }
            } else {
              const created = await storage.createSolutionBucket({
                name: parsed.solutionBucket.name,
                description: parsed.solutionBucket.description,
                count: 0,
              });
              solutionBucket = created;
              newSolutionBuckets++;
            }
            solutionBucketId = solutionBucket.id;
            await storage.incrementSolutionBucketCount(solutionBucketId);
          }

          // Update the ticket
          await storage.updateTicket(ticket.id, {
            issueBucketId: issueBucketId ?? undefined,
            solutionBucketId: solutionBucketId ?? undefined,
          });

          processed++;
        } catch (err: any) {
          console.error(`[bucketize-all] ticket ${ticket.id} failed:`, err.message || err);
          errors++;
        }
      }

      // Condense buckets if any new ones were created during bulk run
      let issueCondensed = 0;
      let solutionCondensed = 0;
      if (newIssueBuckets > 0) {
        const r = await condenseBucketsIfNeeded(anthropic, "issue").catch(e => { console.error("[condense] issue:", e.message); return { merged: 0 }; });
        issueCondensed = r.merged;
      }
      if (newSolutionBuckets > 0) {
        const r = await condenseBucketsIfNeeded(anthropic, "solution").catch(e => { console.error("[condense] solution:", e.message); return { merged: 0 }; });
        solutionCondensed = r.merged;
      }

      return res.json({
        message: "Bulk bucketization complete",
        total: unclassified.length,
        processed,
        skipped,
        errors,
        newIssueBuckets,
        newSolutionBuckets,
        issueCondensed,
        solutionCondensed,
      });
    } catch (err: any) {
      console.error("[bucketize-all] fatal error:", err.message || err);
      return res.status(500).json({ message: err.message || "Bulk bucketization failed" });
    }
  });

  // Reassess all buckets — re-classify every closed ticket against the current bucket list (admin only)
  app.post("/api/ai/reassess-buckets", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    req.setTimeout(15 * 60 * 1000);
    res.setTimeout(15 * 60 * 1000);
    try {
      const userId: string | undefined = req.user?.claims?.sub;
      const email: string | undefined = req.user?.claims?.email;
      const userRole = await resolveUserRole(userId ?? "", email);
      if (userRole !== "admin") return res.status(403).json({ message: "Admin only" });

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const allTickets = await storage.getTickets();
      const closed = allTickets.filter(t => t.status === "closed");

      const [existingIssues, existingSolutions] = await Promise.all([
        storage.getIssueBuckets(),
        storage.getSolutionBuckets(),
      ]);
      const issueBucketList = existingIssues.map(b => `[${b.id}] ${b.name}: ${b.description || ""}`).join("\n");
      const solutionBucketList = existingSolutions.map(b => `[${b.id}] ${b.name}: ${b.description || ""}`).join("\n");
      const validIssueIds = new Set(existingIssues.map(b => b.id));
      const validSolutionIds = new Set(existingSolutions.map(b => b.id));

      let processed = 0;
      let errors = 0;
      const BATCH = 15;

      for (let i = 0; i < closed.length; i += BATCH) {
        const batch = closed.slice(i, i + BATCH);
        try {
          const ticketLines = batch.map((t, idx) => {
            const det = (t.resolution && t.resolution.trim().length > 10 ? t.resolution : null) ?? (t.description || "").slice(0, 200) ?? t.title;
            const sol = (t.nextSteps && t.nextSteps.trim().length > 5 ? t.nextSteps : null) ?? t.resolution ?? "No details";
            return `[${idx + 1}] Title: ${t.title.slice(0, 80)}\n    Cause: ${det.slice(0, 150)}\n    Solution: ${sol.slice(0, 150)}`;
          }).join("\n");

          const prompt = `Classify these ${batch.length} field-service tickets. For each, pick ONE issue bucket and ONE solution bucket from the fixed lists below. Do NOT invent new buckets — choose the closest match.

ISSUE buckets:
${issueBucketList}

SOLUTION buckets:
${solutionBucketList}

Tickets:
${ticketLines}

Respond with ONLY a valid JSON array (no markdown), one entry per ticket in order:
[{"idx":1,"issueBucketId":<id>,"solutionBucketId":<id>}, ...]`;

          const message = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 512,
            messages: [{ role: "user", content: prompt }],
          });

          const rawContent = ((message.content[0] as any).text || "").trim();
          let results: Array<{ idx: number; issueBucketId: number; solutionBucketId: number }>;
          try { results = JSON.parse(rawContent); }
          catch {
            const match = rawContent.match(/\[[\s\S]*\]/);
            if (!match) throw new Error("Invalid JSON array");
            results = JSON.parse(match[0]);
          }

          for (const r of results) {
            const ticket = batch[r.idx - 1];
            if (!ticket) continue;
            if (!validIssueIds.has(r.issueBucketId) || !validSolutionIds.has(r.solutionBucketId)) {
              console.warn(`[reassess] bad IDs for ticket ${ticket.id}: issue=${r.issueBucketId} solution=${r.solutionBucketId}`);
              errors++;
              continue;
            }
            await storage.updateTicket(ticket.id, {
              issueBucketId: r.issueBucketId,
              solutionBucketId: r.solutionBucketId,
            });
            processed++;
          }
        } catch (err: any) {
          console.error(`[reassess] batch ${i}-${i + BATCH} failed:`, err.message);
          errors += batch.length;
        }
      }

      // Recalculate all bucket counts from scratch
      await Promise.all([
        storage.recalcIssueBucketCounts(),
        storage.recalcSolutionBucketCounts(),
      ]);

      return res.json({ message: "Reassessment complete", total: closed.length, processed, errors });
    } catch (err: any) {
      console.error("[reassess-buckets] error:", err.message);
      return res.status(500).json({ message: err.message || "Reassessment failed" });
    }
  });

  // Clear all buckets of a given type (admin only) — wipes bucket records and ticket assignments
  app.delete("/api/admin/buckets/:type", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const userId: string | undefined = req.user?.claims?.sub;
      const email: string | undefined = req.user?.claims?.email;
      const userRole = await resolveUserRole(userId ?? "", email);
      if (userRole !== "admin") return res.status(403).json({ message: "Admin only" });
      const { type } = req.params;
      if (type === "issue") {
        await storage.clearAllIssueBuckets();
        return res.json({ message: "All issue buckets cleared" });
      } else if (type === "solution") {
        await storage.clearAllSolutionBuckets();
        return res.json({ message: "All solution buckets cleared" });
      } else {
        return res.status(400).json({ message: "type must be 'issue' or 'solution'" });
      }
    } catch (err: any) {
      console.error("[clear-buckets] error:", err.message);
      return res.status(500).json({ message: err.message || "Clear failed" });
    }
  });

  // Manual condense — merge similar buckets down to BUCKET_LIMIT (admin only)
  app.post("/api/ai/condense-buckets", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const userId: string | undefined = req.user?.claims?.sub;
      const email: string | undefined = req.user?.claims?.email;
      const userRole = await resolveUserRole(userId ?? "", email);
      if (userRole !== "admin") return res.status(403).json({ message: "Admin only" });
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const [issueResult, solutionResult] = await Promise.all([
        condenseBucketsIfNeeded(anthropic, "issue"),
        condenseBucketsIfNeeded(anthropic, "solution"),
      ]);
      return res.json({
        message: "Condense complete",
        issueMerged: issueResult.merged,
        solutionMerged: solutionResult.merged,
      });
    } catch (err: any) {
      console.error("[condense-buckets] error:", err.message);
      return res.status(500).json({ message: err.message || "Condense failed" });
    }
  });

  // Log when an AI smart-search returns 0 results so the system can self-correct
  app.post("/api/ai/smart-search/feedback", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { query, aiFilters, explanation } = req.body as { query: string; aiFilters: any; explanation: string | null };
      const userEmail = req.user?.email ?? null;
      await storage.logSmartSearchFail({ query, aiFilters, explanation, userEmail });
      console.log(`[smart-search] zero-result logged: "${query}"`);
      return res.json({ ok: true });
    } catch (err: any) {
      console.error("Smart search feedback log error:", err.message);
      return res.status(500).json({ message: "Failed to log" });
    }
  });

  app.get("/api/tickets/options", isAuthenticated, requireFormicEmail, async (req, res) => {
    const allTickets = await storage.getTickets();
    const unique = (arr: (string | null)[]) => [...new Set(arr.filter(Boolean))].sort() as string[];

    // Build customerSystemIds from local directory first, fall back to ticket history
    const directoryEntries = await storage.getCustomerDirectory();
    const customerSystemIds: Record<string, string[]> = {};

    if (directoryEntries.length > 0) {
      for (const e of directoryEntries) {
        customerSystemIds[e.name] = [...e.systemIds].sort();
      }
      // Merge in any system IDs from tickets that aren't in the directory yet
      for (const t of allTickets) {
        if (t.customerName && t.systemId) {
          if (!customerSystemIds[t.customerName]) customerSystemIds[t.customerName] = [];
          if (!customerSystemIds[t.customerName].includes(t.systemId)) {
            customerSystemIds[t.customerName].push(t.systemId);
            customerSystemIds[t.customerName].sort();
          }
        }
      }
    } else {
      // No directory yet — derive from tickets
      for (const t of allTickets) {
        if (t.customerName && t.systemId) {
          if (!customerSystemIds[t.customerName]) customerSystemIds[t.customerName] = [];
          if (!customerSystemIds[t.customerName].includes(t.systemId)) {
            customerSystemIds[t.customerName].push(t.systemId);
          }
        }
      }
      for (const key of Object.keys(customerSystemIds)) customerSystemIds[key].sort();
    }

    // Merge jobsdb_sync customer→system mappings so customers whose Airtable
    // customer-directory entry has an empty system_ids field (e.g. Wyandot Snacks)
    // still get their correct per-customer system ID list.
    try {
      const jobsdbMappings = await fetchAllJobsdbCustomerMappings();
      for (const [customer, sysIds] of Object.entries(jobsdbMappings)) {
        if (!customerSystemIds[customer]) customerSystemIds[customer] = [];
        for (const sysId of sysIds) {
          if (!customerSystemIds[customer].includes(sysId)) {
            customerSystemIds[customer].push(sysId);
          }
        }
        customerSystemIds[customer].sort();
      }

    } catch (err: any) {
      console.error("Failed to merge jobsdb customer mappings:", err.message || err);
    }

    // Customer names: prefer directory (authoritative), supplement with ticket history
    const directoryNames = directoryEntries.map(e => e.name);
    const ticketCustomers = unique(allTickets.map(t => t.customerName));
    const customers = directoryNames.length > 0
      ? [...new Set([...directoryNames, ...ticketCustomers])].sort()
      : ticketCustomers;

    let customerContacts: Record<string, { name: string; email: string | null; phone: string | null }[]> = {};
    try {
      customerContacts = await fetchCustomerContacts();
    } catch (err: any) {
      console.error("Failed to fetch customer contacts:", err.message || err);
    }

    let systemMeta: Record<string, { alias?: string; region?: string; vendor?: string }> = {};
    try {
      systemMeta = await fetchSystemMeta();
    } catch (err: any) {
      console.error("Failed to fetch system meta:", err.message || err);
    }

    // System IDs: directory + tickets + ALL FJD-known system IDs (covers systems not yet in
    // the customer directory, e.g. customers whose system_ids field is empty in Airtable).
    const directorySystemIds = directoryEntries.flatMap(e => e.systemIds);
    const ticketSystemIds = allTickets.map(t => t.systemId);
    const metaSystemIds = Object.keys(systemMeta);
    const systemIds = [...new Set([...directorySystemIds, ...ticketSystemIds, ...metaSystemIds].filter(Boolean))].sort() as string[];

    // Filter out system IDs with FJD status > 6 (closed/terminated) from the
    // GLOBAL all-systems list only. Per-customer lists are intentionally NOT
    // filtered so that a customer's systems always show when that customer is
    // selected — even if the associated FJD job is closed.
    const closedIds = getClosedFjdIds();
    const isActiveSystemId = (id: string) => !closedIds.has(id);
    const activeSystemIds = closedIds.size > 0 ? systemIds.filter(isActiveSystemId) : systemIds;

    const canonicalPriorityLabels = [
      "FO: P1: Down", "FO: P2: Degraded/Impacted", "FO: P3: Adjust/Repair",
      "FO: P4: Improvement", "FO: P4: Monitor", "FO: P4: Parts", "FO: P4: Recipe",
      "AT: P1: Down", "AT: P2: Degraded/Impacted", "AT: P3: Adjust/Repair", "AT: P4: Improvement",
      "CS: P1: Down", "CS: P2: Degraded/Impacted", "CS: P3: Adjust/Repair", "CS: P4: Comms",
      "DL: P1: Down", "DL: P2: Degraded/Impacted", "DL: P3: Adjust/Repair",
      "DL: P4: Customer", "DL: P4: Install", "DL: P4: Monitor", "DL: P4: Software",
      "PD: P1: Down", "PD: P2: Degraded/Impacted", "PD: P3: Adjust/Repair", "PD: P4: Improvement",
    ];
    const existingLabels = unique(allTickets.map(t => t.priorityLabel)).filter(
      l => l && !canonicalPriorityLabels.includes(l)
    );
    const priorityLabels = [...canonicalPriorityLabels, ...existingLabels];

    // Merge ticket-based assignees with the full Slack workspace roster so that
    // people who haven't been assigned a ticket yet still appear in the dropdown.
    const slackMembers = await getSlackMembers();
    const slackMemberNames = slackMembers.map(m => m.name);
    const ticketAssignees = unique(allTickets.map(t => t.assigneeName));
    const assignees = unique([...ticketAssignees, ...slackMemberNames]).sort();

    res.json({
      customers,
      systemIds: activeSystemIds,
      customerSystemIds,
      systemMeta,
      assignees,
      priorityLabels,
      regions: unique(allTickets.map(t => t.region)),
      customerContacts,
    });
  });

  // Fetch ASA number for a given Formic System ID from Airtable jobsdb_sync
  app.get("/api/system-asa/:systemId", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { systemId } = req.params;
      const decoded = decodeURIComponent(systemId);
      const asa = await getAsaNumberForSystem(decoded);
      res.json({ asa: asa || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch ASA" });
    }
  });

  // Update system alias / region in jobsdb_sync and record history on the ticket
  app.patch("/api/system-meta/:systemId", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { systemId } = req.params;
      const { alias, ticketId } = req.body;
      if (alias === undefined) {
        return res.status(400).json({ message: "No fields to update" });
      }
      const userName = await resolveUserDisplayName(req.user);
      const updateFields: { system_alias?: string } = {};
      if (alias !== undefined) updateFields.system_alias = alias;
      await updateJobsDbSync(systemId, updateFields);

      // Add history entry to ticket if provided
      if (ticketId) {
        const ticketNum = parseInt(ticketId, 10);
        if (!isNaN(ticketNum)) {
          const ticket = await storage.getTicket(ticketNum);
          if (ticket) {
            const history = [...(ticket.nextStepsHistory || [])];
            const now = new Date().toISOString();
            if (alias !== undefined) {
              history.push({ text: `System alias set to "${alias || "(cleared)"}"`, updatedBy: userName, updatedAt: now });
              await storage.updateTicket(ticketNum, { nextStepsHistory: history });
            }
          }
        }
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[routes] updateSystemMeta error:", err.message);
      res.status(500).json({ message: err.message || "Failed to update system meta" });
    }
  });

  // Check-in: returns unique customer → {systemId, csChannel, region} map
  app.get("/api/check-in/sites", isAuthenticated, requireFormicEmail, async (req, res) => {
    const map: Record<string, { systemId: string; csChannel: string | null; region: string | null }[]> = {};

    // 1. Seed from tickets — they carry csChannel and region
    const allTickets = await storage.getTickets();
    for (const t of allTickets) {
      if (!t.customerName || !t.systemId) continue;
      if (!map[t.customerName]) map[t.customerName] = [];
      if (!map[t.customerName].find(s => s.systemId === t.systemId)) {
        map[t.customerName].push({ systemId: t.systemId, csChannel: t.csChannel || null, region: t.region || null });
      }
    }

    // 2. Supplement with the full Airtable customer directory (customers without tickets are invisible otherwise)
    const airtableCustomers = await fetchAllJobsdbCustomerMappings().catch(() => ({}));
    for (const [customerName, systemIds] of Object.entries(airtableCustomers)) {
      if (!map[customerName]) map[customerName] = [];
      for (const sysId of systemIds) {
        if (!map[customerName].find(s => s.systemId === sysId)) {
          // Look up csChannel from the site cache if available
          const csChannel = await getSiteChannelForSystemId(sysId).catch(() => null);
          map[customerName].push({ systemId: sysId, csChannel, region: null });
        }
      }
    }

    for (const k of Object.keys(map)) map[k].sort((a, b) => a.systemId.localeCompare(b.systemId));
    res.json(map);
  });

  // Check-in: send Slack notification to site channel + announcements channel
  const CHECK_IN_ANNOUNCE_CHANNEL = "C052YC9BLGJ";
  app.post("/api/check-in", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const { visitorName, customerName, systemId, notes, csChannel, region, targetTicketIds, isOfficeWork } = req.body;
    if (!visitorName) {
      return res.status(400).json({ message: "visitorName is required" });
    }
    if (!isOfficeWork && (!customerName || !systemId)) {
      return res.status(400).json({ message: "customerName and systemId are required for site/remote check-ins" });
    }
    const targetIds: number[] = Array.isArray(targetTicketIds) ? targetTicketIds.map(Number).filter(Boolean) : [];
    try {
      // Server-side validation: ensure the systemId belongs to the customerName
      if (!isOfficeWork && systemId && systemId !== "N/A" && customerName) {
        const allTickets = await storage.getTickets();
        const customerSystems = new Set(
          allTickets
            .filter(t => t.customerName === customerName && t.systemId)
            .map(t => t.systemId as string)
        );
        if (customerSystems.size > 0 && !customerSystems.has(systemId)) {
          return res.status(400).json({
            message: `System ID "${systemId}" does not belong to customer "${customerName}". Valid systems: ${[...customerSystems].join(", ")}`
          });
        }
      }

      const slack = await getUncachableSlackClient();

      // Resolve visitor's Slack mention — prefer email-based lookup (most reliable),
      // then fall back to full-name lookup, then use the raw visitorName as plain text.
      const userEmail: string | undefined = req.user?.claims?.email;
      let visitorMention: string = visitorName;
      if (userEmail) {
        const idByEmail = await lookupSlackUserIdByEmail(userEmail);
        if (idByEmail) {
          visitorMention = `<@${idByEmail}>`;
        } else {
          visitorMention = await mentionName(visitorName);
        }
      } else {
        visitorMention = await mentionName(visitorName);
      }

      // ── Office Work — short message, no ticket linking ──────────────────
      if (isOfficeWork) {
        // "In office (ORD)" → "the ORD office", else use customerName or fallback
        const officeMatch = customerName?.match(/In office \((\w+)\)/i);
        const officeLabel = officeMatch ? `the ${officeMatch[1]} office` : customerName || "the office";
        const text = [
          `:office: *Office Check-In*`,
          `${visitorMention} is working from ${officeLabel} today.`,
          notes ? `*Notes:* ${notes}` : null,
        ].filter(Boolean).join("\n");

        const results: { channel: string; ok: boolean }[] = [];
        try {
          await slack.chat.postMessage({ channel: CHECK_IN_ANNOUNCE_CHANNEL, text, unfurl_links: false, unfurl_media: false });
          results.push({ channel: CHECK_IN_ANNOUNCE_CHANNEL, ok: true });
        } catch (err: any) {
          console.error(`Office check-in Slack post failed:`, err.data?.error || err.message);
          results.push({ channel: CHECK_IN_ANNOUNCE_CHANNEL, ok: false });
        }
        return res.json({ success: true, results, ticketsUpdated: 0, threadRepliesSent: 0 });
      }

      // ── Site Visit / Remote Support ──────────────────────────────────────
      // Build clickable ticket links for any open tickets on this system
      const appDomain = process.env.REPLIT_DOMAINS;
      const allTickets = await storage.getTickets();
      const openAtLocation = allTickets.filter(
        t => t.customerName === customerName && t.status === "open"
      );

      // Build ticket lines grouped by system ID so each system's tickets appear together.
      const bySystem = new Map<string, typeof openAtLocation>();
      for (const t of openAtLocation) {
        const sid = t.systemId || "Unknown";
        if (!bySystem.has(sid)) bySystem.set(sid, []);
        bySystem.get(sid)!.push(t);
      }
      const ticketLines: string[] = [];
      for (const [sid, tickets] of bySystem) {
        const links = tickets.map(t => {
          const ref = t.ticketNumber || `#${t.id}`;
          return appDomain ? `<https://${appDomain}/?ticket=${t.id}|${ref}>` : ref;
        }).join(", ");
        ticketLines.push(`${sid}: ${links}`);
      }
      const ticketBlock = ticketLines.join("   ");

      // Channel mention (e.g. <#C0XXXXXXXX> renders as a clickable #channel-name in Slack)
      const channelId = csChannel ? csChannel.replace(/^#/, "") : null;
      const channelMention = channelId ? `<#${channelId}>` : null;

      const text = [
        `:wave: *Site Visit Check-In*`,
        `${visitorMention} is visiting *${customerName}* today.`,
        channelMention ? `*Channel:* ${channelMention}` : null,
        systemId !== "N/A" ? `*System:* ${buildSystemIdLabel(systemId)}` : null,
        ticketBlock ? `*Open Tickets at this location:*\n${ticketBlock}` : null,
        notes ? `*Notes:* ${notes}` : null,
      ].filter(Boolean).join("\n");

      const channels: string[] = [CHECK_IN_ANNOUNCE_CHANNEL];
      if (csChannel && csChannel !== CHECK_IN_ANNOUNCE_CHANNEL) channels.unshift(csChannel);

      const results: { channel: string; ok: boolean }[] = [];
      for (const channel of channels) {
        try {
          await slack.chat.postMessage({ channel, text, unfurl_links: false, unfurl_media: false });
          results.push({ channel, ok: true });
        } catch (err: any) {
          console.error(`Check-in Slack post failed for channel ${channel}:`, err.data?.error || err.message);
          results.push({ channel, ok: false });
        }
      }

      // Add history entry to ALL open tickets at this customer location (not just same system)
      const generalNote = [`🏭 Site visit: ${visitorName} checked in at ${customerName} — ${systemId}`, notes || null].filter(Boolean).join(" | ");
      const targetedNote = [`🏭 Site visit directed here: ${visitorName} is onsite at ${customerName} — ${systemId}`, notes || null].filter(Boolean).join(" | ");

      let threadRepliesSent = 0;
      await Promise.all(
        openAtLocation.map(async t => {
          const isTarget = targetIds.includes(t.id);
          const histText = isTarget ? targetedNote : generalNote;

          await storage.updateTicket(t.id, {
            nextStepsHistory: [
              ...(t.nextStepsHistory || []),
              { text: histText, updatedBy: visitorName, updatedAt: new Date().toISOString() },
            ],
          });

          // For targeted tickets, also reply to the Slack thread
          if (isTarget && t.slackMessageId && t.csChannel) {
            const threadText = [
              `:construction_worker: *Onsite Visit*`,
              `${visitorMention} is onsite for this ticket.`,
              notes ? `*Notes:* ${notes}` : null,
            ].filter(Boolean).join("\n");
            try {
              await slack.chat.postMessage({
                channel: t.csChannel,
                thread_ts: t.slackMessageId,
                text: threadText,
                unfurl_links: false,
                unfurl_media: false,
              });
              threadRepliesSent++;
            } catch (slackErr: any) {
              console.error(`Check-in thread reply failed for ticket ${t.id}:`, slackErr.data?.error || slackErr.message);
            }
          }
        })
      );

      res.json({ success: true, results, ticketsUpdated: openAtLocation.length, threadRepliesSent });
    } catch (err: any) {
      console.error("Check-in failed:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to send check-in" });
    }
  });

  // Open tickets for a given system ID (used in check-in dialog)
  app.get("/api/check-in/open-tickets", isAuthenticated, requireFormicEmail, async (req, res) => {
    const { systemId } = req.query as { systemId?: string };
    if (!systemId) return res.json([]);
    const all = await storage.getTickets();
    const open = all
      .filter(t => t.systemId === systemId && t.status === "open")
      .map(t => ({ id: t.id, ticketNumber: t.ticketNumber, title: t.title, priority: t.priority, priorityLabel: t.priorityLabel, assigneeName: t.assigneeName, slackMessageId: t.slackMessageId }));
    res.json(open);
  });

  // Check-in note templates
  app.get("/api/check-in/templates", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const templates = await storage.getCheckInTemplates(userId);
    res.json(templates);
  });

  app.post("/api/check-in/templates", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const userName = await resolveUserDisplayName(req.user);
    const { name, content, isGlobal } = req.body;
    if (!name?.trim() || !content?.trim()) {
      return res.status(400).json({ message: "name and content are required" });
    }
    const template = await storage.createCheckInTemplate({
      userId, userName, name: name.trim(), content: content.trim(), isGlobal: !!isGlobal,
    });
    res.json(template);
  });

  app.delete("/api/check-in/templates/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const id = parseInt(req.params.id);
    const ok = await storage.deleteCheckInTemplate(id, userId);
    if (!ok) return res.status(403).json({ message: "Not found or not authorized" });
    res.json({ success: true });
  });

  app.get(api.tickets.get.path, isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const id = parseInt(req.params.id as string);
    const ticket = await storage.getTicket(id);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    res.json(ticket);
  });

  app.delete("/api/tickets/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ticket ID" });
    const ticket = await storage.getTicket(id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    if (ticket.airtableRecordId) {
      return res.status(400).json({ message: "Cannot delete a ticket that is synced with Airtable" });
    }
    try {
      await db.execute(sql`DELETE FROM ticket_notes WHERE ticket_id = ${id}`);
      await db.execute(sql`DELETE FROM tickets WHERE id = ${id}`);
      console.log(`Deleted ticket id=${id}: ${ticket.title} (by ${(req as any).user?.email})`);
      res.json({ deleted: true, id, title: ticket.title });
    } catch (err: any) {
      console.error("Delete ticket error:", err.message || err);
      res.status(500).json({ message: err.message || "Delete failed" });
    }
  });

  app.post("/api/tickets/:id/upload-to-slack", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) return res.status(400).json({ message: "Invalid ticket ID" });
      const ticket = await storage.getTicket(ticketId);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      const { filename, data: base64Data, comment, mimeType } = req.body;
      if (!filename || !base64Data) return res.status(400).json({ message: "filename and data are required" });

      const buffer = Buffer.from(base64Data, "base64");
      const channelId = ticket.csChannel?.replace(/^#/, "") || "C09AUU81X9P";
      const threadTs = ticket.slackMessageId || undefined;

      const slackClient = await getUncachableSlackClient();
      const uploadArgs: any = {
        channel_id: channelId,
        file: buffer,
        filename,
        content_type: mimeType || "application/octet-stream",
      };
      if (threadTs) uploadArgs.thread_ts = threadTs;
      if (comment) uploadArgs.initial_comment = comment;
      console.log(`[upload] Uploading ${filename} (${mimeType}) to channel ${channelId} thread ${threadTs || "none"}`);
      const result = await slackClient.filesUploadV2(uploadArgs);

      const uploadedFile = (result as any).files?.[0];
      const permalink = uploadedFile?.permalink || "";
      const name = uploadedFile?.name || filename;
      console.log(`[upload] Success: ${name} → ${permalink}`);

      res.json({ permalink, name });
    } catch (err: any) {
      console.error("upload-to-slack error:", err.message || err);
      res.status(500).json({ message: err.message || "Upload failed" });
    }
  });

  app.post("/api/contacts", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { firstName, lastName, email, phone, customerName } = req.body;
      if (!firstName || !lastName || !customerName) {
        return res.status(400).json({ message: "firstName, lastName, and customerName are required" });
      }
      const contact = await createAirtableContact({ firstName, lastName, email, phone, customerName });
      res.json(contact);
    } catch (err: any) {
      console.error("Failed to create contact:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to create contact" });
    }
  });

  app.get("/api/contacts/duplicates", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const groups = await fetchContactDuplicates();
      res.json(groups);
    } catch (err: any) {
      console.error("Failed to fetch contact duplicates:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to fetch duplicates" });
    }
  });

  app.delete("/api/contacts/:recordId", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { recordId } = req.params;
      await deleteAirtableContact(recordId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Failed to delete contact:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to delete contact" });
    }
  });

  app.get("/api/contacts/all", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const contacts = await fetchAllContactsWithCustomer();
      res.json(contacts);
    } catch (err: any) {
      console.error("Failed to fetch all contacts:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to fetch contacts" });
    }
  });

  app.patch("/api/contacts/:recordId", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { recordId } = req.params;
      const { firstName, lastName, email, phone } = req.body;
      await updateAirtableContactRecord(recordId, { firstName, lastName, email, phone });
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Failed to update contact:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to update contact" });
    }
  });

  app.post(api.tickets.create.path, isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      if (req.body.estimatedNextUpdate && typeof req.body.estimatedNextUpdate === 'string') {
        req.body.estimatedNextUpdate = new Date(req.body.estimatedNextUpdate);
      }
      if (req.body.submittedAt && typeof req.body.submittedAt === 'string') {
        req.body.submittedAt = new Date(req.body.submittedAt);
      }
      const input = api.tickets.create.input.parse(req.body);

      const INTERNAL_ONLY_CUSTOMER = "Internal Only";
      const requiredFields: { field: string; label: string; value: any }[] = [
        { field: "customerName", label: "Customer", value: input.customerName },
        { field: "systemId", label: "System ID", value: input.customerName === INTERNAL_ONLY_CUSTOMER ? "skip" : input.systemId },
        { field: "contactName", label: "Contact Name", value: input.contactName },
        { field: "description", label: "Description", value: input.description },
        { field: "priorityLabel", label: "Priority", value: input.priorityLabel },
        { field: "commsDirection", label: "Comms Direction", value: input.commsDirection },
        { field: "escalationSource", label: "Escalation Source", value: input.escalationSource },
      ];
      const missing = requiredFields.filter(f => !f.value || (typeof f.value === "string" && !f.value.trim()));
      if (missing.length > 0) {
        return res.status(400).json({
          message: `Missing required fields: ${missing.map(f => f.label).join(", ")}`,
          field: missing[0].field,
        });
      }

      if (input.customerName && !input.csChannel) {
        const allTickets = await storage.getTickets();
        let match = null;
        // For multi-site customers, use region from the system to pick the right site's channel
        if (input.systemId) {
          const sysRegion = await fetchSystemRegion(input.systemId);
          if (sysRegion) {
            match = allTickets.find(t =>
              t.customerName === input.customerName &&
              t.csChannel &&
              t.region === sysRegion &&
              t.systemId !== input.systemId // avoid circular: prefer other systems in same region
            ) ?? allTickets.find(t =>
              t.customerName === input.customerName &&
              t.csChannel &&
              t.region === sysRegion
            );
          }
        }
        // Fallback: match by system site prefix (e.g. VENUSPS2_SYS4 → other VENUSPS2_SYSn tickets)
        // This handles multi-site customers where region lookup failed but systemId prefix identifies the site
        if (!match && input.systemId) {
          const sitePrefix = input.systemId.replace(/_SYS\d+$/i, "");
          if (sitePrefix !== input.systemId) {
            match = allTickets.find(t =>
              t.customerName === input.customerName &&
              t.csChannel &&
              t.systemId &&
              t.systemId.replace(/_SYS\d+$/i, "") === sitePrefix &&
              t.systemId !== input.systemId
            );
          }
        }
        // Last resort: any ticket for this customer with a channel
        if (!match) {
          match = allTickets.find(t => t.customerName === input.customerName && t.csChannel);
        }
        if (match) {
          input.csChannel = match.csChannel;
          if (!input.contactEmail && match.contactEmail) input.contactEmail = match.contactEmail;
          if (!input.contactPhone && match.contactPhone) input.contactPhone = match.contactPhone;
        }
      }

      const submitterName = await resolveUserDisplayName(req.user);

      input.nextStepsHistory = [{
        text: "Ticket created",
        updatedBy: submitterName,
        updatedAt: new Date().toISOString(),
      }];
      if (submitterName) input.submittedBy = submitterName;

      let ticket = await storage.createTicket(input);

      // Record initial priority history
      openPriorityHistory(ticket.id, ticket.priorityLabel, ticket.submittedAt ?? ticket.createdAt ?? new Date()).catch(() => {});

      const updates: Record<string, any> = {};

      if (!ticket.title?.trim()) {
        try {
          const aiTitle = await generateTitleSummary(ticket.description);
          if (aiTitle) updates.title = aiTitle;
        } catch (titleErr: any) {
          console.error("AI title generation failed:", titleErr.message || titleErr);
        }
      }

      const airtableFields: Record<string, any> = {
        description: ticket.description,
      };
      if (ticket.priorityLabel) airtableFields.priority = ticket.priorityLabel;
      if (ticket.assigneeName) airtableFields.assignee_name = ticket.assigneeName;
      if (submitterName) airtableFields.submitter_name = submitterName;
      if (ticket.commsDirection) airtableFields.comms_direction = ticket.commsDirection;
      if (ticket.escalationSource) {
        const receiptMethodMap: Record<string, string> = {
          "Phone Call": "Support Phone Line (RingCentral)",
          "Email": "Support Email (support@formic.co)",
          "Slack": "Other",
          "In Person": "Other",
          "Monitoring Alert": "Other",
          "Other": "Other",
        };
        airtableFields.receipt_method = receiptMethodMap[ticket.escalationSource] || ticket.escalationSource;
      }

      if (ticket.customerName) {
        try {
          const custRecordId = await getCustomerRecordId(ticket.customerName);
          if (custRecordId) {
            airtableFields.customer = [custRecordId];
            try {
              const siteRecordId = await getSiteRecordId(custRecordId, ticket.systemId, ticket.csChannel);
              if (siteRecordId) {
                airtableFields.site = [siteRecordId];
              }
            } catch {}
          }
        } catch (err: any) {
          console.error("Failed to resolve customer record ID:", err.message || err);
        }
      }

      if (ticket.systemId) {
        try {
          const asaRecordId = await getAsaRecordId(ticket.systemId);
          if (asaRecordId) airtableFields.asa = [asaRecordId];
        } catch (e: any) { console.error("[ASA] getAsaRecordId failed:", e.message); }
      }

      if (ticket.contactName) {
        try {
          const contactRecordId = await getContactRecordId(ticket.contactName);
          if (contactRecordId) {
            airtableFields.contact = [contactRecordId];
          }
        } catch (err: any) {
          console.error("Failed to resolve contact record ID:", err.message || err);
        }
      }

      let resolvedAssigneeSlackId: string | null = null;
      let resolvedSubmitterSlackId: string | null = null;
      let resolvedNotifySlackIds: string[] = [];
      try {
        const userEmail = req.user?.claims?.email;
        const notifyNames = ticket.notifyNames || [];
        const slackLookups = await Promise.allSettled([
          ticket.assigneeName ? lookupSlackUserId(ticket.assigneeName) : Promise.resolve(null),
          submitterName ? lookupSlackUserId(submitterName) : Promise.resolve(null),
          userEmail ? lookupSlackUserIdByEmail(userEmail) : Promise.resolve(null),
          ...notifyNames.map((n: string) => lookupSlackUserId(n)),
        ]);
        let assigneeSlackId = slackLookups[0].status === 'fulfilled' ? slackLookups[0].value : null;
        const submitterSlackIdByName = slackLookups[1].status === 'fulfilled' ? slackLookups[1].value : null;
        const submitterSlackIdByEmail = slackLookups[2].status === 'fulfilled' ? slackLookups[2].value : null;
        const submitterSlackId = submitterSlackIdByName || submitterSlackIdByEmail;

        resolvedNotifySlackIds = notifyNames
          .map((_: string, i: number) => slackLookups[3 + i])
          .filter((r: PromiseSettledResult<string | null>) => r.status === 'fulfilled' && r.value)
          .map((r: PromiseSettledResult<string | null>) => (r as PromiseFulfilledResult<string | null>).value as string);

        if (!assigneeSlackId && ticket.assigneeName === submitterName && submitterSlackId) {
          assigneeSlackId = submitterSlackId;
        }

        if (assigneeSlackId) {
          airtableFields.assignee = assigneeSlackId;
          airtableFields.notify = assigneeSlackId;
        }
        if (submitterSlackId) airtableFields.submitter = submitterSlackId;

        resolvedAssigneeSlackId = assigneeSlackId || null;
        resolvedSubmitterSlackId = submitterSlackId || null;
      } catch (err: any) {
        console.error("Failed to resolve Slack user IDs:", err.message || err);
      }

      try {
        let record: any;
        try {
          record = await createAirtableRecord(airtableFields);
        } catch (firstErr: any) {
          // Retry without priority in case the field is read-only/formula
          if (airtableFields.priority) {
            console.warn("Airtable create failed with priority field, retrying without it:", firstErr.message || firstErr);
            const { priority: _p, ...fieldsWithoutPriority } = airtableFields;
            record = await createAirtableRecord(fieldsWithoutPriority);
          } else {
            throw firstErr;
          }
        }
        const mapped = mapAirtableToTicket(record);
        updates.airtableRecordId = record.id;
        if (mapped.ticketNumber) updates.ticketNumber = mapped.ticketNumber;
        if (mapped.csChannel) updates.csChannel = mapped.csChannel;
        if (mapped.customerName && !ticket.customerName) updates.customerName = mapped.customerName;
        if (mapped.contactName && !ticket.contactName) updates.contactName = mapped.contactName;
        if (mapped.contactEmail) updates.contactEmail = mapped.contactEmail;
        if (mapped.contactPhone) updates.contactPhone = mapped.contactPhone;
        if (mapped.systemId && !ticket.systemId) updates.systemId = mapped.systemId;

        try {
          await updateAirtableRecord(record.id, { record_id_slack: record.id });
        } catch {}
      } catch (err: any) {
        console.error("Failed to create Airtable record:", err.message || err);
      }

      if (Object.keys(updates).length > 0) {
        const updated = await storage.updateTicket(ticket.id, updates);
        if (updated) ticket = updated;
      }

      try {
        if (ticket.csChannel) {
          const dupCheck = await checkSlackDuplicate(ticket);
          if (dupCheck.skip) {
            if (dupCheck.existingThreadId) {
              await storage.updateTicket(ticket.id, { slackMessageId: dupCheck.existingThreadId });
              ticket = { ...ticket, slackMessageId: dupCheck.existingThreadId };
            }
          } else {
            const slackResult = await postTicketToSlack(ticket, submitterName, resolvedAssigneeSlackId, resolvedSubmitterSlackId, resolvedNotifySlackIds);
            if (slackResult) {
              const { ts: slackTs, channel: usedChannel } = slackResult;
              const channelId = usedChannel.replace(/^#/, "");
              const slackPermalink = `https://formic.slack.com/archives/${channelId}/p${slackTs.replace(".", "")}`;
              const historyEntry = {
                text: `Slack notification sent to #${channelId} — ${slackPermalink}`,
                updatedBy: submitterName || "Unknown",
                updatedAt: new Date().toISOString(),
              };
              const currentHistory = ticket.nextStepsHistory || [];
              await storage.updateTicket(ticket.id, {
                slackMessageId: slackTs,
                csChannel: usedChannel,
                nextStepsHistory: [...currentHistory, historyEntry],
              });
              ticket = { ...ticket, slackMessageId: slackTs, csChannel: usedChannel, nextStepsHistory: [...currentHistory, historyEntry] };
              // DM the assignee with the ticket details
              if (resolvedAssigneeSlackId) {
                postAssigneeDm(ticket, resolvedAssigneeSlackId, slackPermalink).catch(() => {});
              }
            } else if (resolvedAssigneeSlackId) {
              // Channel post failed/skipped but we still DM the assignee
              postAssigneeDm(ticket, resolvedAssigneeSlackId, null).catch(() => {});
            }
          }
        }
      } catch (slackErr: any) {
        console.error("Slack post failed:", slackErr.message || slackErr);
      }

      res.status(201).json(ticket);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.patch(api.tickets.update.path, isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (req.body.estimatedNextUpdate && typeof req.body.estimatedNextUpdate === 'string') {
        req.body.estimatedNextUpdate = new Date(req.body.estimatedNextUpdate);
      }
      if (req.body.submittedAt && typeof req.body.submittedAt === 'string') {
        req.body.submittedAt = new Date(req.body.submittedAt);
      }
      const input = api.tickets.update.input.parse(req.body);

      const existingTicket = await storage.getTicket(id);
      let oldHistoryLength = 0;
      if (input.status === "closed" && existingTicket?.status !== "closed") {
        input.resolvedAt = new Date();
      }

      if (input.status === "open" && existingTicket?.status === "closed") {
        input.resolution = null;
        input.resolvedAt = null;
      }

      let assigneeChangedTo: string | null = null;

      if (existingTicket) {
        const userName = await resolveUserDisplayName(req.user);
        oldHistoryLength = (existingTicket.nextStepsHistory || []).length;
        const history = [...(existingTicket.nextStepsHistory || [])];
        const now = new Date().toISOString();

        if (input.assigneeName !== undefined && input.assigneeName !== existingTicket.assigneeName) {
          const from = existingTicket.assigneeName || "unassigned";
          const to = input.assigneeName || "unassigned";
          const dmNote = input.assigneeName ? ` — Slack DM sent to ${to}` : "";
          history.push({ text: `Assignee changed from "${from}" to "${to}"${dmNote}`, updatedBy: userName, updatedAt: now });
          if (input.assigneeName) assigneeChangedTo = input.assigneeName;
        }

        if (input.priorityLabel !== undefined && input.priorityLabel !== existingTicket.priorityLabel) {
          if (!input.priorityLabel) {
            history.push({ text: `Priority cleared`, updatedBy: userName, updatedAt: now });
          } else if (!existingTicket.priorityLabel) {
            history.push({ text: `Priority set to "${input.priorityLabel}"`, updatedBy: userName, updatedAt: now });
          } else {
            history.push({ text: `Priority changed from "${existingTicket.priorityLabel}" to "${input.priorityLabel}"`, updatedBy: userName, updatedAt: now });
          }
          // Only rotate if ticket is open; closing is handled in status block
          if (existingTicket.status !== "closed") {
            rotatePriorityHistory(id, input.priorityLabel, new Date()).catch(() => {});
          }
        }

        if (input.status !== undefined && input.status !== existingTicket.status) {
          if (input.status === "closed") {
            history.push({ text: `Ticket closed`, updatedBy: userName, updatedAt: now });
            closePriorityHistory(id, new Date()).catch(() => {});
          } else if (input.status === "open" && existingTicket.status === "closed") {
            history.push({ text: `Ticket reopened`, updatedBy: userName, updatedAt: now });
            // Re-open history with current priority (use incoming or existing)
            const currentPriority = input.priorityLabel !== undefined ? input.priorityLabel : existingTicket.priorityLabel;
            openPriorityHistory(id, currentPriority, new Date()).catch(() => {});
          } else {
            history.push({ text: `Status changed from "${existingTicket.status}" to "${input.status}"`, updatedBy: userName, updatedAt: now });
          }
        }

        if (input.customerName !== undefined && input.customerName !== existingTicket.customerName) {
          const from = existingTicket.customerName || "none";
          const to = input.customerName || "none";
          history.push({ text: `Customer changed from "${from}" to "${to}"`, updatedBy: userName, updatedAt: now });
        }

        if (input.nextSteps !== undefined && input.nextSteps && input.nextSteps !== existingTicket.nextSteps) {
          history.push({ text: input.nextSteps, updatedBy: userName, updatedAt: now });
        }

        // Bucket changes — fetch names for human-readable history
        const issueBucketChanged = input.issueBucketId !== undefined && input.issueBucketId !== existingTicket.issueBucketId;
        const solutionBucketChanged = input.solutionBucketId !== undefined && input.solutionBucketId !== existingTicket.solutionBucketId;
        if (issueBucketChanged || solutionBucketChanged) {
          const [allIssue, allSolution] = await Promise.all([
            storage.getIssueBuckets(),
            storage.getSolutionBuckets(),
          ]);
          if (issueBucketChanged) {
            const fromB = allIssue.find(b => b.id === existingTicket.issueBucketId);
            const toB = allIssue.find(b => b.id === input.issueBucketId);
            const fromName = fromB?.name ?? (existingTicket.issueBucketId ? `Bucket #${existingTicket.issueBucketId}` : "none");
            const toName = toB?.name ?? (input.issueBucketId ? `Bucket #${input.issueBucketId}` : "none");
            history.push({ text: `Issue type changed from "${fromName}" to "${toName}"`, updatedBy: userName, updatedAt: now });
          }
          if (solutionBucketChanged) {
            const fromB = allSolution.find(b => b.id === existingTicket.solutionBucketId);
            const toB = allSolution.find(b => b.id === input.solutionBucketId);
            const fromName = fromB?.name ?? (existingTicket.solutionBucketId ? `Bucket #${existingTicket.solutionBucketId}` : "none");
            const toName = toB?.name ?? (input.solutionBucketId ? `Bucket #${input.solutionBucketId}` : "none");
            history.push({ text: `Solution type changed from "${fromName}" to "${toName}"`, updatedBy: userName, updatedAt: now });
          }
        }

        if (history.length > (existingTicket.nextStepsHistory?.length ?? 0)) {
          input.nextStepsHistory = history;
        }
      }

      const ticket = await storage.updateTicket(id, input);
      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }

      // Increment bucket usage counts when a ticket is closed with bucket IDs
      if (input.status === "closed" && existingTicket?.status !== "closed") {
        if (input.issueBucketId) {
          storage.incrementIssueBucketCount(input.issueBucketId).catch(() => {});
        }
        if (input.solutionBucketId) {
          storage.incrementSolutionBucketCount(input.solutionBucketId).catch(() => {});
        }
      }

      if (ticket.airtableRecordId) {
        const airtableFields: Record<string, any> = {};
        if (ticket.description) {
          airtableFields.description = ticket.description;
        }
        if (ticket.assigneeName !== undefined) {
          airtableFields.assignee_name = ticket.assigneeName || "";
        }
        if (input.priorityLabel !== undefined) {
          airtableFields.priority = input.priorityLabel || "";
        }
        const customerChanged = input.customerName && input.customerName !== existingTicket?.customerName;
        const systemChanged = input.systemId !== undefined && input.systemId !== existingTicket?.systemId;
        if (customerChanged || systemChanged) {
          try {
            const custName = ticket.customerName || existingTicket?.customerName;
            const custRecordId = custName ? await getCustomerRecordId(custName) : null;
            if (custRecordId) {
              if (customerChanged) airtableFields.customer = [custRecordId];
              try {
                const siteRecordId = await getSiteRecordId(custRecordId, ticket.systemId, ticket.csChannel || existingTicket?.csChannel);
                if (siteRecordId) {
                  airtableFields.site = [siteRecordId];
                }
              } catch {}
            }
          } catch (err: any) {
            console.error("Failed to resolve customer/site record ID for update:", err.message || err);
          }
          if (ticket.systemId) {
            try {
              const asaRecordId = await getAsaRecordId(ticket.systemId);
              if (asaRecordId) airtableFields.asa = [asaRecordId];
            } catch (e: any) { console.error("[ASA] getAsaRecordId failed:", e.message); }
          }
        }
        if (input.commsDirection !== undefined) {
          airtableFields.comms_direction = input.commsDirection || "";
        }
        // region is a computed formula field in Airtable — do not write
        if (ticket.resolution !== undefined) {
          airtableFields.resolution = ticket.resolution || "";
        }
        if (input.status === "closed" && existingTicket?.status !== "closed" && ticket.resolvedAt) {
          const d = ticket.resolvedAt;
          const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
          const day = d.getUTCDate();
          const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
          const hours = d.getUTCHours();
          const minutes = d.getUTCMinutes().toString().padStart(2, "0");
          const ampm = hours >= 12 ? "PM" : "AM";
          const h12 = hours % 12 || 12;
          airtableFields.resolution_time_from_slack = `${months[d.getUTCMonth()]} ${day}${suffix}, ${d.getUTCFullYear()} at ${h12}:${minutes} ${ampm} UTC`;
        }
        if (input.status === "open" && existingTicket?.status === "closed") {
          airtableFields.resolution = "";
          airtableFields.resolution_time_from_slack = null;
        }
        if (Object.keys(airtableFields).length > 0) {
          const userName = await resolveUserDisplayName(req.user);
          try {
            const updatedRecord = await updateAirtableRecord(ticket.airtableRecordId, airtableFields);
            // Verify Airtable actually accepted each field we sent
            const rejectedFields: string[] = [];
            const scalarFields: Record<string, string> = {
              priority: "priority",
              assignee_name: "assignee",
              description: "description",
              comms_direction: "comms direction",
              resolution: "resolution",
            };
            for (const [airtableKey, label] of Object.entries(scalarFields)) {
              if (airtableKey in airtableFields) {
                const sent = String(airtableFields[airtableKey] ?? "").trim();
                const got = String(updatedRecord.fields[airtableKey] ?? "").trim();
                if (sent !== got) {
                  rejectedFields.push(label);
                  console.warn(`[Airtable] Field "${airtableKey}" mismatch — sent: "${sent}", got: "${got}"`);
                }
              }
            }
            if (rejectedFields.length > 0) {
              const failNote = `⚠ Airtable did not accept update for: ${rejectedFields.join(", ")}`;
              const currentHistory = ticket.nextStepsHistory || [];
              await storage.updateTicket(ticket.id, {
                nextStepsHistory: [...currentHistory, { text: failNote, updatedBy: userName, updatedAt: new Date().toISOString() }],
              });
              console.warn(`[Airtable] Wrote sync-failure history entry for ticket ${ticket.id}`);
            }
          } catch (err: any) {
            console.error(`[Airtable] Failed to update record ${ticket.airtableRecordId}:`, err.message || err);
            // Airtable rejected the entire request — log it to ticket history
            const failNote = `⚠ Airtable update failed: ${err.message || "Unknown error"}`;
            const currentHistory = ticket.nextStepsHistory || [];
            await storage.updateTicket(ticket.id, {
              nextStepsHistory: [...currentHistory, { text: failNote, updatedBy: userName, updatedAt: new Date().toISOString() }],
            });
          }
        }
      }

      // Post Slack thread reply for significant changes.
      // Use existingTicket.status (not ticket.status) so that closing a ticket also fires the reply.
      if (existingTicket && ticket.slackMessageId && ticket.csChannel && existingTicket.status !== "closed") {
        const currentHistory = ticket.nextStepsHistory || [];
        const newEntries = currentHistory.slice(oldHistoryLength).filter(e =>
          !e.text.startsWith("⚠") &&
          !e.text.startsWith("Slack notification sent") &&
          !e.text.includes("(Auto-Generated)")
        );
        if (newEntries.length > 0) {
          const ticketRef = ticket.ticketNumber || `#${ticket.id}`;
          const updaterDisplayName = await resolveUserDisplayName(req.user);
          const updaterEmail = req.user?.claims?.email as string | undefined;

          // Look up updater's Slack ID so we can tag them properly
          let updaterMention = updaterDisplayName;
          try {
            const slackId = updaterEmail
              ? await lookupSlackUserIdByEmail(updaterEmail)
              : updaterDisplayName
              ? await lookupSlackUserId(updaterDisplayName)
              : null;
            if (slackId) updaterMention = `<@${slackId}>`;
          } catch {}

          const bulletLines = newEntries.map(e => `• ${e.text}`).join("\n");

          // If closing, append Final Determination and Final Solution from the resolution field
          let closingDetails = "";
          if (input.status === "closed" && existingTicket?.status !== "closed" && ticket.resolution) {
            const res = ticket.resolution;
            const detMatch = res.match(/Final Determination:\s*([\s\S]*?)(?:\n\nFinal Solution:|$)/i);
            const solMatch = res.match(/Final Solution:\s*([\s\S]*?)$/i);
            const det = detMatch?.[1]?.trim();
            const sol = solMatch?.[1]?.trim();
            if (det) closingDetails += `\n*Final Determination:* ${det}`;
            if (sol) closingDetails += `\n*Final Solution:* ${sol}`;
          }

          const closingPrefix = (input.status === "closed" && existingTicket?.status !== "closed") ? `:white_check_mark: *${ticketRef} closed* by ${updaterMention}` : `:pencil2: *${ticketRef} updated* by ${updaterMention}`;
          const replyText = `${closingPrefix}\n${bulletLines}${closingDetails}`;
          postThreadReply(ticket.csChannel, ticket.slackMessageId, replyText).catch(() => {});
        }
      }

      // Post a thread reply when a closed ticket is reopened
      if (existingTicket && ticket.slackMessageId && ticket.csChannel && existingTicket.status === "closed" && input.status === "open") {
        const ticketRef = ticket.ticketNumber || `#${ticket.id}`;
        const updaterDisplayName = await resolveUserDisplayName(req.user);
        let updaterMention = updaterDisplayName;
        try {
          const updaterEmail = req.user?.claims?.email as string | undefined;
          const slackId = updaterEmail
            ? await lookupSlackUserIdByEmail(updaterEmail)
            : updaterDisplayName
            ? await lookupSlackUserId(updaterDisplayName)
            : null;
          if (slackId) updaterMention = `<@${slackId}>`;
        } catch {}
        const replyText = `:arrows_counterclockwise: *${ticketRef} reopened* by ${updaterMention}`;
        postThreadReply(ticket.csChannel, ticket.slackMessageId, replyText).catch(() => {});
      }

      // Notify the new assignee when the assignment changes: thread @mention + DM
      if (assigneeChangedTo) {
        try {
          const newAssigneeSlackId = await lookupSlackUserId(assigneeChangedTo);
          const slackThreadLink = ticket.slackMessageId && ticket.csChannel
            ? `https://formic.slack.com/archives/${ticket.csChannel.replace(/^#/, "")}/p${ticket.slackMessageId.replace(".", "")}`
            : null;

          if (newAssigneeSlackId) {
            // Tag the new assignee in the Slack thread so they get a notification there
            if (ticket.slackMessageId && ticket.csChannel) {
              const mentionText = `<@${newAssigneeSlackId}> you've been assigned this ticket.`;
              postThreadReply(ticket.csChannel, ticket.slackMessageId, mentionText).catch((e: any) => {
                console.warn(`[Slack] Failed to post assignee mention in thread for ticket ${ticket.id}: ${e?.message}`);
              });
            }
            // Also send a DM so they see it even if they miss the thread
            postAssigneeDm(ticket, newAssigneeSlackId, slackThreadLink).catch((e: any) => {
              console.warn(`[Slack] Failed to DM assignee "${assigneeChangedTo}" for ticket ${ticket.id}: ${e?.message}`);
            });
          } else {
            console.warn(`[Slack] Could not resolve Slack ID for assignee "${assigneeChangedTo}" — skipping DM and thread mention for ticket ${ticket.id}`);
          }
        } catch (err: any) {
          console.warn(`[Slack] Error during assignee notification for ticket ${ticket.id}: ${err?.message}`);
        }
      }

      res.json(ticket);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  let syncInProgress = false;

  app.post(api.tickets.sync.path, isAuthenticated, requireFormicEmail, async (req, res) => {
    if (syncInProgress) {
      return res.json({ message: "Sync already in progress, skipped", imported: 0, updated: 0, deleted: 0, slackChannels: 0, errors: [] });
    }
    syncInProgress = true;
    const results = { imported: 0, updated: 0, deleted: 0, slackChannels: 0, errors: [] as string[] };
    try {

    // First, remove any duplicate rows sharing the same airtable_record_id (keeps oldest by id)
    try {
      const dedupResult = await db.execute(sql`
        DELETE FROM tickets
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY airtable_record_id ORDER BY id ASC) AS rn
            FROM tickets
            WHERE airtable_record_id IS NOT NULL
          ) sub
          WHERE rn > 1
        )
      `);
      const dedupCount = (dedupResult as any).rowCount ?? 0;
      if (dedupCount > 0) {
        console.log(`Sync dedup: removed ${dedupCount} duplicate ticket row(s)`);
        results.deleted += dedupCount;
      }
    } catch (dedupErr: any) {
      console.error("Sync dedup error:", dedupErr.message || dedupErr);
    }

    // Sync from Airtable
    try {
      const records = await fetchAirtableRecords();
      const existingTickets = await storage.getTickets();
      const byAirtableId = new Map(
        existingTickets
          .filter((t) => t.airtableRecordId)
          .map((t) => [t.airtableRecordId, t])
      );
      const byTicketNumber = new Map(
        existingTickets
          .filter((t) => t.ticketNumber)
          .map((t) => [t.ticketNumber, t])
      );

      const items: { mapped: ReturnType<typeof mapAirtableToTicket>; existing?: typeof existingTickets[0] }[] = [];

      for (const record of records) {
        const mapped = mapAirtableToTicket(record);
        let existing = byAirtableId.get(record.id);
        if (!existing && mapped.ticketNumber) {
          existing = byTicketNumber.get(mapped.ticketNumber);
          if (existing) {
            await storage.updateTicket(existing.id, { airtableRecordId: record.id });
            existing = { ...existing, airtableRecordId: record.id };
            byAirtableId.set(record.id, existing);
          }
        }
        // Fallback: catch tickets created in the web app that haven't had their
        // airtableRecordId saved yet (race condition between POST handler and sync).
        // Primary: match tickets with no airtableRecordId yet.
        // Secondary: also catch tickets with a DIFFERENT airtableRecordId (e.g. when the
        // Airtable record was re-created or formula returned null on first sync, giving
        // the DB ticket a stale/different ID while the Slack message was already posted).
        if (!existing && mapped.description && mapped.customerName) {
          const pendingMatch = existingTickets.find(t =>
            t.description === mapped.description &&
            t.customerName === mapped.customerName &&
            (!mapped.systemId || t.systemId === mapped.systemId)
          );
          if (pendingMatch) {
            await storage.updateTicket(pendingMatch.id, { airtableRecordId: record.id });
            existing = { ...pendingMatch, airtableRecordId: record.id };
            byAirtableId.set(record.id, existing);
            if (mapped.ticketNumber) byTicketNumber.set(mapped.ticketNumber, existing);
          }
        }
        items.push({ mapped, existing: existing || undefined });
      }

      const BATCH_SIZE = 10;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const titlePromises = batch.map(item => {
          const isNew = !item.existing;
          const hasPlaceholderTitle = !item.existing?.title ||
            item.existing.title === item.existing?.ticketNumber ||
            item.existing.title === "Untitled";
          const needsNewTitle = isNew || hasPlaceholderTitle;

          if (needsNewTitle && item.mapped.description !== "No description") {
            return generateTitleSummary(item.mapped.description);
          }
          return Promise.resolve(item.existing?.title || item.mapped.title);
        });

        const titles = await Promise.all(titlePromises);

        for (let j = 0; j < batch.length; j++) {
          const { mapped, existing } = batch[j];
          const title = titles[j];

          if (!existing) {
            // Before creating, do a fresh DB lookup in case the ticket was just created
            // via the web UI or Slack modal AFTER the pre-sync snapshot was taken.
            // Check 1: match by ticketNumber (most reliable)
            // Check 2: match by description+customer when ticketNumber not yet set
            {
              const freshCheck = await storage.getTickets();
              let freshMatch = mapped.ticketNumber
                ? freshCheck.find(t => t.ticketNumber === mapped.ticketNumber)
                : null;
              if (!freshMatch && mapped.description && mapped.customerName) {
                freshMatch = freshCheck.find(t =>
                  t.description === mapped.description &&
                  t.customerName === mapped.customerName &&
                  (!mapped.systemId || t.systemId === mapped.systemId)
                ) ?? null;
              }
              if (freshMatch) {
                await storage.updateTicket(freshMatch.id, {
                  airtableRecordId: mapped.airtableRecordId || freshMatch.airtableRecordId || undefined,
                  ticketNumber: mapped.ticketNumber || freshMatch.ticketNumber || undefined,
                  title: freshMatch.title || title,
                });
                console.log(`[Sync] Race-condition guard: merged into existing ticket ${freshMatch.ticketNumber ?? freshMatch.id} (id=${freshMatch.id})`);
                results.updated++;
                continue;
              }
            }

            // Region is a formula field in Airtable and sometimes returns null for
            // multi-site customers. Fall back to the in-memory systemMeta cache
            // (loaded from FJD / jobsdb_sync) so the filter always works.
            const resolvedRegionCreate =
              mapped.region ||
              getSystemMetaEntry(mapped.systemId || "")?.region ||
              null;

            const newTicket = await storage.createTicket({
              ...mapped,
              region: resolvedRegionCreate,
              title,
              nextStepsHistory: [{
                text: "Ticket created",
                updatedBy: "External",
                updatedAt: (mapped.submittedAt ?? new Date()).toISOString(),
              }],
            });
            // Send Slack notification for newly imported tickets.
            //
            // IMPORTANT: Only post from the PRODUCTION deployment.
            // Both the dev server and the production app share the same Slack
            // workspace and Airtable base but have *separate* databases.
            // If the dev sync were allowed to post, every ticket that the
            // production app already notified would get a duplicate message
            // (the dev DB doesn't know about the production slackMessageId).
            //
            // In production, checkSlackDuplicate() guards against:
            //   • ticket created via web app between snapshot and create
            //   • ticket created via Slack modal (no prior dedup)
            //   • same Airtable record imported twice (eventual consistency)
            //
            const isProduction = process.env.NODE_ENV === "production";
            if (!isProduction) {
              console.log(`[Sync] Dev mode: skipping Slack notification for ${newTicket.ticketNumber ?? newTicket.id} (only production posts to Slack from sync)`);
            } else if (newTicket?.csChannel) {
              try {
                  const dupCheck = await checkSlackDuplicate(newTicket);
                  if (dupCheck.skip) {
                    if (dupCheck.existingThreadId) {
                      await storage.updateTicket(newTicket.id, { slackMessageId: dupCheck.existingThreadId });
                      }
                    console.log(`[Sync] Skipped duplicate Slack post for ${newTicket.ticketNumber ?? newTicket.id} — linked to existing thread`);
                  } else {
                    const assigneeSlackId = newTicket.assigneeName ? await lookupSlackUserId(newTicket.assigneeName) : null;
                    const submitterSlackId = assigneeSlackId;
                    const submitterName = newTicket.assigneeName || undefined;
                    const slackResult = await postTicketToSlack(newTicket, submitterName, assigneeSlackId, submitterSlackId);
                    if (slackResult) {
                      const { ts: slackTs, channel: usedChannel } = slackResult;
                      const channelId = usedChannel.replace(/^#/, "");
                      const permalink = `https://formic.slack.com/archives/${channelId}/p${slackTs.replace(".", "")}`;
                      const histEntry = { text: `Slack notification sent to #${channelId} — ${permalink}`, updatedBy: newTicket.assigneeName || "Airtable Sync", updatedAt: new Date().toISOString() };
                      await storage.updateTicket(newTicket.id, {
                        slackMessageId: slackTs,
                        csChannel: usedChannel,
                        nextStepsHistory: [...(newTicket.nextStepsHistory || []), histEntry],
                      });
                    }
                  }
                } catch (slackErr: any) {
                  console.error(`Slack notification failed for ${newTicket.ticketNumber}:`, slackErr.message || slackErr);
                }
            }
            results.imported++;
          } else {
            await storage.updateTicket(existing.id, {
              title,
              description: mapped.description,
              status: mapped.status,
              ticketNumber: mapped.ticketNumber,
              // Only update priority from Airtable if it has a value (priority is a formula field —
              // if Airtable has no computed value, preserve any locally-set priority)
              ...(mapped.priorityLabel ? { priority: mapped.priority, priorityLabel: mapped.priorityLabel } : {}),
              // Assignee is managed locally — never let a stale Airtable sync snapshot
              // overwrite a change the user just made. The initial assignee for NEW
              // tickets comes from mapped.assigneeName (see createTicket below).
              // For existing tickets we skip the field entirely so the DB value is
              // always authoritative, regardless of when the sync snapshot was taken.
              customerName: mapped.customerName,
              contactName: mapped.contactName,
              contactEmail: mapped.contactEmail,
              contactPhone: mapped.contactPhone,
              systemId: mapped.systemId || existing.systemId,
              region:
                mapped.region ||
                existing.region ||
                getSystemMetaEntry(mapped.systemId || existing.systemId || "")?.region ||
                null,
              csChannel: mapped.csChannel,
              commsDirection: mapped.commsDirection || existing.commsDirection,
              escalationSource: mapped.escalationSource || existing.escalationSource,
              resolution: mapped.resolution,
              submittedAt: mapped.submittedAt,
              resolvedAt: mapped.resolvedAt,
            });
            results.updated++;

            const pushFields: Record<string, any> = {};
            if (existing.customerName && !mapped.customerName) {
              try {
                const custRecordId = await getCustomerRecordId(existing.customerName);
                if (custRecordId) {
                  pushFields.customer = [custRecordId];
                  try {
                    const siteRecordId = await getSiteRecordId(custRecordId, existing.systemId, existing.csChannel);
                    if (siteRecordId) pushFields.site = [siteRecordId];
                  } catch {}
                }
              } catch {}
            }
            if (existing.description && !mapped.description) {
              pushFields.description = existing.description;
            }
            if (existing.assigneeName && existing.assigneeName !== mapped.assigneeName) {
              pushFields.assignee_name = existing.assigneeName;
            }
            if (existing.priorityLabel && !mapped.priorityLabel) {
              pushFields.priority = existing.priorityLabel;
            }
            if (existing.commsDirection) {
              pushFields.comms_direction = existing.commsDirection;
            }
            // Note: slack_ts back-population removed — the Airtable base does not have this field
            if (Object.keys(pushFields).length > 0 && existing.airtableRecordId) {
              try {
                await updateAirtableRecord(existing.airtableRecordId, pushFields);
              } catch (pushErr: any) {
                console.error("Failed to push local data to Airtable:", pushErr.message || pushErr);
              }
            }
          }
        }
      }
      const airtableRecordIds = new Set(records.map(r => r.id));
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const ticketsToDelete = existingTickets.filter(
        t =>
          t.airtableRecordId &&
          !airtableRecordIds.has(t.airtableRecordId) &&
          // Never delete tickets that have an active Slack thread — deleting them
          // causes the next sync to re-create the ticket and post a duplicate Slack message.
          !t.slackMessageId &&
          // Skip recently created tickets: Airtable records may not yet appear in the
          // sync snapshot due to eventual consistency (the record just got written).
          t.createdAt && new Date(t.createdAt) < twoHoursAgo
      );
      for (const t of ticketsToDelete) {
        await storage.deleteTicket(t.id);
        results.deleted++;
      }
      if (ticketsToDelete.length > 0) {
        console.log(`Deleted ${ticketsToDelete.length} tickets removed from Airtable`);
      }
    } catch (err: any) {
      console.error("Airtable sync error:", err);
      results.errors.push("Airtable: " + err.message);
    }

    // Verify Slack connectivity using auth.test (works with any scope)
    try {
      const slack = await getUncachableSlackClient();
      const auth = await slack.auth.test();
      results.slackChannels = auth.ok ? 1 : 0;
    } catch (err: any) {
      console.error("Slack connectivity check failed:", err);
      results.errors.push("Slack: " + err.message);
    }

    const message = results.errors.length
      ? `Sync completed with issues: ${results.errors.join("; ")}`
      : `Synced ${results.imported} new + ${results.updated} updated${results.deleted ? ` + ${results.deleted} deleted` : ""} from Airtable. Slack connected.`;

    res.json({ message });
    } finally {
      syncInProgress = false;
    }
  });

  // ── Role Management ────────────────────────────────────────────────────────

  const requireAdmin: RequestHandler = async (req: any, res, next) => {
    const email: string | undefined = req.user?.claims?.email;
    const userId: string | undefined = req.user?.claims?.sub;
    if (!email || !userId) return res.status(401).json({ message: "Unauthorized" });
    const role = await resolveUserRole(userId, email);
    if (role !== "admin") return res.status(403).json({ message: "Admin access required" });
    next();
  };

  app.get("/api/admin/users", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const users = await storage.getAllUsersWithRoles();
      const result = users
        .filter(u => {
          const email = (u.email || "").toLowerCase();
          if (!email.endsWith("@formic.co")) return false;
          const localPart = email.split("@")[0];
          if (localPart.startsWith("test")) return false;
          return true;
        })
        .map(u => ({
          userId: u.id,
          email: u.email || "",
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email || u.id,
          role: u.email === BOOTSTRAP_ADMIN_EMAIL ? "admin" : u.role,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/users/:userId/role", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      const validRoles = ["admin", "manager", "agent", "requester"];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const actorEmail = req.user?.claims?.email || "unknown";
      await storage.setUserRole(userId, role, actorEmail);
      res.json({ userId, role });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Role configuration (names + permissions per role)
  app.get("/api/admin/role-config", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const stored = await storage.getRoleConfigs();
      // Merge built-in defaults (for any built-in role not yet in DB) then append custom roles
      const builtins = ROLE_KEYS.map((key, idx) => {
        const found = stored.find(c => c.role === key);
        return found ?? { role: key, ...DEFAULT_ROLE_CONFIG[key] };
      });
      const customs = stored.filter(c => !BUILTIN_ROLES.has(c.role));
      // Sort everything by hierarchyOrder
      const all = [...builtins, ...customs].sort((a, b) => a.hierarchyOrder - b.hierarchyOrder);
      res.json(all);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/admin/role-config/:role", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { role } = req.params;
      const { displayName, permissions, hierarchyOrder } = req.body as { displayName: string; permissions: RolePermissions; hierarchyOrder?: number };
      if (!displayName?.trim()) return res.status(400).json({ message: "displayName required" });
      await storage.upsertRoleConfig(role, displayName.trim(), permissions, hierarchyOrder);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create a new custom role
  app.post("/api/admin/role-config", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { role, displayName, permissions, hierarchyOrder } = req.body as {
        role: string; displayName: string; permissions: RolePermissions; hierarchyOrder: number;
      };
      if (!role?.trim() || !displayName?.trim()) return res.status(400).json({ message: "role and displayName required" });
      if (BUILTIN_ROLES.has(role)) return res.status(400).json({ message: "Cannot create a role with a built-in name" });
      await storage.createRoleConfig(role.trim(), displayName.trim(), permissions, hierarchyOrder);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Delete a custom role
  app.delete("/api/admin/role-config/:role", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const { role } = req.params;
      if (BUILTIN_ROLES.has(role)) return res.status(400).json({ message: "Cannot delete built-in roles" });
      await storage.deleteRoleConfig(role);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Generic key-value store — used by "Convert to project" and similar integrations
  app.post("/api/store", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { key, value } = req.body as { key: string; value: unknown };
      if (!key?.trim()) return res.status(400).json({ message: "key required" });
      await storage.insertKvEntry(key.trim(), value);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/store/:key", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const entries = await storage.getKvEntries(req.params.key);
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Public convert-to-project endpoints — no auth required, CORS open
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  app.options("/api/convert-to-project", (_req, res) => {
    res.set(corsHeaders).sendStatus(200);
  });

  app.post("/api/convert-to-project", async (req: any, res) => {
    res.set(corsHeaders);
    try {
      const { id, title, customer, systemId, priority, assignee, processed, step, tasks } = req.body as {
        id?: string; title?: string; customer?: string | null;
        systemId?: string | null; priority?: string | null; assignee?: string | null;
        processed?: boolean; step?: string; tasks?: { label: string; done: boolean }[];
      };
      const payload = {
        id: id ?? null,
        title: title ?? null,
        customer: customer ?? null,
        systemId: systemId ?? null,
        priority: priority ?? null,
        assignee: assignee ?? null,
        processed: processed ?? false,
        step: step ?? null,
        tasks: tasks ?? [],
        timestamp: new Date().toISOString(),
      };
      await storage.insertKvEntry("ticket_to_project", payload);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/convert-to-project", async (_req, res) => {
    res.set(corsHeaders);
    try {
      const entries = await storage.getKvEntries("ticket_to_project");
      if (!entries.length) return res.json({ data: null });
      res.json({ data: (entries[0] as any).value ?? entries[0] });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Look up a specific ticket's conversion record by its ISR id
  app.get("/api/convert-to-project/by-ticket/:ticketId", async (req: any, res) => {
    res.set(corsHeaders);
    try {
      const { ticketId } = req.params;
      const rows = await db.execute(
        sql`SELECT value FROM kv_store WHERE key = 'ticket_to_project' AND value->>'id' = ${ticketId} ORDER BY created_at DESC LIMIT 1`
      );
      const row = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? rows[0] : null);
      if (!row) return res.json({ data: null });
      res.json({ data: typeof row.value === "string" ? JSON.parse(row.value) : row.value });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Mark a specific ticket's project as complete — callable by PM app or manually
  app.post("/api/convert-to-project/complete/:ticketId", async (req: any, res) => {
    res.set(corsHeaders);
    try {
      const ticketId = decodeURIComponent(req.params.ticketId);
      // Fetch the latest record for this ticket to preserve existing fields
      const rows = await db.execute(
        sql`SELECT value FROM kv_store WHERE key = 'ticket_to_project' AND value->>'id' = ${ticketId} ORDER BY created_at DESC LIMIT 1`
      );
      const row = (rows as any).rows?.[0] ?? (Array.isArray(rows) ? rows[0] : null);
      const existing = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : {};
      const payload = { ...existing, id: ticketId, processed: true, step: "complete", completedAt: new Date().toISOString() };
      await storage.insertKvEntry("ticket_to_project", payload);
      res.json({ success: true, data: payload });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.options("/api/convert-to-project/complete/:ticketId", (_req, res) => {
    res.set(corsHeaders).sendStatus(200);
  });

  // Remove duplicate rows that share the same airtable_record_id (keeps oldest by id)
  app.post("/api/admin/dedup-tickets", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const result = await db.execute(sql`
        DELETE FROM tickets
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY airtable_record_id ORDER BY id ASC) AS rn
            FROM tickets
            WHERE airtable_record_id IS NOT NULL
          ) sub
          WHERE rn > 1
        )
        RETURNING id
      `);
      const deleted = (result as any).rowCount ?? (result as any).rows?.length ?? 0;
      console.log(`Dedup: deleted ${deleted} duplicate ticket rows`);
      res.json({ deleted, message: `Removed ${deleted} duplicate ticket row(s)` });
    } catch (err: any) {
      console.error("Dedup error:", err.message || err);
      res.status(500).json({ message: err.message || "Dedup failed" });
    }
  });

  app.delete("/api/admin/tickets/:id", async (req: any, res) => {
    const token = req.headers["x-admin-token"] || req.headers["authorization"]?.replace("Bearer ", "");
    const validKey = process.env.ISR_API_KEY || process.env.SESSION_SECRET;
    if (!token || !validKey || token !== validKey) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const ticketId = parseInt(req.params.id);
    if (isNaN(ticketId)) return res.status(400).json({ message: "Invalid ticket ID" });
    try {
      await db.execute(sql`DELETE FROM ticket_notes WHERE ticket_id = ${ticketId}`);
      const result = await db.execute(sql`DELETE FROM tickets WHERE id = ${ticketId} RETURNING id, title`);
      const rows = (result as any).rows ?? [];
      if (rows.length === 0) return res.status(404).json({ message: "Ticket not found" });
      console.log(`Admin deleted ticket id=${ticketId}: ${rows[0].title}`);
      res.json({ deleted: rows[0] });
    } catch (err: any) {
      console.error("Admin delete ticket error:", err.message || err);
      res.status(500).json({ message: err.message || "Delete failed" });
    }
  });

  app.post("/api/admin/fix-airtable/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      if (isNaN(ticketId)) return res.status(400).json({ message: "Invalid ticket ID" });
      const ticket = await storage.getTicket(ticketId);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (ticket.airtableRecordId) return res.status(400).json({ message: `Ticket already has Airtable record: ${ticket.airtableRecordId}` });

      const airtableFields: Record<string, any> = { description: ticket.description };
      if (ticket.priorityLabel) airtableFields.priority = ticket.priorityLabel;
      if (ticket.assigneeName) airtableFields.assignee_name = ticket.assigneeName;
      if (ticket.submittedBy) airtableFields.submitter_name = ticket.submittedBy;
      if (ticket.commsDirection) airtableFields.comms_direction = ticket.commsDirection;
      if (ticket.escalationSource) airtableFields.receipt_method = ticket.escalationSource;

      if (ticket.customerName) {
        try {
          const custRecordId = await getCustomerRecordId(ticket.customerName);
          if (custRecordId) {
            airtableFields.customer = [custRecordId];
            if (ticket.systemId) {
              try {
                const siteRecordId = await getSiteRecordId(custRecordId, ticket.systemId, ticket.csChannel);
                if (siteRecordId) airtableFields.site = [siteRecordId];
              } catch {}
            }
          }
        } catch {}
      }

      if (ticket.systemId) {
        try {
          const asaRecordId = await getAsaRecordId(ticket.systemId);
          if (asaRecordId) airtableFields.asa = [asaRecordId];
        } catch (e: any) { console.error("[ASA] getAsaRecordId failed:", e.message); }
      }

      let record: any;
      try {
        record = await createAirtableRecord(airtableFields);
      } catch (firstErr: any) {
        if (airtableFields.priority) {
          const { priority: _p, ...fieldsWithoutPriority } = airtableFields;
          record = await createAirtableRecord(fieldsWithoutPriority);
        } else {
          throw firstErr;
        }
      }

      const mapped = mapAirtableToTicket(record);
      const updates: Record<string, any> = { airtableRecordId: record.id };
      if (mapped.ticketNumber) updates.ticketNumber = mapped.ticketNumber;
      if (mapped.csChannel) updates.csChannel = mapped.csChannel;
      try { await updateAirtableRecord(record.id, { record_id_slack: record.id }); } catch {}

      const updated = await storage.updateTicket(ticketId, updates);
      res.json({ success: true, airtableRecordId: record.id, ticketNumber: mapped.ticketNumber, ticket: updated });
    } catch (err: any) {
      console.error("fix-airtable error:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to create Airtable record" });
    }
  });

  app.post("/api/send-email", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { to, subject, body, cc, html } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ message: "to, subject, and body are required" });
      }
      const sanitize = (s: string) => s.replace(/[\r\n]/g, "");
      await sendEmail(sanitize(to), sanitize(subject), body, cc ? sanitize(cc) : undefined, html || undefined);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Send email error:", err.message || err);
      res.status(500).json({ message: err.message || "Failed to send email" });
    }
  });

  app.get("/api/email-templates", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const templates = await storage.getEmailTemplates(userId);
    res.json(templates);
  });

  const emailTemplateSchema = z.object({
    name: z.string().min(1).max(200),
    subject: z.string().min(1),
    body: z.string().min(1),
    isGlobal: z.boolean().default(false),
  });

  app.post("/api/email-templates", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const input = emailTemplateSchema.parse(req.body);
      const userId = req.user.claims.sub;
      const template = await storage.createEmailTemplate({ ...input, userId });
      res.json(template);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid template data" });
    }
  });

  app.patch("/api/email-templates/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user.claims.sub;
      const input = emailTemplateSchema.partial().parse(req.body);
      const updated = await storage.updateEmailTemplate(id, userId, input);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Invalid template data" });
    }
  });

  app.delete("/api/email-templates/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const id = parseInt(req.params.id);
    const userId = req.user.claims.sub;
    const deleted = await storage.deleteEmailTemplate(id, userId);
    if (!deleted) return res.status(404).json({ message: "Template not found" });
    res.json({ success: true });
  });

  async function fetchConfirmedInstalls() {
    const INSTALLS_BASE = "appzLiACOq8tvPZEF";
    const INSTALLS_TABLE = "tblRXewS1BUrOkx1x";
    const PAT = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
    // NOTE: Do NOT use fields[] on the FJD table — formula/computed fields won't return correctly
    const params = new URLSearchParams({
      filterByFormula: `AND({Install Date Confirmed} = TRUE(), IS_AFTER({Installation Starts}, DATEADD(TODAY(), -8, 'days')))`,
      "sort[0][field]": "Installation Starts",
      "sort[0][direction]": "asc",
    });
    const url = `https://api.airtable.com/v0/${INSTALLS_BASE}/${INSTALLS_TABLE}?${params.toString()}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${PAT}` } });
    if (!response.ok) throw new Error("Airtable installs fetch failed");
    const data = await response.json() as { records: Array<{ id: string; fields: Record<string, any> }> };
    return data.records.map(r => ({
      id: r.id,
      customer: (Array.isArray(r.fields["Customer"]) ? r.fields["Customer"][0] : (r.fields["Customer"] || "")).trim(),
      systemId: (r.fields["Formic System ID"] || "").trim(),
      installationStarts: (r.fields["Installation Starts"] || "").trim() || null,
      projectManager: (r.fields["Project Manager"]?.name || "").trim(),
      dplyFse: (r.fields["DPLY FSE"] || "").trim(),
      fseArrival: (r.fields["FSE Arrival"] || "").trim() || null,
    }));
  }

  app.get("/api/confirmed-installs", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      res.json(await fetchConfirmedInstalls());
    } catch (err: any) {
      console.error("confirmed-installs error:", err.message || err);
      res.status(500).json({ message: "Internal error" });
    }
  });

  app.patch("/api/confirmed-installs/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { dplyFse, fseArrival, installationStarts } = req.body;
      const PAT = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
      const INSTALLS_BASE = "appzLiACOq8tvPZEF";
      const INSTALLS_TABLE = "tblRXewS1BUrOkx1x";

      const fields: Record<string, any> = {};
      if (dplyFse !== undefined) fields["DPLY FSE"] = dplyFse;
      if (fseArrival !== undefined) fields["FSE Arrival"] = fseArrival || null;
      if (installationStarts !== undefined) fields["Installation Starts"] = installationStarts || null;

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ message: "No fields to update" });
      }

      const url = `https://api.airtable.com/v0/${INSTALLS_BASE}/${INSTALLS_TABLE}/${id}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Airtable PATCH failed: ${errText}`);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("confirmed-installs PATCH error:", err.message || err);
      res.status(500).json({ message: err.message || "Internal error" });
    }
  });

  app.get("/api/daily-reviews", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const reviews = await storage.getDailyReviews();
    res.json(reviews);
  });

  app.get("/api/daily-reviews/:date", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const review = await storage.getDailyReview(req.params.date);
    if (!review) return res.status(404).json({ message: "Review not found" });
    res.json(review);
  });

  app.post("/api/daily-reviews", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { date, sections, copyFromDate } = req.body;
      if (!date) return res.status(400).json({ message: "date is required" });

      const existing = await storage.getDailyReview(date);
      if (existing) return res.status(409).json({ message: "Review for this date already exists", review: existing });

      let sectionData = sections;
      if (!sectionData && copyFromDate) {
        const source = await storage.getDailyReview(copyFromDate);
        if (source?.sections) {
          const sourceSections = source.sections as Record<string, string>;
          const allTickets = await storage.getTickets();
          const userName = await resolveUserDisplayName(req.user);
          const userEmail = req.user?.claims?.email as string | undefined;
          await saveTicketSectionHistory(sourceSections, allTickets, userName, userEmail);
          // Explicitly carry over only the sections that should persist; old
          // parkingLot is NOT copied — only nextParkingLot moves into parkingLot.
          sectionData = {
            hyperCare: sourceSections.hyperCare || "",
            delayedInstalls: sourceSections.delayedInstalls || "",
            onCallRotation: sourceSections.onCallRotation || "",
            p1p2Tickets: "",
            p3Tickets: "",
            confirmedInstalls: "",
            parkingLot: sourceSections.nextParkingLot || "",
            nextParkingLot: "",
          };
        }
      }
      if (!sectionData) {
        sectionData = {
          p1p2Tickets: "",
          hyperCare: "",
          p3Tickets: "",
          confirmedInstalls: "",
          delayedInstalls: "",
          parkingLot: "",
          nextParkingLot: "",
          onCallRotation: "",
        };
      }

      // Pre-populate confirmedInstalls with fresh Airtable data if it is empty
      if (!sectionData.confirmedInstalls || sectionData.confirmedInstalls.trim() === "") {
        try {
          // ── Server-side install block parser (mirrors client-side parseInstallBlocks) ──
          type SrvInstallBlock = {
            customer: string; systemId: string; csChannel: string; installationStarts: string;
            fseName: string; fseSlackId: string; fseArrival: string; wo: string; comment: string;
          };
          function parseSrvInstallBlocks(text: string): SrvInstallBlock[] {
            const lines = text.split("\n");
            const blocks: SrvInstallBlock[] = [];
            let i = 0;
            while (i < lines.length) {
              if (lines[i].startsWith("INST:")) {
                let instContent = lines[i].slice(5);
                // Defensive: re-join a continuation line if the INST field was split by an embedded newline
                if (instContent.split("|").length < 4 && i + 1 < lines.length && lines[i + 1].startsWith("|")) {
                  instContent += lines[i + 1];
                  i++;
                }
                const p = instContent.split("|");
                const block: SrvInstallBlock = {
                  customer: (p[0] || "").trim(), systemId: (p[1] || "").trim(), csChannel: (p[2] || "").trim(),
                  installationStarts: (p[3] || "").trim(), fseName: "", fseSlackId: "", fseArrival: "", wo: "", comment: "",
                };
                if (i + 1 < lines.length && lines[i + 1].startsWith("FSE:")) {
                  const fp = lines[i + 1].slice(4).split("|");
                  block.fseName = fp[0] || ""; block.fseSlackId = fp[1] || ""; block.fseArrival = fp[2] || "";
                  i++;
                }
                if (i + 1 < lines.length && lines[i + 1].startsWith("WO:")) { block.wo = lines[i + 1].slice(3).trim(); i++; }
                if (i + 1 < lines.length && lines[i + 1].startsWith("//")) { block.comment = lines[i + 1].slice(2); i++; }
                blocks.push(block);
              }
              i++;
            }
            return blocks;
          }
          function serializeSrvInstallBlock(b: SrvInstallBlock): string[] {
            return [`INST:${b.customer}|${b.systemId}|${b.csChannel}|${b.installationStarts}`,
              `FSE:${b.fseName}|${b.fseSlackId}|${b.fseArrival}`, `WO:${b.wo}`, `//${b.comment}`, ""];
          }
          // Unique key per install (systemId preferred; fall back to customer+date)
          function instKey(systemId: string, customer: string, installDate: string): string {
            return systemId.trim() || `${customer.trim()}|${installDate.trim()}`;
          }

          // Find most-recent prior review to carry forward WO/comment and detect delayed
          const allReviewsForPrev = await storage.getDailyReviews();
          const prevReview = allReviewsForPrev.sort((a, b) => b.date.localeCompare(a.date)).find(r => r.date < date);
          const prevSections = prevReview?.sections as Record<string, string> | undefined;
          const prevBlocks = parseSrvInstallBlocks(prevSections?.confirmedInstalls || "");
          const prevBlockMap = new Map<string, SrvInstallBlock>();
          for (const pb of prevBlocks) prevBlockMap.set(instKey(pb.systemId, pb.customer, pb.installationStarts), pb);

          // Fetch today's live Airtable installs
          const installs = await fetchConfirmedInstalls();
          const todayKeys = new Set<string>();
          for (const inst of installs) todayKeys.add(instKey(inst.systemId, inst.customer, inst.installationStarts || ""));

          // Build channel map and Slack ID lookup
          const allTicketsForChannel = await storage.getTickets();
          const channelMap = new Map<string, string>();
          for (const t of allTicketsForChannel) {
            if (t.systemId && t.csChannel && !channelMap.has(t.systemId)) channelMap.set(t.systemId, t.csChannel);
          }
          const members = await getSlackMembers();
          function findFseSlackId(name: string): string {
            if (!name) return "";
            const lower = name.toLowerCase();
            const exact = members.find(m => m.name.toLowerCase() === lower);
            if (exact) return exact.id;
            const partial = members.find(m => m.name.toLowerCase().includes(lower) || lower.includes(m.name.toLowerCase()));
            return partial?.id || "";
          }

          // Build confirmedInstalls, carrying forward WO/comment from previous day where available
          // Sort by customer then installationStarts so same-customer installs are adjacent
          const sortedInstalls = [...installs].sort((a, b) => {
            const custCmp = (a.customer || "").localeCompare(b.customer || "");
            if (custCmp !== 0) return custCmp;
            return (a.installationStarts || "").localeCompare(b.installationStarts || "");
          });
          const confirmedLines: string[] = [];
          for (const inst of sortedInstalls) {
            if (!inst.fseArrival) continue; // skip installs with no FSE Arrival date
            const csChannel = channelMap.get(inst.systemId) || "";
            const fseSlackId = findFseSlackId(inst.dplyFse);
            const key = instKey(inst.systemId, inst.customer, inst.installationStarts || "");
            const prev = prevBlockMap.get(key);
            confirmedLines.push(`INST:${inst.customer}|${inst.systemId}|${csChannel}|${inst.installationStarts || ""}`);
            confirmedLines.push(`FSE:${inst.dplyFse}|${fseSlackId}|${inst.fseArrival || ""}`);
            confirmedLines.push(`WO:${prev?.wo || ""}`);
            confirmedLines.push(`//${prev?.comment || ""}`);
            confirmedLines.push("");
          }
          sectionData.confirmedInstalls = confirmedLines.join("\n").trimEnd();

          // Move previous installs no longer in today's Airtable (but date not yet past) → delayedInstalls
          const delayedLines: string[] = [];
          for (const pb of prevBlocks) {
            const key = instKey(pb.systemId, pb.customer, pb.installationStarts);
            if (todayKeys.has(key)) continue; // still confirmed today — skip
            if (!pb.installationStarts) continue; // no date to check — skip
            // Only move if install date >= today (not yet past)
            if (pb.installationStarts.slice(0, 10) < date.slice(0, 10)) continue;
            delayedLines.push(...serializeSrvInstallBlock(pb));
          }
          if (delayedLines.length > 0) {
            const existing = (sectionData.delayedInstalls || "").trim();
            const newDelayed = delayedLines.join("\n").trimEnd();
            sectionData.delayedInstalls = existing ? existing + "\n" + newDelayed : newDelayed;
          }

        } catch (prefillErr: any) {
          console.error("Failed to pre-populate confirmedInstalls:", prefillErr.message || prefillErr);
        }
      }

      // Pre-populate onCallRotation with live Ops Command data if it is empty
      if (!sectionData.onCallRotation || sectionData.onCallRotation.trim() === "") {
        try {
          const oncall = await getOncall();

          function fmtRotDate(d: Date): string {
            const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
          }

          const nextRotDate = oncall.nextRotationAt ? new Date(oncall.nextRotationAt) : null;
          // Derive current rotation start from nextRotationAt - 7 days if not explicitly provided
          const currStartDate = oncall.currentRotationStartsAt
            ? new Date(oncall.currentRotationStartsAt)
            : nextRotDate
              ? new Date(new Date(nextRotDate).setDate(nextRotDate.getDate() - 7))
              : null;

          const lines: string[] = [];

          const currName = oncall.currentFse?.name || "";
          const nextName = oncall.nextWeekFse?.name || "";

          // Pad name column so dates start at the same position
          const maxNameLen = Math.max(currName.length, nextName.length);
          const padName = (n: string) => n.padEnd(maxNameLen);

          if (nextRotDate) {
            const thisWeekStart = currStartDate && !isNaN(currStartDate.getTime())
              ? fmtRotDate(currStartDate) : "";
            const thisWeekEnd = fmtRotDate(nextRotDate);
            const nextWeekStart = fmtRotDate(nextRotDate);
            const nextEnd = new Date(nextRotDate);
            nextEnd.setDate(nextEnd.getDate() + 7);
            const nextWeekEnd = fmtRotDate(nextEnd);

            // Pad start-date column so the dash aligns on both rows
            const maxStartLen = Math.max(thisWeekStart.length, nextWeekStart.length);
            const padStart = (s: string) => s.padEnd(maxStartLen);

            if (currName) {
              const dateStr = thisWeekStart
                ? `${padStart(thisWeekStart)} - ${thisWeekEnd} 12AM CST`
                : `${thisWeekEnd} 12AM CST`;
              lines.push(`Oncall This week:  @${padName(currName)}  ${dateStr}`);
            }
            if (nextName) {
              lines.push(`Oncall next week:  @${padName(nextName)}  ${padStart(nextWeekStart)} - ${nextWeekEnd} 12AM CST`);
            }
          }

          if (lines.length > 0) {
            sectionData.onCallRotation = lines.join("\n");
          }
        } catch (oncallErr: any) {
          console.error("Failed to pre-populate onCallRotation:", oncallErr.message || oncallErr);
        }
      }

      const userId = req.user.claims.sub;
      const review = await storage.createDailyReview({ date, sections: sectionData, createdBy: userId, updatedBy: userId });

      // Capture ticket stats snapshot for this new review
      try {
        const ticketsForStats = await storage.getTickets();
        const now = new Date();
        const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const openTickets = ticketsForStats.filter((t: any) => t.status !== "resolved" && t.status !== "closed");
        const byPriority: Record<string, number> = {};
        for (const t of openTickets) {
          const raw = t.priorityLabel || t.priority || "Unknown";
          const parts = raw.split(":");
          const key = parts.length >= 2 ? parts.slice(0, 2).map((s: string) => s.trim()).join(": ") : raw;
          const pKey = key.includes("P1") ? "P1" : key.includes("P2") ? "P2" : key.includes("P3") ? "P3" : key.includes("P4") ? "P4" : "Other";
          byPriority[pKey] = (byPriority[pKey] || 0) + 1;
        }
        const openedIn24h = ticketsForStats.filter((t: any) => t.submittedAt && new Date(t.submittedAt) >= h24).length;
        const openedIn7d = ticketsForStats.filter((t: any) => t.submittedAt && new Date(t.submittedAt) >= d7).length;
        const closedTickets = ticketsForStats.filter((t: any) => t.status === "resolved" || t.status === "closed");
        const closedIn24h = closedTickets.filter((t: any) => { const ts = t.resolvedAt || t.updatedAt; return ts && new Date(ts) >= h24; }).length;
        const closedIn7d = closedTickets.filter((t: any) => { const ts = t.resolvedAt || t.updatedAt; return ts && new Date(ts) >= d7; }).length;
        await storage.updateDailyReviewSnapshotStats(review.date, {
          totalOpen: openTickets.length,
          byPriority,
          openedIn24h,
          openedIn7d,
          closedIn24h,
          closedIn7d,
          capturedAt: now.toISOString(),
        });
      } catch (statsErr: any) {
        console.error("Failed to snapshot ticket stats:", statsErr.message || statsErr);
      }

      // Snapshot the most recent prior review with current live data (freeze its panels)
      try {
        const allReviews = await storage.getDailyReviews();
        const prevReview = allReviews.find(r => r.date < date && r.snapshotP1P2Tickets === null);
        if (prevReview) {
          const allTickets = await storage.getTickets();
          function shortenPriorityServer(label: string): string {
            const parts = label.split(":");
            return parts.length >= 2 ? parts.slice(0, 2).map((s: string) => s.trim()).join(": ") : label;
          }
          function isP1orP2Server(t: typeof allTickets[0]) {
            if (!t.priorityLabel) return t.priority === "high";
            const s = shortenPriorityServer(t.priorityLabel);
            return s.includes("P1") || s.includes("P2");
          }
          const snapshotP1P2Tickets = allTickets
            .filter(t => t.status === "open" && isP1orP2Server(t))
            .sort((a, b) => (a.priorityLabel || "").localeCompare(b.priorityLabel || ""))
            .map(t => ({
              id: t.id,
              ticketNumber: t.ticketNumber,
              title: t.title,
              priorityLabel: t.priorityLabel,
              customerName: t.customerName,
              assigneeName: t.assigneeName,
              systemId: t.systemId,
              submittedAt: t.submittedAt?.toISOString() ?? null,
            }));
          const snapshotInstalls = await fetchConfirmedInstalls();
          await storage.snapshotDailyReview(prevReview.date, snapshotP1P2Tickets, snapshotInstalls);
        }
      } catch (snapErr: any) {
        console.error("Failed to snapshot previous review:", snapErr.message || snapErr);
        // Non-fatal — don't fail the create
      }

      res.json(review);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to create daily review" });
    }
  });

  app.patch("/api/daily-reviews/:date", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { sections } = req.body;
      if (!sections) return res.status(400).json({ message: "sections is required" });
      const userId = req.user.claims.sub;
      const updated = await storage.updateDailyReview(req.params.date, sections, userId);
      if (!updated) return res.status(404).json({ message: "Review not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update daily review" });
    }
  });

  app.delete("/api/daily-reviews/:date", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const deleted = await storage.deleteDailyReview(req.params.date);
      if (!deleted) return res.status(404).json({ message: "Review not found" });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to delete daily review" });
    }
  });

  async function saveTicketSectionHistory(
    sections: Record<string, string>,
    allTickets: Awaited<ReturnType<typeof storage.getTickets>>,
    userName: string,
    userEmail?: string,
  ): Promise<number> {
    const ticketBySysId = new Map<string, typeof allTickets[0]>();
    const ticketByNumber = new Map<string, typeof allTickets[0]>();
    for (const t of allTickets) {
      if (t.systemId) ticketBySysId.set(t.systemId, t);
      if (t.ticketNumber) ticketByNumber.set(t.ticketNumber.replace(/\s+/g, ''), t);
    }

    // Look up the updater's Slack ID once for use in thread replies
    let updaterMention = userName;
    try {
      const slackId = userEmail
        ? await lookupSlackUserIdByEmail(userEmail)
        : userName
        ? await lookupSlackUserId(userName)
        : null;
      if (slackId) updaterMention = `<@${slackId}>`;
    } catch {}

    const historySectionKeys = ["p1p2Tickets", "p3Tickets"];
    const updatedHistories = new Map<number, Array<{ text: string; updatedBy: string; updatedAt: string }>>();
    let savedCount = 0;

    for (const sectionKey of historySectionKeys) {
      const content = (sections[sectionKey] || "").trim();
      if (!content) continue;

      const rawLines = content.split("\n");
      for (let i = 0; i < rawLines.length; i++) {
        const trimmedLine = rawLines[i].trim();
        const ticketMatch = trimmedLine.match(/^(\S+),\s*(.+?),\s*(.+?),\s*(ISR\s*-\s*\d+)/);
        if (!ticketMatch) continue;

        const commentLines: string[] = [];
        for (let j = i + 1; j < rawLines.length; j++) {
          const cLine = rawLines[j].trim();
          if (!cLine.startsWith("// ")) break;
          commentLines.push(cLine.slice(3).trim());
        }
        if (commentLines.length === 0) continue;

        const comment = commentLines.join("\n");
        if (!comment) continue;

        const [, sysId, , , ticketNum] = ticketMatch;
        const normalizedNum = ticketNum.trim().replace(/\s+/g, '');
        const ticket = ticketByNumber.get(normalizedNum) || ticketBySysId.get(sysId);
        if (!ticket) continue;

        const history = updatedHistories.get(ticket.id) ?? (ticket.nextStepsHistory || []);
        const lastEntry = history.length > 0 ? history[history.length - 1] : null;
        if (lastEntry && lastEntry.text === comment) continue;

        const newHistory = [...history, { text: comment, updatedBy: userName, updatedAt: new Date().toISOString() }];
        updatedHistories.set(ticket.id, newHistory);
        await storage.updateTicket(ticket.id, { nextStepsHistory: newHistory });
        savedCount++;

        // Post a Slack thread reply to the ticket's original message (skip closed tickets and auto-generated entries)
        if (ticket.slackMessageId && ticket.csChannel && ticket.status !== "closed" && !comment.includes("(Auto-Generated)")) {
          const ticketRef = ticket.ticketNumber || `#${ticket.id}`;
          const replyText = `:pencil2: *${ticketRef} updated* by ${updaterMention}\n• ${comment}`;
          postThreadReply(ticket.csChannel, ticket.slackMessageId, replyText).catch(() => {});
        }
      }
    }

    return savedCount;
  }

  app.post("/api/daily-reviews/:date/save-history", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { date } = req.params;
      const review = await storage.getDailyReview(date);
      if (!review) return res.status(404).json({ message: "Daily review not found" });

      const sections = (req.body?.sections || review.sections) as Record<string, string>;
      const allTickets = await storage.getTickets();
      const userName = await resolveUserDisplayName(req.user);
      const userEmail = req.user?.claims?.email as string | undefined;

      const savedCount = await saveTicketSectionHistory(sections, allTickets, userName, userEmail);
      res.json({ success: true, savedCount });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to save history" });
    }
  });

  app.get("/api/views", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const userId = req.user.claims.sub;
    const views = await storage.getSavedViews(userId);
    res.json(views);
  });

  const createViewSchema = z.object({
    name: z.string().min(1).max(100),
    isGlobal: z.boolean().default(false),
    filters: z.object({
      status: z.array(z.string()).optional(),
      priority: z.array(z.string()).optional(),
      assignee: z.array(z.string()).optional(),
      customer: z.array(z.string()).optional(),
      colCustomer: z.array(z.string()).optional(),
      colPriority: z.array(z.string()).optional(),
      colAssignee: z.array(z.string()).optional(),
      region: z.array(z.string()).optional(),
      systemId: z.array(z.string()).optional(),
      escalationSource: z.array(z.string()).optional(),
      escalationLevel: z.array(z.string()).optional(),
      commsDirection: z.array(z.string()).optional(),
      titleSearch: z.string().optional(),
      isrSearch: z.string().optional(),
      submittedFrom: z.string().optional(),
      submittedTo: z.string().optional(),
      nextUpdateFrom: z.string().optional(),
      nextUpdateTo: z.string().optional(),
      filterNoNextUpdate: z.boolean().optional(),
      nextUpdateFilter: z.enum(["overdue", "today", "soon"]).nullable().optional(),
      dateFilterDays: z.number().nullable().optional(),
    }),
  });

  app.post("/api/views", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const input = createViewSchema.parse(req.body);
      const userId = req.user.claims.sub;
      const view = await storage.createSavedView({
        name: input.name,
        isGlobal: input.isGlobal,
        userId,
        filters: input.filters,
      });
      res.status(201).json(view);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      }
      throw err;
    }
  });

  app.patch("/api/views/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user.claims.sub;
      const input = createViewSchema.partial().parse(req.body);
      const updated = await storage.updateSavedView(id, userId, input);
      if (!updated) return res.status(404).json({ message: "View not found or not authorized" });
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  app.delete("/api/views/:id", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const id = parseInt(req.params.id);
    const userId = req.user.claims.sub;
    const deleted = await storage.deleteSavedView(id, userId);
    if (!deleted) {
      return res.status(404).json({ message: "View not found" });
    }
    res.status(204).send();
  });

  app.get("/api/settings/:key", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const value = await storage.getSetting(req.params.key);
    res.json({ key: req.params.key, value });
  });

  app.put("/api/settings/:key", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    const { value } = req.body;
    if (typeof value !== "string") {
      return res.status(400).json({ message: "value must be a string" });
    }
    await storage.setSetting(req.params.key, value);
    res.json({ key: req.params.key, value });
  });

  storage.getTickets().then(async (tickets) => {
    if (tickets.length === 0) {
      await storage.createTicket({
        title: "Setup Slack Integration",
        description: "Verify Slack bot token is connected and sending notifications",
        status: "in_progress",
        priority: "high",
      });
      await storage.createTicket({
        title: "Airtable Sync",
        description: "Connect Airtable base and verify records import correctly",
        status: "open",
        priority: "medium",
      });
      await storage.createTicket({
        title: "Design ticket workflow",
        description: "Define status transitions and priority escalation rules",
        status: "open",
        priority: "low",
      });
      return;
    }

    const closedWithoutResolved = tickets.filter(t => t.status === "closed" && !t.resolvedAt);
    if (closedWithoutResolved.length > 0) {
      console.log(`Backfilling resolvedAt for ${closedWithoutResolved.length} closed tickets via Airtable re-sync...`);
      try {
        const records = await fetchAirtableRecords();
        const byAirtableId = new Map(
          tickets.filter(t => t.airtableRecordId).map(t => [t.airtableRecordId, t])
        );
        let updated = 0;
        for (const record of records) {
          const mapped = mapAirtableToTicket(record);
          const existing = byAirtableId.get(record.id);
          if (existing && !existing.resolvedAt && mapped.resolvedAt) {
            await storage.updateTicket(existing.id, { resolvedAt: mapped.resolvedAt });
            updated++;
          }
        }
        console.log(`Backfilled resolvedAt for ${updated} tickets`);
      } catch (err: any) {
        console.error("resolvedAt backfill error:", err.message);
      }
    }
  });

  // Dedicated endpoint for open Preventive WOs — fetches the MaintainX CSV export (single request,
  // includes Recurrence field). Results are cached server-side for 2 hours; pass ?refresh=1 to bust.
  app.get("/api/maintainx/open-pm-wos", isAuthenticated, requireFormicEmail, async (req, res) => {
    try {
      const apiKey = process.env.MAINTAINX_API_KEY;
      if (!apiKey) return res.status(500).json({ message: "MaintainX API key not configured" });

      const forceRefresh = req.query.refresh === "1";
      const TWO_HOURS = 2 * 60 * 60 * 1000;
      if (!forceRefresh && _mxOpenPMCache && Date.now() - _mxOpenPMCache.fetchedAt < TWO_HOURS) {
        console.log(`MaintainX open-pm-wos: serving ${_mxOpenPMCache.wos.length} WOs from cache`);
        return res.json({ openPMWorkOrders: _mxOpenPMCache.wos, totalScanned: _mxOpenPMCache.totalScanned, fromCache: true });
      }

      // Fetch the full WO export as CSV — single request, includes Recurrence field
      const csvResp = await fetch("https://api.getmaintainx.com/v1/workorders/workorders.csv", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!csvResp.ok) throw new Error(`CSV fetch failed: ${csvResp.status}`);
      const csvText = await csvResp.text();

      // RFC 4180-compliant CSV parser (handles quoted fields with embedded commas/newlines)
      const parseCSV = (text: string): Record<string, string>[] => {
        const rows: Record<string, string>[] = [];
        let pos = 0;
        const len = text.length;
        const parseField = (): string => {
          if (pos >= len || text[pos] === "\n" || text[pos] === "\r") return "";
          if (text[pos] === '"') {
            pos++;
            let field = "";
            while (pos < len) {
              if (text[pos] === '"') {
                if (pos + 1 < len && text[pos + 1] === '"') { field += '"'; pos += 2; }
                else { pos++; break; }
              } else { field += text[pos++]; }
            }
            return field;
          }
          let field = "";
          while (pos < len && text[pos] !== "," && text[pos] !== "\n" && text[pos] !== "\r") field += text[pos++];
          return field;
        };
        const parseRow = (): string[] | null => {
          if (pos >= len) return null;
          const fields: string[] = [];
          while (pos < len) {
            fields.push(parseField());
            if (pos < len && text[pos] === ",") { pos++; }
            else { if (pos < len && text[pos] === "\r") pos++; if (pos < len && text[pos] === "\n") pos++; break; }
          }
          return fields;
        };
        const headers = parseRow();
        if (!headers) return [];
        while (pos < len) {
          const fields = parseRow();
          if (!fields) break;
          if (fields.length === 1 && fields[0] === "") continue;
          const row: Record<string, string> = {};
          headers.forEach((h, i) => { row[h.trim()] = (fields[i] ?? "").trim(); });
          rows.push(row);
        }
        return rows;
      };

      const sysIdPattern = /([A-Z0-9]+_SYS\d+)/gi;
      const allRows = parseCSV(csvText);
      const totalScanned = allRows.length;
      const allOpenPMWOs: MxOpenPMCache["wos"] = [];

      for (const row of allRows) {
        const status = (row["Status"] ?? "").toLowerCase();
        const workType = (row["Work Type"] ?? "").toLowerCase();
        const isOpen = status === "open" || status === "in progress";
        const isPreventive = workType === "preventive";
        if (!isOpen || !isPreventive) continue;

        const title = row["Title"] ?? "";
        const assetName = row["Asset"] || null;
        const assignedTo = row["Assigned to"] || null;
        const dueDate = (row["Due date"] ?? "").split(" ")[0] || null;
        const recurrence = row["Recurrence"] || null;
        const woUrl = row["URL"] || null;
        // Extract sequentialId from URL (e.g. https://app.getmaintainx.com/work-orders/2507)
        const woId = woUrl ? (woUrl.match(/\/work-orders\/(\d+)/) ?? [])[1] ?? null : null;

        // Extract SYS ID from title then asset name
        let foundSysId: string | null = null;
        for (const m of title.matchAll(new RegExp(sysIdPattern.source, "gi"))) { if (!foundSysId) foundSysId = m[1].toUpperCase(); }
        if (!foundSysId && assetName) {
          for (const m of assetName.matchAll(new RegExp(sysIdPattern.source, "gi"))) { if (!foundSysId) foundSysId = m[1].toUpperCase(); }
        }

        const rawStatus = status === "in progress" ? "IN_PROGRESS" : "OPEN";
        allOpenPMWOs.push({ title, assetName, sysId: foundSysId, dueDate, assignedTo, woId, status: rawStatus, recurrence });
      }

      // Sort by dueDate ascending (nulls last), then title
      allOpenPMWOs.sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return a.title.localeCompare(b.title);
      });

      console.log(`MaintainX open-pm-wos: ${allOpenPMWOs.length} open PM WOs from ${totalScanned} CSV rows`);
      _mxOpenPMCache = { wos: allOpenPMWOs, fetchedAt: Date.now(), totalScanned };
      return res.json({ openPMWorkOrders: allOpenPMWOs, totalScanned, fromCache: false });
    } catch (err: any) {
      console.error("MaintainX open-pm-wos error:", err.message);
      res.status(500).json({ message: "Failed to fetch open PM WOs" });
    }
  });

  app.get("/api/maintainx/assets-visited", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const apiKey = process.env.MAINTAINX_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "MaintainX API key not configured" });
      }

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 100);

      // Step 1: Get only "6 - Billing" system IDs from Airtable FJD
      const activeSysIds = await fetchBillingSystemIds();

      // Step 2: Load all MaintainX SYS assets; build lookup by system ID embedded in asset name
      // Asset names contain the system ID in parentheses, e.g. "SYS1 Palletizer (MIRANCHO_SYS1)"
      const mxAssetById = new Map<number, string>();            // assetId → asset name
      const mxAssetBySysId = new Map<string, { id: number; name: string }>(); // sysId → asset
      const mxSysIdByAssetId = new Map<number, string>();       // assetId → sysId (reverse lookup)
      let assetCursor: string | null = null;
      let assetPages = 0;
      while (true) {
        const url = new URL("https://api.getmaintainx.com/v1/assets");
        url.searchParams.set("limit", "100");
        if (assetCursor) url.searchParams.set("cursor", assetCursor);
        const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!resp.ok) break;
        const data = await resp.json() as { assets: Array<{ id: number; name: string }>; nextCursor: string | null };
        for (const asset of data.assets) {
          if (!asset.name) continue;
          mxAssetById.set(asset.id, asset.name);
          // Extract system ID from parentheses anywhere in name: "(MIRANCHO_SYS1)"
          // Use last match so trailing/appended tokens don't break lookup
          const allMatches = [...asset.name.matchAll(/\(([A-Z0-9]+_SYS\d+)\)/gi)];
          const m = allMatches[allMatches.length - 1];
          if (m) {
            mxAssetBySysId.set(m[1].toUpperCase(), { id: asset.id, name: asset.name });
            mxSysIdByAssetId.set(asset.id, m[1].toUpperCase());
          }
        }
        if (!data.nextCursor) break;
        assetCursor = data.nextCursor;
        assetPages++;
      }
      console.log(`MaintainX: loaded ${mxAssetById.size} SYS assets from ${assetPages + 1} asset pages`);

      const sysIdPattern = /([A-Z0-9]+_SYS\d+)/gi;
      const pmTitlePattern = /\bpm\b|preventive|_pm_|^pm_/i;

      const scheduledPMSysIds = new Set<string>();
      // Title-based fallback: sys IDs found in the title/asset-name of ANY open WO (any type).
      // Used as a second-pass check for systems whose MX asset has no assetId linkage on the WO.
      const scheduledAnySysIds = new Set<string>();

      // Step 3: Scan all WOs — collect visits AND detect open PM WOs in one pass.
      // Since no query filters are supported, we use title + type to identify PM WOs.
      // Diagnostic counters help understand pagination ordering.
      const visitedMxIds = new Set<number>();
      const scheduledMxIds = new Set<number>();
      const recurringPMAssetIds = new Set<number>();
      const openPMWOs: Array<{
        title: string; assetName: string | null; sysId: string | null;
        dueDate: string | null; assignedTo: string | null; globalId: string | null; status: string;
      }> = [];
      let woPages = 0;
      let woCursor: string | null = null;
      let diagOpenCount = 0;
      const diagOpenTypesSeen = new Set<string>();
      const diagOpenPMSample: string[] = [];
      while (true) {
        const url = new URL("https://api.getmaintainx.com/v1/workorders");
        url.searchParams.set("limit", "100");
        if (woCursor) url.searchParams.set("cursor", woCursor);
        const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!resp.ok) {
          const errText = await resp.text();
          console.error("MaintainX API error:", resp.status, errText);
          return res.status(502).json({ message: "MaintainX API error" });
        }
        const data = await resp.json() as { workOrders: Array<Record<string, unknown>>; nextCursor: string | null };
        for (const wo of data.workOrders) {
          const rawStatus = String(wo.status ?? "");
          const assetId = typeof wo.assetId === "number" ? wo.assetId : null;
          const isOpen = rawStatus === "OPEN" || rawStatus === "IN_PROGRESS";
          const woType = String(wo.type ?? wo.workOrderType ?? "").toUpperCase();
          const title = String(wo.title ?? "");

          // Diagnostics: track all open WOs and their types
          if (isOpen) {
            diagOpenCount++;
            diagOpenTypesSeen.add(woType || "(empty)");
            if ((woType === "PREVENTIVE" || pmTitlePattern.test(title)) && diagOpenPMSample.length < 5) {
              diagOpenPMSample.push(`"${title}" [type=${woType}]`);
            }
          }

          if (assetId && mxAssetById.has(assetId)) {
            if (rawStatus === "DONE") {
              const doneDate = new Date(String(wo.updatedAt ?? ""));
              if (doneDate >= cutoff) {
                visitedMxIds.add(assetId);
                if (woType === "PREVENTIVE") recurringPMAssetIds.add(assetId);
              }
            } else if (isOpen) {
              scheduledMxIds.add(assetId);
            }
          }

          // Fallback: for ANY open WO, extract sys IDs from title + asset name so systems with
          // no assetId linkage on the WO can still be found as "visit scheduled".
          if (isOpen) {
            const _assetName = (assetId && mxAssetById.has(assetId)) ? mxAssetById.get(assetId)! : null;
            for (const m of title.matchAll(new RegExp(sysIdPattern.source, "gi"))) {
              scheduledAnySysIds.add(m[1].toUpperCase());
            }
            if (_assetName) {
              for (const m of _assetName.matchAll(new RegExp(sysIdPattern.source, "gi"))) {
                scheduledAnySysIds.add(m[1].toUpperCase());
              }
            }
          }

          // Detect open PM WOs by type OR title pattern, extract SYS# for noPMScheduled check
          if (isOpen && (woType === "PREVENTIVE" || pmTitlePattern.test(title))) {
            let foundSysId: string | null = null;
            for (const m of title.matchAll(new RegExp(sysIdPattern.source, "gi"))) {
              scheduledPMSysIds.add(m[1].toUpperCase());
              if (!foundSysId) foundSysId = m[1].toUpperCase();
            }
            const assetName = (assetId && mxAssetById.has(assetId)) ? mxAssetById.get(assetId)! : null;
            if (assetName) {
              for (const m of assetName.matchAll(new RegExp(sysIdPattern.source, "gi"))) {
                scheduledPMSysIds.add(m[1].toUpperCase());
                if (!foundSysId) foundSysId = m[1].toUpperCase();
              }
            }
            // Capture WO details for the dashboard open-PM list
            const assignedUsers = Array.isArray(wo.assignedUsers) ? wo.assignedUsers : [];
            const assignedTo = assignedUsers
              .map((u: any) => u?.name ?? u?.firstName ?? "").filter(Boolean).join(", ") || null;
            const dueDate = String(wo.dueDate ?? wo.plannedEnd ?? wo.plannedEndDate ?? "").split("T")[0] || null;
            const globalId = wo.globalId != null ? String(wo.globalId) : null;
            openPMWOs.push({
              title,
              assetName,
              sysId: foundSysId,
              dueDate: dueDate || null,
              assignedTo,
              globalId,
              status: rawStatus,
            });
          }
        }
        if (!data.nextCursor) break;
        woCursor = data.nextCursor;
        woPages++;
      }
      console.log(`MaintainX: scanned ${woPages + 1} WO pages → ${visitedMxIds.size} visited, ${scheduledMxIds.size} scheduled (assetId), ${scheduledAnySysIds.size} scheduled (title), ${recurringPMAssetIds.size} done-PM assets, ${scheduledPMSysIds.size} systems with open PM`);
      console.log(`MaintainX diag: ${diagOpenCount} open WOs seen; types: [${[...diagOpenTypesSeen].join(", ")}]`);

      // Fallback: The MaintainX API caps pagination at ~2000 WOs (ascending). Newly-created
      // open PM WOs (like BONDEDPR #2508, FRESCMEX #2509-2512) fall beyond this cap.
      // Supplement scheduledPMSysIds using PM history: if a system's asset has DONE PM WOs
      // in our scan, it clearly has an active PM program — even if the current cycle WO is newer.
      let pmHistoryFallbackCount = 0;
      for (const assetId of recurringPMAssetIds) {
        const sysId = mxSysIdByAssetId.get(assetId);
        if (sysId && activeSysIds.has(sysId) && !scheduledPMSysIds.has(sysId)) {
          scheduledPMSysIds.add(sysId);
          pmHistoryFallbackCount++;
        }
      }
      if (pmHistoryFallbackCount > 0) {
        console.log(`MaintainX: +${pmHistoryFallbackCount} systems added via PM history fallback → ${scheduledPMSysIds.size} total systems with active PM`);
      }

      // Supplementary scan: try filtering by workOrderType=PREVENTIVE to capture open PM WOs
      // that fall beyond the ascending pagination cap (newer WOs with higher IDs).
      // This replaces the incomplete list captured above if the endpoint supports the filter.
      {
        const probeUrl = "https://api.getmaintainx.com/v1/workorders?workOrderType=PREVENTIVE&limit=100";
        try {
          const probeResp = await fetch(probeUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
          if (probeResp.ok) {
            console.log("MaintainX: workOrderType=PREVENTIVE filter supported — doing full Preventive WO scan");
            openPMWOs.length = 0; // Replace main-scan captures with full set
            let pmCursor: string | null = null;
            let pmPageCount = 0;
            while (true) {
              const u = new URL("https://api.getmaintainx.com/v1/workorders");
              u.searchParams.set("workOrderType", "PREVENTIVE");
              u.searchParams.set("limit", "100");
              if (pmCursor) u.searchParams.set("cursor", pmCursor);
              const pmResp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
              if (!pmResp.ok) break;
              const pmData = await pmResp.json() as { workOrders: Array<Record<string, unknown>>; nextCursor?: string | null };
              for (const wo of (pmData.workOrders ?? [])) {
                const rawStatus = String(wo.status ?? "");
                const isOpen = rawStatus === "OPEN" || rawStatus === "IN_PROGRESS";
                if (!isOpen) continue;
                const title = String(wo.title ?? "");
                const assetId = typeof wo.assetId === "number" ? wo.assetId : null;
                const assetName = (assetId && mxAssetById.has(assetId)) ? mxAssetById.get(assetId)! : null;
                // Update scheduledPMSysIds
                let foundSysId: string | null = null;
                for (const m of title.matchAll(new RegExp(sysIdPattern.source, "gi"))) {
                  scheduledPMSysIds.add(m[1].toUpperCase());
                  if (!foundSysId) foundSysId = m[1].toUpperCase();
                }
                if (assetName) {
                  for (const m of assetName.matchAll(new RegExp(sysIdPattern.source, "gi"))) {
                    scheduledPMSysIds.add(m[1].toUpperCase());
                    if (!foundSysId) foundSysId = m[1].toUpperCase();
                  }
                }
                const assignedUsers = Array.isArray(wo.assignedUsers) ? wo.assignedUsers : [];
                const assignedTo = assignedUsers.map((u: any) => u?.name ?? u?.firstName ?? "").filter(Boolean).join(", ") || null;
                const dueDate = String(wo.dueDate ?? wo.plannedEnd ?? wo.plannedEndDate ?? "").split("T")[0] || null;
                const globalId = wo.globalId != null ? String(wo.globalId) : null;
                openPMWOs.push({ title, assetName, sysId: foundSysId, dueDate: dueDate || null, assignedTo, globalId, status: rawStatus });
              }
              if (!pmData.nextCursor) break;
              pmCursor = pmData.nextCursor;
              pmPageCount++;
            }
            console.log(`MaintainX: Preventive scan complete — ${openPMWOs.length} open PM WOs found across ${pmPageCount + 1} pages`);
          } else {
            const errText = await probeResp.text();
            console.log(`MaintainX: workOrderType=PREVENTIVE filter → ${probeResp.status}: ${errText.slice(0, 80)} — using main-scan results (${openPMWOs.length} open PM WOs)`);
          }
        } catch (e) {
          console.log(`MaintainX: workOrderType=PREVENTIVE probe error: ${String(e).slice(0, 60)}`);
        }
      }

      // Step 4: Cross-reference active FJD system IDs against visited MaintainX assets
      const visited: Array<{ sysId: string; assetName: string; assetId: number }> = [];
      const unvisited: Array<{ sysId: string; assetName: string | null; assetId: number | null; hasScheduled: boolean }> = [];
      const noMxAsset: Array<{ sysId: string }> = [];
      const noPMScheduled: Array<{ sysId: string; assetName: string }> = [];

      for (const sysId of Array.from(activeSysIds).sort()) {
        const mxAsset = mxAssetBySysId.get(sysId.toUpperCase());
        if (!mxAsset) {
          noMxAsset.push({ sysId });
        } else {
          // Has a MX asset — check if a preventive WO is open/scheduled (by SYS# in title)
          if (!scheduledPMSysIds.has(sysId.toUpperCase())) {
            noPMScheduled.push({ sysId, assetName: mxAsset.name });
          }
        }
        if (mxAsset && visitedMxIds.has(mxAsset.id)) {
          visited.push({ sysId, assetName: mxAsset.name, assetId: mxAsset.id });
        } else {
          const hasScheduled = mxAsset
            ? (scheduledMxIds.has(mxAsset.id) || scheduledAnySysIds.has(sysId.toUpperCase()) || scheduledPMSysIds.has(sysId.toUpperCase()))
            : (scheduledAnySysIds.has(sysId.toUpperCase()) || scheduledPMSysIds.has(sysId.toUpperCase()));
          unvisited.push({ sysId, assetName: mxAsset?.name ?? null, assetId: mxAsset?.id ?? null, hasScheduled });
        }
      }

      const unvisitedNoSchedule = unvisited.filter(u => !u.hasScheduled);

      // Sort open PM WOs by due date (nulls last), then title
      openPMWOs.sort((a, b) => {
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return a.title.localeCompare(b.title);
      });

      res.json({
        count: visited.length,
        totalActive: activeSysIds.size,
        visited,
        unvisited,
        unvisitedNoSchedule,
        noMxAsset,
        noPMScheduled,
        openPMWorkOrders: openPMWOs,
        periodDays: 100,
      });
    } catch (err: any) {
      console.error("MaintainX assets-visited error:", err.message);
      res.status(500).json({ message: "Failed to fetch MaintainX data" });
    }
  });

  // CSV-based assets-visited analysis: accepts parsed rows from a MaintainX CSV export.
  // The client parses the CSV in the browser and POSTs only the columns needed here.
  app.post("/api/maintainx/assets-visited-csv", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { rows } = req.body as {
        rows: Array<{ status: string; asset: string; dueDate?: string }>;
      };
      if (!Array.isArray(rows)) return res.status(400).json({ message: "rows must be an array" });

      const sysIdPat = /\(([A-Z0-9]+_SYS\d+)\)/gi;

      // Build visited/scheduled sets from the CSV rows
      const visitedSysIds = new Set<string>();
      const scheduledSysIds = new Set<string>();

      for (const row of rows) {
        const status = (row.status ?? "").trim().toUpperCase().replace(/\s+/g, "_");
        const asset = row.asset ?? "";
        const matches = [...asset.matchAll(sysIdPat)];
        if (matches.length === 0) continue;
        const sysId = matches[matches.length - 1][1].toUpperCase();
        if (status === "DONE") {
          visitedSysIds.add(sysId);
        } else if (status === "OPEN" || status === "IN_PROGRESS" || status === "IN PROGRESS") {
          scheduledSysIds.add(sysId);
        }
      }

      // Cross-reference against active billing system IDs from FJD
      const activeSysIds = await fetchBillingSystemIds();

      const visited: Array<{ sysId: string; assetName: string | null; assetId: number | null }> = [];
      const unvisited: Array<{ sysId: string; assetName: string | null; assetId: number | null; hasScheduled: boolean }> = [];
      const noWoInCsv: Array<{ sysId: string }> = [];

      for (const sysId of Array.from(activeSysIds).sort()) {
        const upper = sysId.toUpperCase();
        if (visitedSysIds.has(upper)) {
          visited.push({ sysId, assetName: null, assetId: null });
        } else if (scheduledSysIds.has(upper)) {
          unvisited.push({ sysId, assetName: null, assetId: null, hasScheduled: true });
        } else {
          // Check if ANY row (including non-billing) referenced this sys ID in the whole CSV
          const hasAny = rows.some(r => {
            const m = [...(r.asset ?? "").matchAll(sysIdPat)];
            return m.some(x => x[1].toUpperCase() === upper);
          });
          if (hasAny) {
            unvisited.push({ sysId, assetName: null, assetId: null, hasScheduled: false });
          } else {
            noWoInCsv.push({ sysId });
          }
        }
      }

      const unvisitedNoSchedule = unvisited.filter(u => !u.hasScheduled);

      res.json({
        count: visited.length,
        totalActive: activeSysIds.size,
        visited,
        unvisited,
        unvisitedNoSchedule,
        noMxAsset: noWoInCsv,
        noPMScheduled: [],
        openPMWorkOrders: [],
        periodDays: null,
        source: "csv",
        rowCount: rows.length,
      });
    } catch (err: any) {
      console.error("assets-visited-csv error:", err.message);
      res.status(500).json({ message: "Failed to process CSV" });
    }
  });

  app.post("/api/tickets/slack-summaries", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { ticketIds } = req.body as { ticketIds: number[] };
      if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
        return res.json({ summaries: {} });
      }

      const slack = await getUncachableSlackClient();
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const allTickets = await storage.getTickets();
      const ticketMap = new Map(allTickets.map(t => [t.id, t]));
      const summaries: Record<number, string> = {};

      const limitedIds = ticketIds.slice(0, 15);

      for (const id of limitedIds) {
        const ticket = ticketMap.get(id);
        if (!ticket || !ticket.csChannel || !ticket.ticketNumber) continue;

        try {
          let threadTs: string | null = ticket.slackMessageId || null;

          if (!threadTs) {
            let cursor: string | undefined;
            let found = false;
            const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);

            for (let page = 0; page < 10 && !found; page++) {
              const histResult: any = await slack.conversations.history({
                channel: ticket.csChannel,
                oldest: String(thirtyDaysAgo),
                limit: 100,
                cursor,
              });

              for (const msg of histResult.messages || []) {
                if (msg.text && msg.text.includes(ticket.ticketNumber!)) {
                  threadTs = msg.ts;
                  found = true;
                  break;
                }
              }

              if (!histResult.has_more || !histResult.response_metadata?.next_cursor) break;
              cursor = histResult.response_metadata.next_cursor;
            }
          }

          if (!threadTs) continue;

          const repliesResult: any = await slack.conversations.replies({
            channel: ticket.csChannel,
            ts: threadTs,
            limit: 50,
          });

          const messages = (repliesResult.messages || [])
            .filter((m: any) => m.text && !m.subtype)
            .map((m: any) => m.text)
            .slice(0, 30);

          if (messages.length < 2) continue;

          const threadText = messages.join("\n---\n").slice(0, 4000);

          const aiResponse = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 150,
            system: `You are a support ticket summarizer for a robotics company (Formic). Given a Slack thread about a support ticket, write a 1-2 sentence update summary focusing on: current status, what was done, and what's next. Be concise and factual. Use present tense. Do not include the ticket number or system ID. Do not use markdown. Start directly with the update.`,
            messages: [
              {
                role: "user",
                content: `Summarize this Slack thread for ticket ${ticket.ticketNumber}:\n\n${threadText}`,
              },
            ],
          });

          const summaryBlock = aiResponse.content[0];
          const summary = summaryBlock?.type === "text" ? summaryBlock.text.trim() : undefined;
          if (summary) {
            summaries[id] = summary;
          }
        } catch (ticketErr: any) {
          const errMsg = ticketErr.data?.error || ticketErr.message || "";
          if (errMsg === "missing_scope" || errMsg === "channel_not_found" || errMsg === "not_in_channel") {
            console.log(`Slack thread summary skipped for ${ticket.ticketNumber}: ${errMsg}`);
          } else {
            console.error(`Slack thread summary error for ${ticket.ticketNumber}:`, errMsg);
          }
        }
      }

      res.json({ summaries });
    } catch (err: any) {
      console.error("Slack summaries error:", err.message || err);
      res.status(500).json({ message: "Failed to fetch Slack summaries" });
    }
  });

  const DAILY_REVIEW_SLACK_CHANNEL = "C07K51PCB5X";

  app.post("/api/daily-reviews/:date/slack", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { date } = req.params;
      const review = await storage.getDailyReview(date);
      if (!review) {
        return res.status(404).json({ message: "Daily review not found" });
      }

      const sections = review.sections as Record<string, string>;
      const dayOfWeek = new Date(date + "T12:00:00").getDay();
      const isFriday = dayOfWeek === 5;

      const sectionOrder: { key: string; label: string }[] = [
        { key: "p1p2Tickets", label: "P1 - P2 Highest Impact Tickets" },
        { key: "hyperCare", label: "Hyper Care" },
        { key: "confirmedInstalls", label: "Confirmed Installs" },
        { key: "delayedInstalls", label: "Delayed" },
        { key: "parkingLot", label: "Parking Lot" },
        { key: "nextParkingLot", label: "Next Parking Lot" },
        { key: "onCallRotation", label: "FS On Call Rotation" },
      ];

      if (isFriday) {
        sectionOrder.splice(1, 0, { key: "p3Tickets", label: "P3 - Needing Immediate Review/Action/Parts" });
      }

      const formatDate = (d: string) => {
        const [y, m, day] = d.split("-").map(Number);
        const dt = new Date(y, m - 1, day);
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        return `${days[dt.getDay()]}, ${months[dt.getMonth()]} ${day}, ${y}`;
      };

      const blocks: any[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `📋 Daily Standup Review — ${formatDate(date)}` },
        },
      ];

      // Stats snapshot block
      const snap = review.snapshotStats;
      if (snap) {
        const p1 = snap.byPriority["P1"] ?? 0;
        const p2 = snap.byPriority["P2"] ?? 0;
        const p3 = snap.byPriority["P3"] ?? 0;
        const p4 = snap.byPriority["P4"] ?? 0;
        const capturedStr = snap.capturedAt
          ? new Date(snap.capturedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT"
          : "";
        const statsText = [
          `📊  *Open Tickets: ${snap.totalOpen}*   🔴 P1: ${p1}  🟠 P2: ${p2}  🟡 P3: ${p3}  🔵 P4: ${p4}`,
          `📈  Opened — 24h: ${snap.openedIn24h}  /  7d: ${snap.openedIn7d}     ✅  Closed — 24h: ${snap.closedIn24h}  /  7d: ${snap.closedIn7d}${capturedStr ? `\n_Snapshot as of ${capturedStr}_` : ""}`,
        ].join("\n");
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: statsText },
        });
      }

      const SLACK_TEAM_ID = "T019Y3V5LR4";
      const allTickets = await storage.getTickets();
      const ticketBySysId = new Map<string, typeof allTickets[0]>();
      const ticketByNumber = new Map<string, typeof allTickets[0]>();
      for (const t of allTickets) {
        if (t.systemId) ticketBySysId.set(t.systemId, t);
        if (t.ticketNumber) ticketByNumber.set(t.ticketNumber.replace(/\s+/g, ''), t);
      }

      async function formatAssigneeMention(name: string): Promise<string> {
        const trimmed = name.trim();
        if (!trimmed) return trimmed;
        const slackId = await lookupSlackUserId(trimmed);
        return slackId ? `<@${slackId}>` : `*${trimmed}*`;
      }

      // Replaces #SYSID tokens in text with Slack channel deep-links when a matching ticket exists.
      function linkSystemIds(text: string): string {
        return text.replace(/#(\S+)/g, (match, sysId) => {
          const ticket = ticketBySysId.get(sysId);
          if (ticket?.csChannel) {
            return `<https://app.slack.com/client/${SLACK_TEAM_ID}/${ticket.csChannel}|${match}>`;
          }
          return match;
        });
      }

      // ── P1 & P2 Closed Since Last Review ──
      try {
        const allReviews = await storage.getDailyReviews();
        const prevReview = allReviews.find(r => r.date < date);
        const cutoff = prevReview
          ? new Date(`${prevReview.date}T00:00:00`)
          : new Date(Date.now() - 48 * 60 * 60 * 1000);

        function shortenPriorSlack(label: string): string {
          const parts = label.split(":");
          return parts.length >= 2 ? parts.slice(0, 2).map((s: string) => s.trim()).join(": ") : label;
        }
        function isP1orP2Slack(t: typeof allTickets[0]) {
          if (!t.priorityLabel) return t.priority === "high";
          const s = shortenPriorSlack(t.priorityLabel);
          return s.includes("P1") || s.includes("P2");
        }

        const closedP1P2 = allTickets
          .filter(t => {
            if (t.status !== "closed" || !isP1orP2Slack(t)) return false;
            const closedTs = t.resolvedAt ? new Date(t.resolvedAt) : t.updatedAt ? new Date(t.updatedAt) : null;
            return closedTs !== null && closedTs >= cutoff;
          })
          .sort((a, b) => {
            const aTs = a.resolvedAt ?? a.updatedAt ?? "";
            const bTs = b.resolvedAt ?? b.updatedAt ?? "";
            return new Date(bTs).getTime() - new Date(aTs).getTime();
          });

        if (closedP1P2.length > 0) {
          const sinceLabel = prevReview
            ? new Date(`${prevReview.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
            : "last 48h";

          const closedLines: string[] = [];
          for (const t of closedP1P2) {
            const assigneeDisplay = t.assigneeName ? await formatAssigneeMention(t.assigneeName) : "_Unassigned_";
            const closedTs = t.resolvedAt ?? t.updatedAt;
            const closedDateStr = closedTs
              ? new Date(closedTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "";
            const sysIdPart = t.systemId ? ` — ${t.systemId}` : "";
            const closedPart = closedDateStr ? ` | closed ${closedDateStr}` : "";
            closedLines.push(`• *${t.ticketNumber || `#${t.id}`}*${sysIdPart} | ${assigneeDisplay}${closedPart}\n  _${t.title}_`);
          }

          blocks.push({ type: "divider" });
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `*✅ P1 & P2 Closed Since Last Review* _(since ${sinceLabel})_` },
          });
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: closedLines.join("\n") },
          });
        }
      } catch (closedErr: any) {
        console.error("Failed to build closed P1/P2 section:", closedErr.message || closedErr);
      }

      // ── Parts Needed ──
      try {
        const partsTickets = allTickets.filter(t => t.status === "open" && (t as any).partsNeeded);
        if (partsTickets.length > 0) {
          const partsLines: string[] = [];
          for (const t of partsTickets) {
            const assigneeDisplay = t.assigneeName ? await formatAssigneeMention(t.assigneeName) : "_Unassigned_";
            const sysIdPart = t.systemId ? ` — ${t.systemId}` : "";
            partsLines.push(`• *${t.ticketNumber || `#${t.id}`}*${sysIdPart} | ${assigneeDisplay}\n  _${t.title}_`);
          }
          blocks.push({ type: "divider" });
          blocks.push({ type: "section", text: { type: "mrkdwn", text: `*📦 Parts Needed*` } });
          blocks.push({ type: "section", text: { type: "mrkdwn", text: partsLines.join("\n") } });
        }
      } catch (partsErr: any) {
        console.error("Failed to build parts needed section:", partsErr.message || partsErr);
      }

      for (const { key, label } of sectionOrder) {
        const content = (sections[key] || "").trim();

        if (key === "confirmedInstalls") {
          // Parse INST: blocks and group by customer + install date — skip entirely if empty
          interface InstallEntry { customer: string; sysId: string; installDate: string; fseName: string; fseSlackId: string; }
          const entries: InstallEntry[] = [];
          const rawLines = content.split("\n");
          let cur: Partial<InstallEntry> | null = null;
          for (const line of rawLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("INST:")) {
              cur = {};
              const parts = trimmed.slice(5).split("|");
              cur.customer = (parts[0] || "").trim();
              cur.sysId = (parts[1] || "").trim();
              cur.installDate = (parts[3] || "").trim();
            } else if (trimmed.startsWith("FSE:") && cur) {
              const parts = trimmed.slice(4).split("|");
              cur.fseName = (parts[0] || "").trim();
              cur.fseSlackId = (parts[1] || "").trim();
              if (cur.customer && cur.sysId) entries.push(cur as InstallEntry);
              cur = null;
            }
          }
          if (entries.length === 0) continue; // nothing to show
          // Group by customer + installDate
          const grouped = new Map<string, InstallEntry[]>();
          for (const e of entries) {
            const key2 = `${e.customer}|||${e.installDate}`;
            if (!grouped.has(key2)) grouped.set(key2, []);
            grouped.get(key2)!.push(e);
          }
          const installLines: string[] = [];
          for (const group of grouped.values()) {
            const { customer, installDate, fseName, fseSlackId } = group[0];
            const sysIds = group.map(e => `#${e.sysId}`).join(", ");
            const dateStr = installDate
              ? (() => { const [y,m,d] = installDate.split("-"); return `${m}/${d}/${y}`; })()
              : "";
            const fseDisplay = fseSlackId
              ? `<@${fseSlackId}>`
              : fseName ? `*${fseName}*` : "";
            installLines.push(`*${customer}*\n${sysIds}\n${dateStr}${fseDisplay ? `  ·  FSE: ${fseDisplay}` : ""}`);
          }
          blocks.push({ type: "divider" });
          blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${label}*` } });
          blocks.push({ type: "section", text: { type: "mrkdwn", text: installLines.join("\n\n") } });
          continue;
        }

        if (!content) continue; // skip empty sections entirely

        blocks.push({ type: "divider" });
        blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${label}*` } });

        if (content) {
          const rawLines = content.split("\n");
          const formattedLines: string[] = [];

          for (const line of rawLines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("// ")) {
              const comment = trimmed.slice(3).trim();
              if (comment) {
                // Resolve @Name mentions and full names inside comment lines too
                const withAtMentions = await resolveAtMentions(comment);
                const withMentions = await replaceNamesWithMentions(withAtMentions);
                formattedLines.push(`> _${linkSystemIds(withMentions)}_`);
              }
              continue;
            }
            if (trimmed === "//") continue;

            const ticketMatch = trimmed.match(/^(\S+),\s*(.+?),\s*(.+?),\s*(ISR\s*-\s*\d+)/);
            if (ticketMatch) {
              const [, sysId, assignee, nextUpdate, ticketNum] = ticketMatch;
              const normalizedNum = ticketNum.trim().replace(/\s+/g, '');
              const ticket = ticketByNumber.get(normalizedNum) || ticketBySysId.get(sysId);

              const assigneeDisplay = await formatAssigneeMention(assignee.trim());

              let sysIdDisplay = sysId;
              if (ticket?.csChannel) {
                sysIdDisplay = `<https://app.slack.com/client/${SLACK_TEAM_ID}/${ticket.csChannel}|${sysId}>`;
              }

              formattedLines.push(`• *${ticketNum.trim()}* — ${sysIdDisplay} | ${assigneeDisplay} | Next: ${nextUpdate.trim()}`);
            } else if (trimmed) {
              // Resolve @Name patterns first (handles first-name-only like @Charlson),
              // then replace any remaining untagged full names with Slack mentions.
              const withAtMentions = await resolveAtMentions(trimmed);
              const withMentions = await replaceNamesWithMentions(withAtMentions);
              formattedLines.push(linkSystemIds(withMentions));
            }
          }

          const text = formattedLines.join("\n") || "_No items_";
          const MAX_BLOCK_TEXT = 2900;
          if (text.length <= MAX_BLOCK_TEXT) {
            blocks.push({
              type: "section",
              text: { type: "mrkdwn", text },
            });
          } else {
            let remaining = text;
            while (remaining.length > 0) {
              const chunk = remaining.slice(0, MAX_BLOCK_TEXT);
              const lastNewline = chunk.lastIndexOf("\n");
              const cut = lastNewline > 0 ? lastNewline : MAX_BLOCK_TEXT;
              blocks.push({
                type: "section",
                text: { type: "mrkdwn", text: remaining.slice(0, cut) },
              });
              remaining = remaining.slice(cut).trimStart();
            }
          }
        } else {
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: "_No items_" },
          });
        }
      }

      const userName = await resolveUserDisplayName(req.user);
      const historySectionKeys = ["p1p2Tickets", "p3Tickets"];
      const updatedHistories = new Map<number, Array<{ text: string; updatedBy: string; updatedAt: string }>>();
      for (const sectionKey of historySectionKeys) {
        const content = (sections[sectionKey] || "").trim();
        if (!content) continue;

        const rawLines = content.split("\n");
        for (let i = 0; i < rawLines.length; i++) {
          const trimmedLine = rawLines[i].trim();
          const ticketMatch = trimmedLine.match(/^(\S+),\s*(.+?),\s*(.+?),\s*(ISR\s*-\s*\d+)/);
          if (!ticketMatch) continue;

          // Collect ALL consecutive // comment lines that follow this ticket line.
          const commentLines: string[] = [];
          for (let j = i + 1; j < rawLines.length; j++) {
            const next = rawLines[j].trim();
            if (next === "" || next === "//") continue;
            if (next.startsWith("// ")) {
              commentLines.push(next.slice(3).trim());
            } else {
              break; // hit another ticket line or non-comment content
            }
          }
          if (commentLines.length === 0) continue;

          const [, sysId, , , ticketNum] = ticketMatch;
          const normalizedNum = ticketNum.trim().replace(/\s+/g, '');
          const ticket = ticketByNumber.get(normalizedNum) || ticketBySysId.get(sysId);
          if (!ticket) continue;

          // Fresh read from DB to catch any concurrent request that already saved a morningReviewKey.
          const freshTicket = await storage.getTicket(ticket.id);
          const freshHistory: Array<{ text: string; updatedBy: string; updatedAt: string }> =
            freshTicket?.nextStepsHistory || [];
          // Prefer the in-request cache (covers same ticket appearing twice in one request);
          // fall back to the fresh DB read.
          let history: Array<{ text: string; updatedBy: string; updatedAt: string }> =
            [...(updatedHistories.get(ticket.id) ?? freshHistory)];

          for (const comment of commentLines) {
            if (!comment) continue;

            if (comment.includes("(Auto-Generated)")) {
              // Existing behaviour: save auto-generated summary to history if not already the last entry.
              const lastEntry = history.length > 0 ? history[history.length - 1] : null;
              if (!lastEntry || lastEntry.text !== comment) {
                history = [...history, { text: comment, updatedBy: userName, updatedAt: new Date().toISOString() }];
              }
            } else {
              // Manually added note: post as a Morning Review thread reply (once per unique comment).
              const morningReviewKey = `Morning Review: ${comment}`;
              const alreadyPosted = history.some(e => e.text === morningReviewKey);
              if (!alreadyPosted) {
                // Write the key to DB FIRST — a concurrent request doing a fresh read will see
                // this and skip, closing the race window that caused duplicates.
                history = [...history, { text: morningReviewKey, updatedBy: userName, updatedAt: new Date().toISOString() }];
                updatedHistories.set(ticket.id, history);
                await storage.updateTicket(ticket.id, { nextStepsHistory: history });
                // Post to Slack only after the key is persisted.
                if (ticket.slackMessageId && ticket.csChannel) {
                  // Resolve @Name mentions in manual notes before posting to Slack thread
                  const commentWithAtMentions = await resolveAtMentions(comment);
                  const commentWithMentions = await replaceNamesWithMentions(commentWithAtMentions);
                  const replyText = `:calendar: *Morning Review — ${formatDate(date)}*\n${commentWithMentions}`;
                  await postThreadReply(ticket.csChannel, ticket.slackMessageId, replyText);
                }
              }
            }
          }

          updatedHistories.set(ticket.id, history);
          await storage.updateTicket(ticket.id, { nextStepsHistory: history });
        }
      }

      const slack = await getUncachableSlackClient();

      const MAX_BLOCKS = 50;
      if (blocks.length > MAX_BLOCKS) {
        const firstBatch = blocks.slice(0, MAX_BLOCKS);
        const remaining = blocks.slice(MAX_BLOCKS);

        await slack.chat.postMessage({
          channel: DAILY_REVIEW_SLACK_CHANNEL,
          text: `Daily Standup Review — ${formatDate(date)}`,
          blocks: firstBatch,
          unfurl_links: false,
          unfurl_media: false,
        });

        while (remaining.length > 0) {
          const batch = remaining.splice(0, MAX_BLOCKS);
          await slack.chat.postMessage({
            channel: DAILY_REVIEW_SLACK_CHANNEL,
            text: `Daily Standup Review (continued)`,
            blocks: batch,
            unfurl_links: false,
            unfurl_media: false,
          });
        }
      } else {
        await slack.chat.postMessage({
          channel: DAILY_REVIEW_SLACK_CHANNEL,
          text: `Daily Standup Review — ${formatDate(date)}`,
          blocks,
          unfurl_links: false,
          unfurl_media: false,
        });
      }

      await storage.markDailyReviewSlackPosted(date);
      res.json({ message: "Slack update sent" });
    } catch (err: any) {
      const errCode = err.data?.error || err.message || err;
      console.error("Failed to post daily review to Slack:", errCode);
      if (errCode === 'not_in_channel' || errCode === 'channel_not_found') {
        res.status(400).json({ message: `Slack bot is not a member of the target channel. Please invite the bot to the channel first.` });
      } else {
        res.status(500).json({ message: `Failed to send Slack update: ${errCode}` });
      }
    }
  });

  app.post("/api/tickets/:id/parts-order", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const ticket = await storage.getTicket(ticketId);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      const { customerChannel, asaOrSysNumber, vendorPartNumber, partDescription, needByDate, workOrderNumber } = req.body as {
        customerChannel: string;
        asaOrSysNumber?: string;
        vendorPartNumber?: string;
        partDescription?: string;
        needByDate?: string;
        workOrderNumber?: string;
      };

      if (!customerChannel) return res.status(400).json({ message: "Customer channel is required" });

      const submitterEmail: string = req.user?.claims?.email || "unknown";

      // Look up submitter's Slack ID for @mention
      const submitterSlackId = await lookupSlackUserIdByEmail(submitterEmail).catch(() => null);
      const submitterMention = submitterSlackId
        ? `<@${submitterSlackId}>`
        : submitterEmail.split("@")[0].split(".").map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");

      // Ticket deep-link
      const ticketUrl = `https://formic-field-tickets.replit.app/?ticket=${ticket.id}`;
      const ticketLink = `<${ticketUrl}|${ticket.ticketNumber}>`;

      // CS channel: use <#ID> Slack syntax only for real Slack channel IDs (starts with C/G/D/W, alphanumeric).
      // If the stored value is a channel name (e.g. "kariobros-cs"), show it as plain #name text.
      const csChannelId = (ticket.csChannel || customerChannel || "").replace(/^#/, "");
      const isRealSlackId = /^[CDGW][A-Z0-9]{6,14}$/.test(csChannelId);
      const channelMention = csChannelId
        ? (isRealSlackId ? `<#${csChannelId}>` : `#${csChannelId}`)
        : null;

      const lines: string[] = [
        `📦 *Parts Order Request*`,
        ``,
        `*Ticket:* ${ticketLink}`,
        `*Submitted by:* ${submitterMention}`,
      ];
      if (channelMention) lines.push(`*CS Channel:* ${channelMention}`);
      if (asaOrSysNumber) lines.push(`*ASA / SYS #:* ${asaOrSysNumber}`);
      if (vendorPartNumber) lines.push(`*Brand, Vendor, Part #:* ${vendorPartNumber}`);
      if (partDescription) lines.push(`*Part Description:* ${partDescription}`);
      if (needByDate) lines.push(`*Need By:* ${needByDate}`);
      if (workOrderNumber) lines.push(`*Work Order:* ${workOrderNumber}`);

      const PARTS_TRACKING_CHANNEL = "C088DDQTRM1";
      const PARTS_WORKFLOW_ID = "Wf08TQFCULAE";

      // Fetch the workflow trigger URL so we can embed it in the Slack message
      const workflowUrl = await getWorkflowTriggerUrl(PARTS_WORKFLOW_ID);
      if (workflowUrl) {
        lines.push(``, `<${workflowUrl}|▶ Open Parts Order Workflow>`);
      }

      const messageText = lines.join("\n");
      const slackClient = await getUncachableSlackClient();

      // Post to the customer CS channel
      const channelId = customerChannel.replace(/^#/, "");
      if (channelId && channelId !== PARTS_TRACKING_CHANNEL) {
        await slackClient.chat.postMessage({
          channel: channelId,
          text: messageText,
          unfurl_links: false,
          unfurl_media: false,
        });
      }

      // Always post to the parts tracking channel and capture the permalink
      const trackingResult: any = await slackClient.chat.postMessage({
        channel: PARTS_TRACKING_CHANNEL,
        text: messageText,
        unfurl_links: false,
        unfurl_media: false,
      });
      const ts: string = trackingResult.ts || "";
      const messageUrl = ts
        ? `https://formic.slack.com/archives/${PARTS_TRACKING_CHANNEL}/p${ts.replace(".", "")}`
        : null;

      // Create Airtable record in partsrequests table (non-blocking — don't fail the request)
      const humanName = submitterEmail.split("@")[0].split(".").map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
      createPartsOrderRecord({
        ticketNumber: ticket.ticketNumber || `ISR-${ticket.id}`,
        customerName: ticket.customerName || undefined,
        csChannelId: csChannelId || undefined,
        asaOrSysNumber: asaOrSysNumber || undefined,
        vendorPartNumber: vendorPartNumber || undefined,
        partDescription: partDescription || undefined,
        needByDate: needByDate || undefined,
        workOrderNumber: workOrderNumber || undefined,
        submittedByName: humanName,
        submittedBySlackId: submitterSlackId || undefined,
        slackThreadUrl: messageUrl || undefined,
      }).catch((err: any) => console.error("[Airtable] Parts order record error:", err.message));

      res.json({ success: true, messageUrl, workflowUrl });
    } catch (err: any) {
      const errCode = err?.data?.error || err?.message || "unknown_error";
      if (errCode === "not_in_channel" || errCode === "channel_not_found") {
        res.status(400).json({ message: "Slack bot is not a member of that channel. Please invite @FormicBot first." });
      } else {
        res.status(500).json({ message: `Failed to send parts order to Slack: ${errCode}` });
      }
    }
  });

  app.get("/api/slack/members", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const members = await getSlackMembers();
      res.json(members);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch Slack members" });
    }
  });

  app.get("/api/slack/channels", isAuthenticated, requireFormicEmail, async (_req, res) => {
    try {
      const tickets = await storage.getTickets();
      const channelIds = [...new Set(tickets.map((t) => t.csChannel).filter(Boolean) as string[])];
      const channels = await getSlackChannelNamesForIds(channelIds);
      res.json(channels);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to fetch Slack channels" });
    }
  });

  // Test DM endpoint — sends a sample Slack DM to verify the enriched system ID label format
  app.post("/api/slack/test-dm", isAuthenticated, requireFormicEmail, async (req: any, res) => {
    try {
      const { userName } = req.body as { userName?: string };
      if (!userName) return res.status(400).json({ message: "userName is required" });

      const targetId = await lookupSlackUserId(userName);
      if (!targetId) return res.status(404).json({ message: `Slack user not found: ${userName}` });

      // Use a real ticket for the sample, or fall back to a dummy
      const sampleTickets = await storage.getTickets();
      const sample = sampleTickets.find(t => t.systemId) || sampleTickets[0];

      function buildLabel(id: string): string {
        const meta = getSystemMetaEntry(id);
        if (!meta) return id;
        let label = id;
        if (meta.region) label += ` — (${meta.region})`;
        if (meta.alias) label += ` — ${meta.alias}`;
        if (meta.vendor) label += ` — ${meta.vendor}`;
        return label;
      }

      const systemLabel = sample?.systemId ? buildLabel(sample.systemId) : "EXAMPLE_SYS1 — (98-SEA) — Sample Alias — Formic";
      const ticketRef = sample ? (sample.ticketNumber || `#${sample.id}`) : "ISR-0000";
      const appDomain = process.env.REPLIT_DOMAINS;
      const ticketLink = appDomain && sample ? `https://${appDomain}/?ticket=${sample.id}` : null;
      const headerLine = ticketLink ? `*<${ticketLink}|${ticketRef}>* ${sample?.priorityLabel || "FO: P2"}` : `*${ticketRef}*`;

      const text = [
        `🧪 *[Test DM] Enriched System ID Format Verification*`,
        ``,
        `*Inbound Support Request*`,
        headerLine,
        sample?.description || "Test ticket description.",
        ``,
        `*System ID:* ${systemLabel}`,
        `*Comms direction:* ${sample?.commsDirection || "Inbound"}`,
        sample?.contactName ? `*Customer Contact:* ${sample.contactName}` : null,
        `*Date:* ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
        ``,
        `_This is a test DM. If the System ID line above shows region, alias, and vendor — the fix is working correctly._`,
      ].filter(v => v !== null).join("\n");

      const slack = await getUncachableSlackClient();
      // Post directly to user ID — avoids needing im:write scope
      await slack.chat.postMessage({ channel: targetId, text, unfurl_links: false, unfurl_media: false });

      res.json({ ok: true, sentTo: userName, slackId: targetId, systemLabel });
    } catch (err: any) {
      console.error("test-dm error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/slack/command", async (req: any, res) => {
    console.log(`[command] received: command=${req.body?.command} user=${req.body?.user_name}`);
    const appUrl = process.env.APP_URL ||
      `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    return res.json({
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":ticket: *Open the ISR Ticket Tracker to create a new ticket:*",
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Open Ticket Tracker", emoji: true },
            url: appUrl,
            action_id: "open_app",
          },
        },
      ],
    });
  });

  // ── Slack Events API — app_mention → append to Next Parking Lot ─────────
  const processedSlackEventIds = new Set<string>();

  app.post("/api/slack/events", async (req: any, res) => {
    const body = req.body;

    // URL verification handshake (Slack sends this when you first configure the endpoint)
    if (body?.type === "url_verification") {
      return res.json({ challenge: body.challenge });
    }

    // ACK immediately — Slack requires a response within 3 seconds
    res.status(200).send();

    if (body?.type !== "event_callback") return;
    const event = body.event;
    // Handle app_mention (in channels) and message.im (direct messages to the bot)
    const isAppMention = event?.type === "app_mention";
    const isDm = event?.type === "message" && event?.channel_type === "im" && !event?.bot_id;
    if (!event || (!isAppMention && !isDm)) return;

    // Deduplicate retries using Slack's event_id
    const eventId: string | undefined = body.event_id;
    if (eventId) {
      if (processedSlackEventIds.has(eventId)) return;
      processedSlackEventIds.add(eventId);
      if (processedSlackEventIds.size > 500) {
        processedSlackEventIds.delete(processedSlackEventIds.values().next().value!);
      }
    }

    const channel: string = event.channel;
    const replyTs: string = event.thread_ts || event.ts;
    const senderSlackId: string = event.user;

    // Strip only the bot's own mention from the message; preserve all other
    // <@USERID> tokens so they get resolved to readable names below.
    const botUserId = await getBotUserId();
    const botPattern = botUserId
      ? new RegExp(`<@${botUserId}>`, "g")
      : /<@[A-Z0-9]+>/g; // fallback: strip all mentions if bot ID unknown
    const rawText = (event.text || "").replace(botPattern, "").trim();
    if (!rawText) return;

    try {
      const reviews = await storage.getDailyReviews();
      if (!reviews.length) throw new Error("No daily reviews found");

      // Resolve all remaining <@USERID> and <#CHANNELID> tokens to readable names
      const resolvedText = await resolveSlackMentions(rawText);

      // Resolve the sender's ID to their display name
      const senderLabel = await resolveSlackMentions(`<@${senderSlackId}>`);

      const latest = reviews[0];
      const sections = { ...(latest.sections as Record<string, string>) };
      const existing = (sections.nextParkingLot || "").trimEnd();
      const newLine = `• ${senderLabel}: ${resolvedText}`;
      sections.nextParkingLot = existing ? `${existing}\n${newLine}` : newLine;

      await storage.updateDailyReview(latest.date, sections as any, "slack-mention");
      console.log(`[slack-events] app_mention → nextParkingLot appended for ${latest.date}`);

      const slack = await getUncachableSlackClient();
      await slack.chat.postMessage({
        channel,
        thread_ts: replyTs,
        text: `✅ Added to *Next Parking Lot* in the ${latest.date} daily review.`,
      });
    } catch (err: any) {
      console.error("[slack-events] app_mention failed:", err.message || err);
      try {
        const slack = await getUncachableSlackClient();
        await slack.chat.postMessage({
          channel,
          thread_ts: replyTs,
          text: "❌ Couldn't add to Next Parking Lot — please try again.",
        });
      } catch {}
    }
  });

  app.post("/api/slack/interactions", async (req: any, res) => {
    try {
      const rawPayload = req.body?.payload;
      if (!rawPayload) return res.status(400).send("Missing payload");
      const payload = JSON.parse(rawPayload);

      console.log(`[interactions] type=${payload.type} callback=${payload.callback_id || payload.view?.callback_id || "none"} action=${payload.actions?.[0]?.action_id || "none"}`);

      const SHORTCUT_CALLBACKS = ["new_ticket", "new_isr_ticket", "ISR2_ticket", "/Ticket", "Ticket"];
      if (payload.type === "shortcut" && SHORTCUT_CALLBACKS.includes(payload.callback_id)) {
        res.status(200).send();
        const responseUrl = payload.response_url;
        const userId = payload.user?.id;
        const linkBlock = {
          type: "section",
          text: { type: "mrkdwn", text: ":ticket: *Open the ISR Ticket Tracker to create a new ticket:*" },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "Open Ticket Tracker", emoji: true },
            url: process.env.APP_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`,
            action_id: "open_app",
          },
        };
        try {
          if (responseUrl) {
            await fetch(responseUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ response_type: "ephemeral", blocks: [linkBlock] }),
            });
          } else if (userId) {
            const slack = await getUncachableSlackClient();
            await (slack as any).chat.postMessage({ channel: userId, blocks: [linkBlock] });
          }
        } catch (e: any) {
          console.error("[shortcut] FAILED:", e.message || e, JSON.stringify((e as any).data || {}));
        }
        return;
      }

      if (payload.type === "block_suggestion" && payload.action_id === "customer_select") {
        const query = (payload.value || "").toLowerCase().trim();
        try {
          const customers = await getCustomerNames().catch((err) => {
            console.error("[block_suggestion] getCustomerNames failed:", err.message);
            return null;
          });
          
          let finalCustomers = customers || [];
          
          // Fallback to ticket history if Airtable fails
          if (finalCustomers.length === 0) {
            const allTickets = await getTicketsForModal(storage);
            finalCustomers = [...new Set(
              allTickets.map((t: any) => t.customerName).filter(Boolean)
            )].sort();
            console.log("[block_suggestion] Fell back to ticket history, got", finalCustomers.length, "customers");
          } else {
            console.log("[block_suggestion] Got", finalCustomers.length, "customers from Airtable");
          }
          
          const filtered = query
            ? finalCustomers.filter((c: string) => c.toLowerCase().includes(query))
            : finalCustomers;
          const options = filtered.slice(0, 100).map((c: string) => ({
            text: { type: "plain_text", text: c },
            value: c,
          }));
          console.log("[block_suggestion] Returning", options.length, "options for query:", query);
          return res.status(200).json({ options });
        } catch (e: any) {
          console.error("[block_suggestion] error:", e.message);
          return res.status(200).json({ options: [] });
        }
      }

      if (payload.type === "block_actions" && payload.view?.callback_id === "new_ticket_modal") {
        res.status(200).json({});
        const action = payload.actions?.[0];
        const viewId = payload.view?.id;
        console.log(`[block_actions] action_id=${action?.action_id} view_id=${viewId}`);
        if (action?.action_id === "customer_select") {
          const selectedCustomer = action?.selected_option?.value || null;
          console.log(`[block_actions] customer selected: ${selectedCustomer}`);
          try {
            const [slack, allTickets, customerContacts, systems] = await Promise.all([
              getUncachableSlackClient(),
              getTicketsForModal(storage),
              selectedCustomer ? fetchCustomerContacts() : Promise.resolve({} as Record<string, import("./airtable").CustomerContact[]>),
              selectedCustomer ? fetchSystemsForCustomer(selectedCustomer) : Promise.resolve([]),
            ]);
            const toOpt = (text: string, value: string) => ({ text: { type: "plain_text" as const, text }, value });
            const systemIdOptions = systems.length > 0
              ? systems.map((s) => toOpt(s.label, s.systemId))
              : undefined;
            const contacts = selectedCustomer && customerContacts[selectedCustomer]
              ? customerContacts[selectedCustomer]
              : [];
            const contactOptions = contacts.length > 0
              ? contacts.map((c) => toOpt(c.name, c.name))
              : undefined;
            const modal = await buildNewTicketModal(allTickets, { selectedCustomer, systemIdOptions, contactOptions });
            const result: any = await slack.views.update({
              view_id: viewId,
              view: modal as any,
            });
            console.log(`[block_actions] views.update ok=${result.ok} systems=${systems.length} contacts=${contacts.length}`);
          } catch (e: any) {
            console.error(`[block_actions] views.update failed: ${e.message}`);
          }
        }
        return;
      }

      if (payload.type === "view_submission" && payload.view?.callback_id === "new_ticket_modal") {
        res.status(200).json({ response_action: "clear" });

        const v = payload.view.state.values;
        const customerName = v["block_customer"]?.["customer_select"]?.selected_option?.value || "";

        const systemId = v["block_system_id"]?.["system_id_select"]?.selected_option?.value || "";
        const contactName = v["block_contact"]?.["contact_select"]?.selected_option?.value || null;
        const contactEmail = v["block_contact_email"]?.["contact_email_input"]?.value || null;
        const contactPhone = v["block_contact_phone"]?.["contact_phone_input"]?.value || null;
        const commsDirection = v["block_comms"]?.["comms_select"]?.selected_option?.value || "Inbound";
        const manualTitle = v["block_title"]?.["title_input"]?.value || "";
        const description = v["block_description"]?.["desc_input"]?.value || "";
        const priorityLabel = v["block_priority"]?.["priority_select"]?.selected_option?.value || "";
        const nextUpdateDateStr = v["block_next_update"]?.["next_update_date"]?.selected_date || null;
        const escalationSource = v["block_source"]?.["source_select"]?.selected_option?.value || "Other";
        const assigneeName = v["block_assignee"]?.["assignee_select"]?.selected_option?.value || null;
        const slackUserName = payload.user?.name || payload.user?.username || "";

        const estimatedNextUpdate = nextUpdateDateStr ? new Date(nextUpdateDateStr + "T17:00:00Z") : null;

        let priority = "medium";
        if (/P1/.test(priorityLabel)) priority = "high";
        else if (/P3|P4/.test(priorityLabel)) priority = "low";

        let csChannel: string | null = null;
        let resolvedContactEmail: string | null = contactEmail;
        let resolvedContactPhone: string | null = contactPhone;
        if (customerName) {
          const allTickets = await storage.getTickets();
          const match = allTickets.find(t => t.customerName === customerName && t.csChannel);
          if (match) {
            csChannel = match.csChannel;
            if (!resolvedContactEmail && match.contactEmail) resolvedContactEmail = match.contactEmail;
            if (!resolvedContactPhone && match.contactPhone) resolvedContactPhone = match.contactPhone;
          }
        }

        let ticket = await storage.createTicket({
          title: manualTitle || description.split("\n")[0].slice(0, 120) || `${customerName} Support Request`,
          description,
          customerName,
          systemId,
          priorityLabel,
          priority,
          assigneeName,
          commsDirection,
          escalationSource,
          contactName,
          csChannel,
          contactEmail: resolvedContactEmail,
          contactPhone: resolvedContactPhone,
          estimatedNextUpdate,
          status: "open",
          submittedAt: new Date(),
          nextStepsHistory: [{
            text: "Ticket created",
            updatedBy: slackUserName || "Slack",
            updatedAt: new Date().toISOString(),
          }],
        });

        const updates: Record<string, any> = {};

        if (!manualTitle) {
          try {
            const aiTitle = await generateTitleSummary(ticket.description);
            if (aiTitle) updates.title = aiTitle;
          } catch {}
        }

        const airtableFields: Record<string, any> = { description: ticket.description };
        if (ticket.priorityLabel) airtableFields.priority = ticket.priorityLabel;
        if (ticket.assigneeName) airtableFields.assignee_name = ticket.assigneeName;
        if (slackUserName) airtableFields.submitter_name = slackUserName;
        if (ticket.commsDirection) airtableFields.comms_direction = ticket.commsDirection;
        if (ticket.escalationSource) airtableFields.receipt_method = ticket.escalationSource;

        if (ticket.customerName) {
          try {
            const custRecordId = await getCustomerRecordId(ticket.customerName);
            if (custRecordId) {
              airtableFields.customer = [custRecordId];
              const siteRecordId = await getSiteRecordId(custRecordId, ticket.systemId, ticket.csChannel);
              if (siteRecordId) airtableFields.site = [siteRecordId];
            }
          } catch {}
        }
        if (ticket.systemId) {
          try {
            const asaRecordId = await getAsaRecordId(ticket.systemId);
            if (asaRecordId) airtableFields.asa = [asaRecordId];
          } catch (e: any) { console.error("[ASA] getAsaRecordId failed:", e.message); }
        }
        if (ticket.contactName) {
          try {
            const contactRecordId = await getContactRecordId(ticket.contactName);
            if (contactRecordId) airtableFields.contact = [contactRecordId];
          } catch {}
        }

        let wfAssigneeSlackId: string | null = null;
        let wfSubmitterSlackId: string | null = null;
        try {
          const [assigneeId, submitterId] = await Promise.all([
            ticket.assigneeName ? lookupSlackUserId(ticket.assigneeName) : Promise.resolve(null),
            slackUserName ? lookupSlackUserId(slackUserName) : Promise.resolve(null),
          ]);
          if (assigneeId) { airtableFields.assignee = assigneeId; airtableFields.notify = assigneeId; }
          if (submitterId) airtableFields.submitter = submitterId;
          wfAssigneeSlackId = assigneeId || null;
          wfSubmitterSlackId = submitterId || null;
        } catch (err: any) {
          console.warn("Failed to resolve Slack user IDs for Slack-created ticket:", err.message || err);
        }

        try {
          const record = await createAirtableRecord(airtableFields);
          const mapped = mapAirtableToTicket(record);
          updates.airtableRecordId = record.id;
          if (mapped.ticketNumber) updates.ticketNumber = mapped.ticketNumber;
          if (mapped.csChannel) updates.csChannel = mapped.csChannel;
          if (mapped.customerName && !ticket.customerName) updates.customerName = mapped.customerName;
          if (mapped.contactName && !ticket.contactName) updates.contactName = mapped.contactName;
          if (mapped.contactEmail) updates.contactEmail = mapped.contactEmail;
          if (mapped.contactPhone) updates.contactPhone = mapped.contactPhone;
          try { await updateAirtableRecord(record.id, { record_id_slack: record.id }); } catch {}
        } catch (err: any) {
          console.error("Airtable create failed (Slack workflow):", err.message || err);
        }

        if (Object.keys(updates).length > 0) {
          const updated = await storage.updateTicket(ticket.id, updates);
          if (updated) ticket = updated;
        }

        try {
          if (ticket.csChannel) {
            const dupCheck = await checkSlackDuplicate(ticket);
            if (dupCheck.skip) {
              if (dupCheck.existingThreadId) {
                await storage.updateTicket(ticket.id, { slackMessageId: dupCheck.existingThreadId });
              }
              console.log(`[SlackModal] Skipped duplicate Slack post for ticket id=${ticket.id} (${ticket.ticketNumber ?? "no ISR#"})`);
            } else {
              const slackResult = await postTicketToSlack(ticket, slackUserName || undefined, wfAssigneeSlackId, wfSubmitterSlackId);
              if (slackResult) {
                const { ts: slackTs, channel: usedChannel } = slackResult;
                await storage.updateTicket(ticket.id, { slackMessageId: slackTs, csChannel: usedChannel });
                // DM the assignee
                if (wfAssigneeSlackId) {
                  const channelId = usedChannel.replace(/^#/, "");
                  const slackPermalink = `https://formic.slack.com/archives/${channelId}/p${slackTs.replace(".", "")}`;
                  postAssigneeDm({ ...ticket, csChannel: usedChannel }, wfAssigneeSlackId, slackPermalink).catch(() => {});
                }
              } else if (wfAssigneeSlackId) {
                postAssigneeDm(ticket, wfAssigneeSlackId, null).catch(() => {});
              }
            }
          }
        } catch (err: any) {
          console.error("Slack post failed (Slack workflow):", err.message || err);
        }

        return;
      }

      res.status(200).send();
    } catch (err: any) {
      console.error("Slack interactions error:", err.message || err);
      res.status(500).send();
    }
  });

  // Pre-warm caches so the Slack trigger_id window (3s) isn't eaten by cold starts
  Promise.all([
    getTicketsForModal(storage).then(() => console.log("[startup] ticket cache pre-warmed")),
    getUncachableSlackClient().then(() => console.log("[startup] Slack token pre-warmed")),
  ]).catch(e => console.error("[startup] pre-warm failed:", e.message));

  // ── External API (API-key authenticated) ─────────────────────────────────
  function requireApiKey(req: any, res: any, next: any) {
    const apiKey = process.env.ISR_API_KEY;
    if (!apiKey) return res.status(503).json({ message: "External API not configured" });
    const auth = req.headers["authorization"] || "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-api-key"];
    if (!provided || provided !== apiKey) return res.status(401).json({ message: "Invalid API key" });
    next();
  }

  // POST /api/external/ticket  — create a new ISR ticket from another app
  app.post("/api/external/ticket", requireApiKey, async (req: any, res) => {
    try {
      const {
        title,
        description,
        customerName,
        systemId,
        contactName,
        priorityLabel = "P3",
        escalationSource = "External",
        commsDirection = "Inbound",
        colAssignee,
        status = "open",
      } = req.body;

      if (!description || !customerName || !contactName) {
        return res.status(400).json({ message: "description, customerName, and contactName are required" });
      }

      const ticket = await storage.createTicket({
        title: title || description.slice(0, 120),
        description,
        customerName: customerName || null,
        systemId: systemId || null,
        contactName: contactName || null,
        priorityLabel: priorityLabel || null,
        escalationSource: escalationSource || null,
        commsDirection: commsDirection || null,
        assigneeName: colAssignee || null,
        status,
        notifyNames: [],
        csChannel: null,
        airtableRecordId: null,
        ticketNumber: null,
      } as any);

      console.log(`[external-api] ticket created: ${ticket.id} - ${ticket.title || description.slice(0, 40)}`);
      res.status(201).json({ id: ticket.id, ticketNumber: ticket.ticketNumber, title: ticket.title });
    } catch (err: any) {
      console.error("[external-api] ticket create failed:", err.message);
      res.status(500).json({ message: err.message || "Failed to create ticket" });
    }
  });

  // PATCH /api/external/daily-review/next-parking-lot  — append text to today's Next Parking Lot
  app.patch("/api/external/daily-review/next-parking-lot", requireApiKey, async (req: any, res) => {
    try {
      const { text, separator = "\n" } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ message: "text is required" });
      }

      const today = new Date().toISOString().slice(0, 10);
      const reviews = await storage.getDailyReviews();
      if (!reviews.length) {
        return res.status(404).json({ message: "No daily reviews found" });
      }
      // Use the most recent review
      const latest = reviews[0];
      const sections = { ...(latest.sections as Record<string, string>) };
      const existing = sections.nextParkingLot || "";
      sections.nextParkingLot = existing ? `${existing}${separator}${text}` : text;

      const updated = await storage.updateDailyReview(latest.date, sections as any, "external-api");
      console.log(`[external-api] daily-review/${latest.date} nextParkingLot appended`);
      res.json({ date: latest.date, nextParkingLot: sections.nextParkingLot });
    } catch (err: any) {
      console.error("[external-api] daily-review update failed:", err.message);
      res.status(500).json({ message: err.message || "Failed to update daily review" });
    }
  });
  // ── End External API ─────────────────────────────────────────────────────

  // ── Analytics: Priority History ───────────────────────────────────────────

  // GET /api/tickets/:id/priority-history
  app.get("/api/tickets/:id/priority-history", isAuthenticated, requireFormicEmail, async (req, res) => {
    const ticketId = parseInt(req.params.id);
    const rows = await db.execute(sql`
      SELECT id, ticket_id, priority_label, started_at, ended_at
      FROM ticket_priority_history
      WHERE ticket_id = ${ticketId}
      ORDER BY started_at ASC
    `);
    res.json(rows.rows);
  });

  // GET /api/analytics/priority-by-week — last 12 weeks, avg hours per priority
  app.get("/api/analytics/priority-by-week", isAuthenticated, requireFormicEmail, async (_req, res) => {
    // For each ISO week over the last 12 weeks:
    //   For each open priority-history record that overlaps that week:
    //     Compute how many hours of the record fall inside the [weekStart, weekEnd] window (cap at 168h)
    //   Average those hour values per priority label
    const rows = await db.execute(sql`
      WITH weeks AS (
        SELECT
          gs::date AS week_start,
          (gs + interval '6 days 23 hours 59 minutes 59 seconds')::timestamp AS week_end,
          to_char(gs, 'YYYY-MM-DD') AS week_label
        FROM generate_series(
          date_trunc('week', now() - interval '11 weeks'),
          date_trunc('week', now()) - interval '1 week',
          interval '1 week'
        ) gs
      ),
      week_overlaps AS (
        SELECT
          w.week_label,
          w.week_start,
          w.week_end,
          h.ticket_id,
          h.priority_label,
          GREATEST(h.started_at, w.week_start::timestamp) AS overlap_start,
          LEAST(COALESCE(h.ended_at, now()), w.week_end) AS overlap_end
        FROM weeks w
        JOIN ticket_priority_history h
          ON h.started_at < w.week_end
         AND COALESCE(h.ended_at, now()) > w.week_start::timestamp
        WHERE h.priority_label IS NOT NULL
      ),
      hours_per_ticket AS (
        SELECT
          week_label,
          ticket_id,
          priority_label,
          LEAST(
            EXTRACT(EPOCH FROM (overlap_end - overlap_start)) / 3600.0,
            168.0
          ) AS hours_in_week
        FROM week_overlaps
        WHERE overlap_end > overlap_start
      )
      SELECT
        week_label,
        priority_label,
        ROUND(AVG(hours_in_week)::numeric, 2) AS avg_hours,
        COUNT(DISTINCT ticket_id) AS ticket_count
      FROM hours_per_ticket
      GROUP BY week_label, priority_label
      ORDER BY week_label, priority_label
    `);
    res.json(rows.rows);
  });

  // GET /api/analytics/priority-stats-7d — avg time at current priority for open FO tickets
  // Counts and averages are computed directly from the tickets table so the card matches the filter view.
  app.get("/api/analytics/priority-stats-7d", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const rows = await db.execute(sql`
      WITH candidates AS (
        -- Open tickets + tickets closed in the last 7 days, FO priority only
        SELECT
          t.id,
          t.priority_label,
          t.submitted_at,
          t.created_at,
          t.resolved_at,
          t.updated_at,
          t.status
        FROM tickets t
        WHERE t.priority_label IS NOT NULL
          AND t.priority_label LIKE 'FO: %'
          AND (
            t.status = 'open'
            OR (
              t.status = 'closed'
              AND t.resolved_at >= now() - interval '7 days'
            )
          )
      ),
      with_duration AS (
        -- For open tickets: time at current priority (history started_at fallback submitted_at/created_at).
        -- For closed tickets: total time ticket was open using submitted_at (not created_at which is DB insert time).
        SELECT
          c.id,
          c.priority_label,
          c.status,
          GREATEST(0, EXTRACT(EPOCH FROM (
            CASE WHEN c.status = 'open'
              THEN now() - COALESCE(h.started_at, c.submitted_at, c.created_at)
              ELSE COALESCE(c.resolved_at, now()) - COALESCE(c.submitted_at, c.created_at)
            END
          )) / 3600.0) AS hours_at_priority
        FROM candidates c
        LEFT JOIN ticket_priority_history h
          ON h.ticket_id = c.id
          AND h.priority_label = c.priority_label
          AND h.ended_at IS NULL
      )
      SELECT
        priority_label,
        ROUND(AVG(hours_at_priority)::numeric, 2)                              AS avg_hours,
        ROUND(AVG(hours_at_priority / 24.0)::numeric, 3)                       AS avg_days,
        COUNT(*)::int                                                           AS ticket_count,
        COUNT(CASE WHEN status = 'open' THEN 1 END)::int                       AS open_count
      FROM with_duration
      GROUP BY priority_label
      ORDER BY priority_label
    `);
    res.json(rows.rows);
  });

  // GET /api/analytics/by-user — avg open days per assignee (open tickets only)
  app.get("/api/analytics/by-user", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const rows = await db.execute(sql`
      SELECT
        assignee_name,
        COUNT(*) AS ticket_count,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (
              now() - COALESCE(submitted_at, created_at)
            )) / 3600.0
          )::numeric,
          1
        ) AS avg_open_hours,
        ROUND(
          AVG(
            EXTRACT(EPOCH FROM (
              now() - COALESCE(submitted_at, created_at)
            )) / 86400.0
          )::numeric,
          1
        ) AS avg_open_days
      FROM tickets
      WHERE status = 'open'
        AND assignee_name IS NOT NULL
        AND assignee_name != ''
      GROUP BY assignee_name
      ORDER BY avg_open_hours DESC
    `);
    res.json(rows.rows);
  });

  // GET /api/analytics/created-by-person — ticket creation counts per submitter
  app.get("/api/analytics/created-by-person", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const now = new Date();
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await db.execute(sql`
      SELECT
        submitted_by AS name,
        COUNT(*) FILTER (WHERE COALESCE(submitted_at, created_at) >= ${cutoff7d}) AS count_7d,
        COUNT(*) FILTER (WHERE COALESCE(submitted_at, created_at) >= ${cutoff30d}) AS count_30d,
        COUNT(*) AS count_all
      FROM tickets
      WHERE submitted_by IS NOT NULL
        AND submitted_by NOT IN ('External', 'Unknown', '')
        AND trim(submitted_by) <> ''
      GROUP BY submitted_by
      ORDER BY count_all DESC
    `);

    // Build first-name deduplication map across all names in the result
    const allNames: string[] = rows.rows.map((r: any) => r.name as string);
    const firstNameCount = new Map<string, number>();
    for (const fullName of allNames) {
      const first = fullName.split(' ')[0];
      firstNameCount.set(first, (firstNameCount.get(first) ?? 0) + 1);
    }
    function displayName(fullName: string): string {
      const parts = fullName.split(' ');
      if (parts.length < 2) return fullName;
      const first = parts[0];
      const last = parts[parts.length - 1];
      return (firstNameCount.get(first) ?? 1) > 1
        ? `${first} ${last[0]}.`
        : first;
    }

    res.json(rows.rows.map((r: any) => ({
      name: displayName(r.name),
      count7d: Number(r.count_7d),
      count30d: Number(r.count_30d),
      countAll: Number(r.count_all),
    })));
  });

  // GET /api/analytics/raw-regions — distinct raw region codes (no grouping)
  app.get("/api/analytics/raw-regions", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const rows = await db.execute(sql`
      SELECT DISTINCT region FROM tickets
      WHERE region IS NOT NULL AND trim(region) <> ''
      ORDER BY region
    `);
    res.json((rows.rows as any[]).map(r => r.region as string));
  });

  // ── Region Groups CRUD (admin: jmoure@formic.co only) ────────────────────
  const isRegionAdmin = (req: any) => {
    const email: string = req.user?.claims?.email ?? "";
    return email === "jmoure@formic.co";
  };

  app.get("/api/region-groups", isAuthenticated, requireFormicEmail, async (_req, res) => {
    const groups = await db.select().from(regionGroups).orderBy(regionGroups.id);
    res.json(groups);
  });

  app.post("/api/region-groups", isAuthenticated, requireFormicEmail, async (req, res) => {
    if (!isRegionAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    const parsed = insertRegionGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const [row] = await db.insert(regionGroups).values(parsed.data).returning();
    res.json(row);
  });

  app.put("/api/region-groups/:id", isAuthenticated, requireFormicEmail, async (req, res) => {
    if (!isRegionAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    const id = Number(req.params.id);
    const parsed = insertRegionGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const [row] = await db.update(regionGroups).set(parsed.data).where(eq(regionGroups.id, id)).returning();
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  });

  app.delete("/api/region-groups/:id", isAuthenticated, requireFormicEmail, async (req, res) => {
    if (!isRegionAdmin(req)) return res.status(403).json({ message: "Forbidden" });
    const id = Number(req.params.id);
    await db.delete(regionGroups).where(eq(regionGroups.id, id));
    res.json({ ok: true });
  });

  // GET /api/analytics/by-region — ticket count + avg open time per region (all tickets)
  // Applies region_groups: grouped regions are merged under their display name
  app.get("/api/analytics/by-region", isAuthenticated, requireFormicEmail, async (req, res) => {
    const days = Number(req.query.days) || 0;
    const [rawRows, groups] = await Promise.all([
      days > 0
        ? db.execute(sql`
            SELECT
              region,
              COUNT(*) AS ticket_count,
              ROUND(
                AVG(
                  EXTRACT(EPOCH FROM (
                    COALESCE(resolved_at, NOW()) - COALESCE(submitted_at, created_at)
                  )) / 3600.0
                ) FILTER (WHERE status = 'closed' AND resolved_at IS NOT NULL)
              ) AS avg_hours_closed,
              COUNT(*) FILTER (WHERE status = 'open') AS open_count,
              COUNT(*) FILTER (WHERE status = 'closed') AS closed_count
            FROM tickets
            WHERE region IS NOT NULL AND trim(region) <> ''
              AND COALESCE(submitted_at, created_at) >= NOW() - (${days} || ' days')::interval
            GROUP BY region
            ORDER BY ticket_count DESC
          `)
        : db.execute(sql`
            SELECT
              region,
              COUNT(*) AS ticket_count,
              ROUND(
                AVG(
                  EXTRACT(EPOCH FROM (
                    COALESCE(resolved_at, NOW()) - COALESCE(submitted_at, created_at)
                  )) / 3600.0
                ) FILTER (WHERE status = 'closed' AND resolved_at IS NOT NULL)
              ) AS avg_hours_closed,
              COUNT(*) FILTER (WHERE status = 'open') AS open_count,
              COUNT(*) FILTER (WHERE status = 'closed') AS closed_count
            FROM tickets
            WHERE region IS NOT NULL AND trim(region) <> ''
            GROUP BY region
            ORDER BY ticket_count DESC
          `),
      db.select().from(regionGroups),
    ]);

    // Build map: raw region code → group display name
    const regionToGroup: Record<string, string> = {};
    for (const g of groups) {
      for (const r of g.regions) regionToGroup[r] = g.displayName;
    }

    // Merge rows
    const merged: Record<string, { displayName: string; ticketCount: number; totalHoursClosed: number; closedWithTime: number; openCount: number; closedCount: number }> = {};
    for (const r of rawRows.rows as any[]) {
      const key = regionToGroup[r.region] ?? r.region;
      if (!merged[key]) merged[key] = { displayName: key, ticketCount: 0, totalHoursClosed: 0, closedWithTime: 0, openCount: 0, closedCount: 0 };
      const m = merged[key];
      m.ticketCount += Number(r.ticket_count);
      m.openCount += Number(r.open_count);
      m.closedCount += Number(r.closed_count);
      if (r.avg_hours_closed !== null) {
        m.totalHoursClosed += Number(r.avg_hours_closed) * Number(r.closed_count);
        m.closedWithTime += Number(r.closed_count);
      }
    }

    const result = Object.values(merged).sort((a, b) => b.ticketCount - a.ticketCount).map(m => ({
      region: m.displayName,
      ticketCount: m.ticketCount,
      avgHoursClosed: m.closedWithTime > 0 ? Math.round(m.totalHoursClosed / m.closedWithTime) : null,
      openCount: m.openCount,
      closedCount: m.closedCount,
    }));
    res.json(result);
  });

  // Startup: backfill priority history for tickets that have none
  ;(async () => {
    try {
      const missing = await db.execute(sql`
        SELECT t.id, t.priority_label, t.status, t.submitted_at, t.created_at, t.resolved_at
        FROM tickets t
        WHERE NOT EXISTS (
          SELECT 1 FROM ticket_priority_history h WHERE h.ticket_id = t.id
        )
        AND t.priority_label IS NOT NULL
        ORDER BY t.id
      `);
      if (missing.rows.length > 0) {
        console.log(`[priority-history] Backfilling ${missing.rows.length} tickets…`);
        for (const row of missing.rows as any[]) {
          const startedAt = row.submitted_at ? new Date(row.submitted_at) : row.created_at ? new Date(row.created_at) : new Date();
          const endedAt = row.status === "closed" && row.resolved_at ? new Date(row.resolved_at) : null;
          await db.insert(ticketPriorityHistory).values({
            ticketId: row.id,
            priorityLabel: row.priority_label,
            startedAt,
            endedAt,
          });
        }
        console.log(`[priority-history] Backfill complete`);
      }
    } catch (err: any) {
      console.warn("[priority-history] Backfill failed:", err.message);
    }
  })();

  return httpServer;
}

interface TicketFilterCache {
  allTickets: any[];
  fetchedAt: number;
}
let _ticketFilterCache: TicketFilterCache | null = null;

async function getTicketsForModal(storage: any): Promise<any[]> {
  const now = Date.now();
  if (_ticketFilterCache && now - _ticketFilterCache.fetchedAt < 10 * 60 * 1000) {
    return _ticketFilterCache.allTickets;
  }
  const allTickets = await storage.getTickets();
  _ticketFilterCache = { allTickets, fetchedAt: now };
  return allTickets;
}

function _modalHelpers(allTickets: any[]) {
  const uniq = (arr: (string | null | undefined)[]) =>
    [...new Set(arr.filter(Boolean) as string[])].sort();
  const toOpt = (val: string) => ({
    text: { type: "plain_text" as const, text: val.length > 75 ? val.slice(0, 72) + "..." : val },
    value: val.slice(0, 75),
  });
  const safeOpts = (arr: (string | null | undefined)[], fallback = "—") => {
    const opts = uniq(arr).slice(0, 100).map(toOpt);
    return opts.length > 0 ? opts : [toOpt(fallback)];
  };
  return { uniq, toOpt, safeOpts };
}

type SlackOption = { text: { type: "plain_text"; text: string }; value: string };

async function buildNewTicketModal(allTickets: any[], opts?: {
  selectedCustomer?: string | null;
  systemIdOptions?: SlackOption[];
  contactOptions?: SlackOption[];
}) {
  const selectedCustomer = opts?.selectedCustomer || null;
  const { safeOpts } = _modalHelpers(allTickets);

  const filtered = selectedCustomer
    ? allTickets.filter((t: any) => t.customerName === selectedCustomer)
    : allTickets;

  const systemIds = opts?.systemIdOptions ?? safeOpts(filtered.map((t: any) => t.systemId));
  const contacts = opts?.contactOptions ?? safeOpts(filtered.map((t: any) => t.contactName));
  const assignees = safeOpts(allTickets.map((t: any) => t.assigneeName));

  // Pre-fetch all customers for the static select
  let allCustomers = [...new Set(allTickets.map((t: any) => t.customerName).filter(Boolean) as string[])].sort();
  if (allCustomers.length === 0) {
    try {
      const fetchedCustomers = await getCustomerNames();
      allCustomers = fetchedCustomers;
      console.log("[buildNewTicketModal] Fetched", allCustomers.length, "customers from Airtable");
    } catch (err) {
      console.error("[buildNewTicketModal] Failed to fetch customers:", err);
    }
  } else {
    console.log("[buildNewTicketModal] Using", allCustomers.length, "customers from tickets");
  }
  const customerOptions = allCustomers.slice(0, 100).map((c: string) => ({
    text: { type: "plain_text" as const, text: c.length > 75 ? c.slice(0, 72) + "..." : c },
    value: c.slice(0, 75),
  }));
  console.log("[buildNewTicketModal] Creating modal with", customerOptions.length, "customer options");

  const priorityOptions: [string, string][] = [
    ["FO: P1: Down", "FO: P1: Down"],
    ["FO: P2: Degraded/Impacted", "FO: P2: Degraded/Impacted"],
    ["FO: P3: Adjust/Repair", "FO: P3: Adjust/Repair"],
    ["FO: P4: Improvement", "FO: P4: Improvement"],
    ["FO: P4: Monitor", "FO: P4: Monitor"],
    ["FO: P4: Parts", "FO: P4: Parts"],
    ["FO: P4: Recipe", "FO: P4: Recipe"],
    ["AT: P1: Down", "AT: P1: Down"],
    ["AT: P2: Degraded/Impacted", "AT: P2: Degraded/Impacted"],
    ["AT: P3: Adjust/Repair", "AT: P3: Adjust/Repair"],
    ["AT: P4: Improvement", "AT: P4: Improvement"],
    ["CS: P1: Down", "CS: P1: Down"],
    ["CS: P2: Degraded/Impacted", "CS: P2: Degraded/Impacted"],
    ["CS: P3: Adjust/Repair", "CS: P3: Adjust/Repair"],
    ["CS: P4: Comms", "CS: P4: Comms"],
    ["DL: P1: Down", "DL: P1: Down"],
    ["DL: P2: Degraded/Impacted", "DL: P2: Degraded/Impacted"],
    ["DL: P3: Adjust/Repair", "DL: P3: Adjust/Repair"],
    ["DL: P4: Customer", "DL: P4: Customer"],
    ["DL: P4: Install", "DL: P4: Install"],
    ["DL: P4: Monitor", "DL: P4: Monitor"],
    ["DL: P4: Software", "DL: P4: Software"],
    ["PD: P1: Down", "PD: P1: Down"],
    ["PD: P2: Degraded/Impacted", "PD: P2: Degraded/Impacted"],
    ["PD: P3: Adjust/Repair", "PD: P3: Adjust/Repair"],
    ["PD: P4: Improvement", "PD: P4: Improvement"],
  ];

  const sourceOptions = [
    "Support Phone Line (RingCentral)",
    "Support Email (support@formic.co)",
    "Direct Phone Call",
    "Direct Text / SMS",
    "Direct Email (user@formic.co)",
    "Internal",
    "Other",
  ];

  const systemHint = selectedCustomer
    ? `Showing systems for ${selectedCustomer}`
    : "Select a customer above — this list will auto-filter";

  return {
    type: "modal",
    callback_id: "new_ticket_modal",
    private_metadata: JSON.stringify({ customerName: selectedCustomer || "" }),
    title: { type: "plain_text", text: "New ISR Ticket", emoji: true },
    submit: { type: "plain_text", text: "Create Ticket", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "block_customer",
        dispatch_action: true,
        label: { type: "plain_text", text: "Customer", emoji: true },
        hint: { type: "plain_text", text: "System ID & Contact will auto-filter after you pick a customer" },
        element: {
          type: "static_select",
          action_id: "customer_select",
          placeholder: { type: "plain_text", text: "Type to search or select a customer..." },
          options: customerOptions,
          ...(selectedCustomer
            ? { initial_option: { text: { type: "plain_text", text: selectedCustomer }, value: selectedCustomer } }
            : {}),
        },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "block_system_id",
        label: { type: "plain_text", text: "Formic System ID", emoji: true },
        hint: { type: "plain_text", text: systemHint },
        element: {
          type: "static_select",
          action_id: "system_id_select",
          placeholder: { type: "plain_text", text: "Select option" },
          options: systemIds,
        },
      },
      {
        type: "input",
        block_id: "block_contact",
        label: { type: "plain_text", text: "Which contact?", emoji: true },
        element: {
          type: "static_select",
          action_id: "contact_select",
          placeholder: { type: "plain_text", text: "Select option" },
          options: contacts,
        },
      },
      {
        type: "input",
        block_id: "block_contact_email",
        optional: true,
        label: { type: "plain_text", text: "Contact email", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "contact_email_input",
          placeholder: { type: "plain_text", text: "Contact email" },
        },
      },
      {
        type: "input",
        block_id: "block_contact_phone",
        optional: true,
        label: { type: "plain_text", text: "Contact phone number", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "contact_phone_input",
          placeholder: { type: "plain_text", text: "Contact phone number" },
        },
      },
      {
        type: "input",
        block_id: "block_comms",
        label: { type: "plain_text", text: "Comms direction?", emoji: true },
        element: {
          type: "static_select",
          action_id: "comms_select",
          placeholder: { type: "plain_text", text: "Select option" },
          options: [
            { text: { type: "plain_text", text: "Inbound" }, value: "Inbound" },
            { text: { type: "plain_text", text: "Outbound" }, value: "Outbound" },
            { text: { type: "plain_text", text: "Internal" }, value: "Internal" },
          ],
        },
      },
      {
        type: "input",
        block_id: "block_title",
        label: { type: "plain_text", text: "Title", emoji: true },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "title_input",
          placeholder: { type: "plain_text", text: "Ticket title (or leave blank for AI-generated)" },
        },
      },
      {
        type: "input",
        block_id: "block_description",
        label: { type: "plain_text", text: "Enter description", emoji: true },
        hint: { type: "plain_text", text: "Description of issue including fault, current status, and next steps when possible" },
        element: {
          type: "plain_text_input",
          action_id: "desc_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "Description of issue including fault, current status, and next steps when possible" },
        },
      },
      {
        type: "input",
        block_id: "block_priority",
        label: { type: "plain_text", text: "What's the priority?", emoji: true },
        element: {
          type: "static_select",
          action_id: "priority_select",
          placeholder: { type: "plain_text", text: "Select option" },
          options: priorityOptions.map(([label, value]) => ({
            text: { type: "plain_text", text: label, emoji: true },
            value,
          })),
        },
      },
      {
        type: "input",
        block_id: "block_next_update",
        label: { type: "plain_text", text: "Estimated Next Update", emoji: true },
        element: {
          type: "datepicker",
          action_id: "next_update_date",
          placeholder: { type: "plain_text", text: "Select date" },
        },
      },
      {
        type: "input",
        block_id: "block_source",
        label: { type: "plain_text", text: "How did you receive this escalation?", emoji: true },
        element: {
          type: "static_select",
          action_id: "source_select",
          placeholder: { type: "plain_text", text: "Select option" },
          options: sourceOptions.map(s => ({
            text: { type: "plain_text", text: s, emoji: true },
            value: s,
          })),
        },
      },
      {
        type: "input",
        block_id: "block_assignee",
        label: { type: "plain_text", text: "Assignee (required)", emoji: true },
        element: {
          type: "static_select",
          action_id: "assignee_select",
          placeholder: { type: "plain_text", text: "Select option" },
          options: assignees,
        },
      },
    ],
  };
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
