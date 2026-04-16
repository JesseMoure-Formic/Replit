import { db } from "./db";
import { 
  tickets,
  savedViews,
  emailTemplates,
  dailyReviews,
  appSettings,
  checkInTemplates,
  customerDirectory,
  customerDirectoryMeta,
  userRoles,
  smartSearchFails,
  issueBuckets,
  solutionBuckets,
  roleConfig,
  kvStore,
  type KvEntry,
  type Ticket,
  type CreateTicketRequest,
  type UpdateTicketRequest,
  type SavedView,
  type InsertSavedView,
  type EmailTemplate,
  type InsertEmailTemplate,
  type DailyReview,
  type InsertDailyReview,
  type CheckInTemplate,
  type CustomerDirectoryEntry,
  type SmartSearchFail,
  type IssueBucket,
  type SolutionBucket,
  type InsertIssueBucket,
  type InsertSolutionBucket,
  type RoleConfig,
  type RolePermissions,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { eq, or, isNull, desc, sql } from "drizzle-orm";

export interface IStorage {
  getTickets(): Promise<Ticket[]>;
  getTicket(id: number): Promise<Ticket | undefined>;
  createTicket(ticket: CreateTicketRequest): Promise<Ticket>;
  updateTicket(id: number, updates: UpdateTicketRequest): Promise<Ticket | undefined>;
  deleteTicket(id: number): Promise<boolean>;
  getSavedViews(userId: string): Promise<SavedView[]>;
  createSavedView(view: InsertSavedView): Promise<SavedView>;
  updateSavedView(id: number, userId: string, updates: { name?: string; isGlobal?: boolean; filters?: Record<string, any> }): Promise<SavedView | undefined>;
  deleteSavedView(id: number, userId: string): Promise<boolean>;
  getEmailTemplates(userId: string): Promise<EmailTemplate[]>;
  createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate>;
  updateEmailTemplate(id: number, userId: string, updates: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined>;
  deleteEmailTemplate(id: number, userId: string): Promise<boolean>;
  getDailyReviews(): Promise<DailyReview[]>;
  getDailyReview(date: string): Promise<DailyReview | undefined>;
  createDailyReview(review: InsertDailyReview): Promise<DailyReview>;
  updateDailyReview(date: string, sections: DailyReview["sections"], updatedBy: string): Promise<DailyReview | undefined>;
  snapshotDailyReview(date: string, snapshotP1P2Tickets: NonNullable<DailyReview["snapshotP1P2Tickets"]>, snapshotInstalls: NonNullable<DailyReview["snapshotInstalls"]>): Promise<void>;
  updateDailyReviewSnapshotStats(date: string, snapshotStats: NonNullable<DailyReview["snapshotStats"]>): Promise<void>;
  markDailyReviewSlackPosted(date: string): Promise<void>;
  deleteDailyReview(date: string): Promise<boolean>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getCheckInTemplates(userId: string): Promise<CheckInTemplate[]>;
  createCheckInTemplate(t: Omit<CheckInTemplate, "id" | "createdAt">): Promise<CheckInTemplate>;
  deleteCheckInTemplate(id: number, userId: string): Promise<boolean>;
  getCustomerDirectory(): Promise<CustomerDirectoryEntry[]>;
  upsertCustomerDirectory(entries: { name: string; systemIds: string[] }[]): Promise<number>;
  getCustomerDirectoryMeta(): Promise<{ lastSyncAt: Date | null; recordCount: number; airtableChecksum: string | null }>;
  updateCustomerDirectoryMeta(recordCount: number, checksum: string): Promise<void>;
  getUserRole(userId: string): Promise<string>;
  setUserRole(userId: string, role: string, updatedBy: string): Promise<void>;
  getAllUsersWithRoles(): Promise<Array<{ id: string; email: string | null; firstName: string | null; lastName: string | null; role: string }>>;
  logSmartSearchFail(entry: { query: string; aiFilters: any; explanation: string | null; userEmail: string | null }): Promise<void>;
  getRecentSmartSearchFails(limit?: number): Promise<SmartSearchFail[]>;
  getIssueBuckets(): Promise<IssueBucket[]>;
  createIssueBucket(bucket: InsertIssueBucket): Promise<IssueBucket>;
  incrementIssueBucketCount(id: number): Promise<void>;
  updateIssueBucket(id: number, data: Partial<InsertIssueBucket>): Promise<IssueBucket>;
  deleteIssueBucket(id: number): Promise<void>;
  remapTicketIssueBucket(fromId: number, toId: number): Promise<void>;
  recalcIssueBucketCounts(): Promise<void>;
  clearAllIssueBuckets(): Promise<void>;
  getSolutionBuckets(): Promise<SolutionBucket[]>;
  createSolutionBucket(bucket: InsertSolutionBucket): Promise<SolutionBucket>;
  incrementSolutionBucketCount(id: number): Promise<void>;
  updateSolutionBucket(id: number, data: Partial<InsertSolutionBucket>): Promise<SolutionBucket>;
  deleteSolutionBucket(id: number): Promise<void>;
  remapTicketSolutionBucket(fromId: number, toId: number): Promise<void>;
  recalcSolutionBucketCounts(): Promise<void>;
  clearAllSolutionBuckets(): Promise<void>;
  getRoleConfigs(): Promise<RoleConfig[]>;
  upsertRoleConfig(role: string, displayName: string, permissions: RolePermissions, hierarchyOrder?: number): Promise<void>;
  createRoleConfig(role: string, displayName: string, permissions: RolePermissions, hierarchyOrder: number): Promise<void>;
  deleteRoleConfig(role: string): Promise<void>;
  insertKvEntry(key: string, value: unknown): Promise<void>;
  getKvEntries(key: string): Promise<KvEntry[]>;
}

export class DatabaseStorage implements IStorage {
  async getTickets(): Promise<Ticket[]> {
    return await db.select().from(tickets);
  }

  async getTicket(id: number): Promise<Ticket | undefined> {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
    return ticket;
  }

  async createTicket(ticket: CreateTicketRequest): Promise<Ticket> {
    const [newTicket] = await db.insert(tickets).values(ticket).returning();
    return newTicket;
  }

  async updateTicket(id: number, updates: UpdateTicketRequest): Promise<Ticket | undefined> {
    const [updated] = await db.update(tickets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(tickets.id, id))
      .returning();
    return updated;
  }

  async deleteTicket(id: number): Promise<boolean> {
    const [deleted] = await db.delete(tickets).where(eq(tickets.id, id)).returning();
    return !!deleted;
  }

  async getSavedViews(userId: string): Promise<SavedView[]> {
    return await db.select().from(savedViews).where(
      or(eq(savedViews.isGlobal, true), eq(savedViews.userId, userId))
    );
  }

  async createSavedView(view: InsertSavedView): Promise<SavedView> {
    const [created] = await db.insert(savedViews).values(view).returning();
    return created;
  }

  async updateSavedView(id: number, userId: string, updates: { name?: string; isGlobal?: boolean; filters?: Record<string, any> }): Promise<SavedView | undefined> {
    const [view] = await db.select().from(savedViews).where(eq(savedViews.id, id));
    if (!view) return undefined;
    if (view.userId !== userId) return undefined;
    const [updated] = await db.update(savedViews)
      .set({ ...updates })
      .where(eq(savedViews.id, id))
      .returning();
    return updated;
  }

  async deleteSavedView(id: number, userId: string): Promise<boolean> {
    const [view] = await db.select().from(savedViews).where(eq(savedViews.id, id));
    if (!view) return false;
    if (view.userId !== userId) return false;
    const [deleted] = await db.delete(savedViews).where(eq(savedViews.id, id)).returning();
    return !!deleted;
  }

  async getEmailTemplates(userId: string): Promise<EmailTemplate[]> {
    return await db.select().from(emailTemplates).where(
      or(eq(emailTemplates.isGlobal, true), eq(emailTemplates.userId, userId))
    );
  }

  async createEmailTemplate(template: InsertEmailTemplate): Promise<EmailTemplate> {
    const [created] = await db.insert(emailTemplates).values(template).returning();
    return created;
  }

  async updateEmailTemplate(id: number, userId: string, updates: Partial<InsertEmailTemplate>): Promise<EmailTemplate | undefined> {
    const [existing] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
    if (!existing) return undefined;
    if (!existing.isGlobal && existing.userId !== userId) return undefined;
    const [updated] = await db.update(emailTemplates).set(updates).where(eq(emailTemplates.id, id)).returning();
    return updated;
  }

  async deleteEmailTemplate(id: number, userId: string): Promise<boolean> {
    const [existing] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));
    if (!existing) return false;
    if (!existing.isGlobal && existing.userId !== userId) return false;
    const [deleted] = await db.delete(emailTemplates).where(eq(emailTemplates.id, id)).returning();
    return !!deleted;
  }

  async getDailyReviews(): Promise<DailyReview[]> {
    return await db.select().from(dailyReviews).orderBy(desc(dailyReviews.date));
  }

  async getDailyReview(date: string): Promise<DailyReview | undefined> {
    const [review] = await db.select().from(dailyReviews).where(eq(dailyReviews.date, date));
    return review;
  }

  async createDailyReview(review: InsertDailyReview): Promise<DailyReview> {
    const [created] = await db.insert(dailyReviews).values(review).returning();
    return created;
  }

  async updateDailyReview(date: string, sections: DailyReview["sections"], updatedBy: string): Promise<DailyReview | undefined> {
    const [updated] = await db.update(dailyReviews)
      .set({ sections, updatedBy, updatedAt: new Date() })
      .where(eq(dailyReviews.date, date))
      .returning();
    return updated;
  }

  async snapshotDailyReview(date: string, snapshotP1P2Tickets: NonNullable<DailyReview["snapshotP1P2Tickets"]>, snapshotInstalls: NonNullable<DailyReview["snapshotInstalls"]>): Promise<void> {
    await db.update(dailyReviews)
      .set({ snapshotP1P2Tickets, snapshotInstalls })
      .where(eq(dailyReviews.date, date));
  }

  async updateDailyReviewSnapshotStats(date: string, snapshotStats: NonNullable<DailyReview["snapshotStats"]>): Promise<void> {
    await db.update(dailyReviews)
      .set({ snapshotStats })
      .where(eq(dailyReviews.date, date));
  }

  async markDailyReviewSlackPosted(date: string): Promise<void> {
    await db.update(dailyReviews)
      .set({ slackPostedAt: new Date() })
      .where(eq(dailyReviews.date, date));
  }

  async deleteDailyReview(date: string): Promise<boolean> {
    const [deleted] = await db.delete(dailyReviews).where(eq(dailyReviews.date, date)).returning();
    return !!deleted;
  }

  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db.insert(appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  async getCheckInTemplates(userId: string): Promise<CheckInTemplate[]> {
    return db.select().from(checkInTemplates)
      .where(or(eq(checkInTemplates.userId, userId), eq(checkInTemplates.isGlobal, true)))
      .orderBy(desc(checkInTemplates.createdAt));
  }

  async createCheckInTemplate(t: Omit<CheckInTemplate, "id" | "createdAt">): Promise<CheckInTemplate> {
    const [row] = await db.insert(checkInTemplates).values(t).returning();
    return row;
  }

  async deleteCheckInTemplate(id: number, userId: string): Promise<boolean> {
    const [row] = await db.delete(checkInTemplates)
      .where(eq(checkInTemplates.id, id))
      .returning();
    if (!row) return false;
    if (row.userId !== userId) return false;
    return true;
  }

  async getCustomerDirectory(): Promise<CustomerDirectoryEntry[]> {
    return await db.select().from(customerDirectory).orderBy(customerDirectory.name);
  }

  async upsertCustomerDirectory(entries: { name: string; systemIds: string[] }[]): Promise<number> {
    if (entries.length === 0) return 0;
    await db.delete(customerDirectory);
    const rows = await db.insert(customerDirectory)
      .values(entries.map(e => ({ name: e.name, systemIds: e.systemIds, syncedAt: new Date() })))
      .returning();
    return rows.length;
  }

  async getCustomerDirectoryMeta(): Promise<{ lastSyncAt: Date | null; recordCount: number; airtableChecksum: string | null }> {
    const rows = await db.select().from(customerDirectoryMeta).limit(1);
    if (rows.length === 0) return { lastSyncAt: null, recordCount: 0, airtableChecksum: null };
    return {
      lastSyncAt: rows[0].lastSyncAt,
      recordCount: rows[0].recordCount ?? 0,
      airtableChecksum: rows[0].airtableChecksum ?? null,
    };
  }

  async updateCustomerDirectoryMeta(recordCount: number, checksum: string): Promise<void> {
    const existing = await db.select().from(customerDirectoryMeta).limit(1);
    if (existing.length === 0) {
      await db.insert(customerDirectoryMeta).values({ lastSyncAt: new Date(), recordCount, airtableChecksum: checksum });
    } else {
      await db.update(customerDirectoryMeta)
        .set({ lastSyncAt: new Date(), recordCount, airtableChecksum: checksum })
        .where(eq(customerDirectoryMeta.id, existing[0].id));
    }
  }

  async getUserRole(userId: string): Promise<string> {
    const [row] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    return row?.role || "requester";
  }

  async setUserRole(userId: string, role: string, updatedBy: string): Promise<void> {
    await db.insert(userRoles)
      .values({ userId, role, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userRoles.userId,
        set: { role, updatedBy, updatedAt: new Date() },
      });
  }

  async getAllUsersWithRoles(): Promise<Array<{ id: string; email: string | null; firstName: string | null; lastName: string | null; role: string }>> {
    const allUsers = await db.select().from(users);
    const allRoles = await db.select().from(userRoles);
    const roleMap = new Map(allRoles.map(r => [r.userId, r.role]));
    return allUsers.map(u => ({
      id: u.id,
      email: u.email ?? null,
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      role: roleMap.get(u.id) || "requester",
    }));
  }

  async logSmartSearchFail(entry: { query: string; aiFilters: any; explanation: string | null; userEmail: string | null }): Promise<void> {
    await db.insert(smartSearchFails).values({
      query: entry.query,
      aiFilters: entry.aiFilters,
      explanation: entry.explanation,
      userEmail: entry.userEmail,
    });
  }

  async getRecentSmartSearchFails(limit = 20): Promise<SmartSearchFail[]> {
    return await db.select().from(smartSearchFails).orderBy(desc(smartSearchFails.createdAt)).limit(limit);
  }

  async getIssueBuckets(): Promise<IssueBucket[]> {
    return await db.select().from(issueBuckets).orderBy(issueBuckets.name);
  }

  async createIssueBucket(bucket: InsertIssueBucket): Promise<IssueBucket> {
    const [created] = await db.insert(issueBuckets).values(bucket).returning();
    return created;
  }

  async incrementIssueBucketCount(id: number): Promise<void> {
    const [current] = await db.select({ count: issueBuckets.count }).from(issueBuckets).where(eq(issueBuckets.id, id));
    if (current) {
      await db.update(issueBuckets).set({ count: current.count + 1 }).where(eq(issueBuckets.id, id));
    }
  }

  async updateIssueBucket(id: number, data: Partial<InsertIssueBucket>): Promise<IssueBucket> {
    const [updated] = await db.update(issueBuckets).set(data).where(eq(issueBuckets.id, id)).returning();
    return updated;
  }

  async deleteIssueBucket(id: number): Promise<void> {
    await db.delete(issueBuckets).where(eq(issueBuckets.id, id));
  }

  async remapTicketIssueBucket(fromId: number, toId: number): Promise<void> {
    await db.update(tickets).set({ issueBucketId: toId }).where(eq(tickets.issueBucketId, fromId));
  }

  async recalcIssueBucketCounts(): Promise<void> {
    const rows = await db.execute(sql`
      SELECT issue_bucket_id, COUNT(*) as c
      FROM tickets
      WHERE status = 'closed' AND issue_bucket_id IS NOT NULL
      GROUP BY issue_bucket_id
    `);
    await db.execute(sql`UPDATE issue_buckets SET count = 0`);
    for (const row of rows.rows as any[]) {
      await db.update(issueBuckets)
        .set({ count: Number(row.c) })
        .where(eq(issueBuckets.id, Number(row.issue_bucket_id)));
    }
  }

  async getSolutionBuckets(): Promise<SolutionBucket[]> {
    return await db.select().from(solutionBuckets).orderBy(solutionBuckets.name);
  }

  async createSolutionBucket(bucket: InsertSolutionBucket): Promise<SolutionBucket> {
    const [created] = await db.insert(solutionBuckets).values(bucket).returning();
    return created;
  }

  async incrementSolutionBucketCount(id: number): Promise<void> {
    const [current] = await db.select({ count: solutionBuckets.count }).from(solutionBuckets).where(eq(solutionBuckets.id, id));
    if (current) {
      await db.update(solutionBuckets).set({ count: current.count + 1 }).where(eq(solutionBuckets.id, id));
    }
  }

  async updateSolutionBucket(id: number, data: Partial<InsertSolutionBucket>): Promise<SolutionBucket> {
    const [updated] = await db.update(solutionBuckets).set(data).where(eq(solutionBuckets.id, id)).returning();
    return updated;
  }

  async deleteSolutionBucket(id: number): Promise<void> {
    await db.delete(solutionBuckets).where(eq(solutionBuckets.id, id));
  }

  async remapTicketSolutionBucket(fromId: number, toId: number): Promise<void> {
    await db.update(tickets).set({ solutionBucketId: toId }).where(eq(tickets.solutionBucketId, fromId));
  }

  async clearAllIssueBuckets(): Promise<void> {
    await db.execute(sql`UPDATE tickets SET issue_bucket_id = NULL`);
    await db.execute(sql`DELETE FROM issue_buckets`);
  }

  async clearAllSolutionBuckets(): Promise<void> {
    await db.execute(sql`UPDATE tickets SET solution_bucket_id = NULL`);
    await db.execute(sql`DELETE FROM solution_buckets`);
  }

  async recalcSolutionBucketCounts(): Promise<void> {
    const rows = await db.execute(sql`
      SELECT solution_bucket_id, COUNT(*) as c
      FROM tickets
      WHERE status = 'closed' AND solution_bucket_id IS NOT NULL
      GROUP BY solution_bucket_id
    `);
    await db.execute(sql`UPDATE solution_buckets SET count = 0`);
    for (const row of rows.rows as any[]) {
      await db.update(solutionBuckets)
        .set({ count: Number(row.c) })
        .where(eq(solutionBuckets.id, Number(row.solution_bucket_id)));
    }
  }

  async getRoleConfigs(): Promise<RoleConfig[]> {
    return await db.select().from(roleConfig).orderBy(roleConfig.hierarchyOrder);
  }

  async upsertRoleConfig(role: string, displayName: string, permissions: RolePermissions, hierarchyOrder?: number): Promise<void> {
    const setClause: any = { displayName, permissions };
    if (hierarchyOrder !== undefined) setClause.hierarchyOrder = hierarchyOrder;
    await db.insert(roleConfig)
      .values({ role, displayName, permissions, hierarchyOrder: hierarchyOrder ?? 99 })
      .onConflictDoUpdate({ target: roleConfig.role, set: setClause });
  }

  async createRoleConfig(role: string, displayName: string, permissions: RolePermissions, hierarchyOrder: number): Promise<void> {
    await db.insert(roleConfig).values({ role, displayName, permissions, hierarchyOrder });
  }

  async deleteRoleConfig(role: string): Promise<void> {
    await db.delete(roleConfig).where(eq(roleConfig.role, role));
  }

  async insertKvEntry(key: string, value: unknown): Promise<void> {
    await db.insert(kvStore).values({ key, value: value as any });
  }

  async getKvEntries(key: string): Promise<KvEntry[]> {
    return await db.select().from(kvStore).where(eq(kvStore.key, key)).orderBy(desc(kvStore.createdAt));
  }
}

export const storage = new DatabaseStorage();
