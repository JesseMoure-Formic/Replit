import { pgTable, text, serial, timestamp, varchar, boolean, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";

export const systemAliases = pgTable("system_aliases", {
  systemId: varchar("system_id").primaryKey(),
  alias: text("alias").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SystemAlias = typeof systemAliases.$inferSelect;

export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isGlobal: boolean("is_global").notNull().default(false),
  userId: varchar("user_id"),
  filters: jsonb("filters").notNull().$type<{
    status?: string[];
    priority?: string[];
    assignee?: string[];
    customer?: string[];
    colCustomer?: string[];
    colPriority?: string[];
    colAssignee?: string[];
    region?: string[];
    systemId?: string[];
    escalationSource?: string[];
    commsDirection?: string[];
    titleSearch?: string;
    submittedFrom?: string;
    submittedTo?: string;
    nextUpdateFrom?: string;
    nextUpdateTo?: string;
    filterNoNextUpdate?: boolean;
    nextUpdateFilter?: "overdue" | "today" | "soon" | null;
    isrSearch?: string;
    dateFilterDays?: number | null;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSavedViewSchema = createInsertSchema(savedViews).omit({
  id: true, createdAt: true,
});

export type SavedView = typeof savedViews.$inferSelect;
export type InsertSavedView = z.infer<typeof insertSavedViewSchema>;

export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number"),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  priorityLabel: text("priority_label"),
  assigneeName: text("assignee_name"),
  customerName: text("customer_name"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  systemId: text("system_id"),
  workOrderNumber: varchar("work_order_number"),
  region: text("region"),
  csChannel: text("cs_channel"),
  commsDirection: text("comms_direction"),
  escalationSource: text("escalation_source"),
  resolution: text("resolution"),
  nextSteps: text("next_steps"),
  nextStepsHistory: jsonb("next_steps_history").$type<Array<{ text: string; updatedBy: string; updatedAt: string }>>(),
  estimatedNextUpdate: timestamp("estimated_next_update"),
  submittedAt: timestamp("submitted_at"),
  resolvedAt: timestamp("resolved_at"),
  notifyNames: text("notify_names").array().default([]),
  slackMessageId: varchar("slack_message_id"),
  airtableRecordId: varchar("airtable_record_id"),
  needsSupport: boolean("needs_support").default(false),
  partsNeeded: boolean("parts_needed").default(false),
  escalationLevel: text("escalation_level").notNull().default("Standard"),
  escalationHistory: jsonb("escalation_history").$type<Array<{ level: string; comment: string; escalatedBy: string; escalatedAt: string }>>(),
  issueBucketId: integer("issue_bucket_id"),
  solutionBucketId: integer("solution_bucket_id"),
  tags: text("tags").array().default([]),
  submittedBy: text("submitted_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertTicketSchema = createInsertSchema(tickets).omit({ 
  id: true, createdAt: true, updatedAt: true 
});

export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;

export type CreateTicketRequest = InsertTicket;
export type UpdateTicketRequest = Partial<InsertTicket>;
export type TicketResponse = Ticket;

export const issueBuckets = pgTable("issue_buckets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  count: integer("count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type IssueBucket = typeof issueBuckets.$inferSelect;
export type InsertIssueBucket = typeof issueBuckets.$inferInsert;

export const solutionBuckets = pgTable("solution_buckets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  count: integer("count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SolutionBucket = typeof solutionBuckets.$inferSelect;
export type InsertSolutionBucket = typeof solutionBuckets.$inferInsert;

export const emailTemplates = pgTable("email_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isGlobal: boolean("is_global").notNull().default(false),
  userId: varchar("user_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({
  id: true, createdAt: true,
});

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;

export const dailyReviews = pgTable("daily_reviews", {
  id: serial("id").primaryKey(),
  date: varchar("date", { length: 10 }).notNull().unique(),
  sections: jsonb("sections").notNull().$type<{
    p1p2Tickets: string;
    hyperCare: string;
    p3Tickets: string;
    confirmedInstalls: string;
    delayedInstalls: string;
    parkingLot: string;
    usefulLinks: string;
    connectivityConcerns: string;
    onCallRotation: string;
  }>(),
  snapshotP1P2Tickets: jsonb("snapshot_p1p2_tickets").$type<Array<{
    id: number;
    ticketNumber: string | null;
    title: string;
    priorityLabel: string | null;
    customerName: string | null;
    assigneeName: string | null;
    systemId: string | null;
    submittedAt: string | null;
  }>>(),
  snapshotInstalls: jsonb("snapshot_installs").$type<Array<{
    id: string;
    customer: string;
    systemId: string;
    installationStarts: string | null;
    projectManager: string;
    dplyFse: string;
    fseArrival: string | null;
  }>>(),
  snapshotStats: jsonb("snapshot_stats").$type<{
    totalOpen: number;
    byPriority: Record<string, number>;
    openedIn24h: number;
    openedIn7d: number;
    closedIn24h: number;
    closedIn7d: number;
    capturedAt: string;
  }>(),
  slackPostedAt: timestamp("slack_posted_at"),
  createdBy: varchar("created_by"),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDailyReviewSchema = createInsertSchema(dailyReviews).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type DailyReview = typeof dailyReviews.$inferSelect;
export type InsertDailyReview = z.infer<typeof insertDailyReviewSchema>;

export const appSettings = pgTable("app_settings", {
  key: varchar("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type AppSetting = typeof appSettings.$inferSelect;

export const syncCache = pgTable("sync_cache", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type").notNull(),
  lastRecordCount: serial("last_record_count"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type SyncCache = typeof syncCache.$inferSelect;

export const checkInTemplates = pgTable("check_in_templates", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  userName: varchar("user_name"),
  name: varchar("name").notNull(),
  content: text("content").notNull(),
  isGlobal: boolean("is_global").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCheckInTemplateSchema = createInsertSchema(checkInTemplates).omit({
  id: true, createdAt: true,
});

export type CheckInTemplate = typeof checkInTemplates.$inferSelect;
export type InsertCheckInTemplate = z.infer<typeof insertCheckInTemplateSchema>;

export const customerDirectory = pgTable("customer_directory", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  systemIds: text("system_ids").array().notNull().default([]),
  syncedAt: timestamp("synced_at").defaultNow(),
});

export type CustomerDirectoryEntry = typeof customerDirectory.$inferSelect;

export const customerDirectoryMeta = pgTable("customer_directory_meta", {
  id: serial("id").primaryKey(),
  lastSyncAt: timestamp("last_sync_at"),
  recordCount: integer("record_count").default(0),
  airtableChecksum: text("airtable_checksum"),
});

export const userRoles = pgTable("user_roles", {
  userId: varchar("user_id").primaryKey(),
  role: text("role").notNull().default("requester"),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by"),
});

export type UserRole = typeof userRoles.$inferSelect;

export const ticketPriorityHistory = pgTable("ticket_priority_history", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  priorityLabel: text("priority_label"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

export type TicketPriorityHistory = typeof ticketPriorityHistory.$inferSelect;

export const regionGroups = pgTable("region_groups", {
  id: serial("id").primaryKey(),
  displayName: text("display_name").notNull(),
  regions: text("regions").array().notNull(),
});

export const insertRegionGroupSchema = createInsertSchema(regionGroups).omit({ id: true });
export type InsertRegionGroup = z.infer<typeof insertRegionGroupSchema>;
export type RegionGroup = typeof regionGroups.$inferSelect;

export type RolePermissions = {
  canCloseTickets: boolean;
  canEditDailyReview: boolean;
  canGenerateDailyReport: boolean;
  canSuperEscalate: boolean;
  canCriticalEscalate: boolean;
};

export const ROLE_KEYS = ["admin", "manager", "agent", "requester"] as const;
export const BUILTIN_ROLES = new Set(["admin", "manager", "agent", "requester"]);
export type RoleKey = typeof ROLE_KEYS[number];

export const DEFAULT_ROLE_CONFIG: Record<RoleKey, { displayName: string; hierarchyOrder: number; permissions: RolePermissions }> = {
  admin:     { displayName: "Admin",     hierarchyOrder: 0, permissions: { canCloseTickets: true,  canEditDailyReview: true,  canGenerateDailyReport: true,  canSuperEscalate: true,  canCriticalEscalate: true  } },
  manager:   { displayName: "Manager",   hierarchyOrder: 1, permissions: { canCloseTickets: true,  canEditDailyReview: true,  canGenerateDailyReport: true,  canSuperEscalate: true,  canCriticalEscalate: false } },
  agent:     { displayName: "Agent",     hierarchyOrder: 2, permissions: { canCloseTickets: true,  canEditDailyReview: false, canGenerateDailyReport: false, canSuperEscalate: false, canCriticalEscalate: false } },
  requester: { displayName: "Requester", hierarchyOrder: 3, permissions: { canCloseTickets: false, canEditDailyReview: false, canGenerateDailyReport: false, canSuperEscalate: false, canCriticalEscalate: false } },
};

export const roleConfig = pgTable("role_config", {
  role: text("role").primaryKey(),
  displayName: text("display_name").notNull(),
  permissions: jsonb("permissions").notNull().$type<RolePermissions>(),
  hierarchyOrder: integer("hierarchy_order").notNull().default(99),
});

export type RoleConfig = typeof roleConfig.$inferSelect;

export const kvStore = pgTable("kv_store", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type KvEntry = typeof kvStore.$inferSelect;

export const smartSearchFails = pgTable("smart_search_fails", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  aiFilters: jsonb("ai_filters"),
  explanation: text("explanation"),
  userEmail: text("user_email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type SmartSearchFail = typeof smartSearchFails.$inferSelect;
