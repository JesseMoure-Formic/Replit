// Extract just the ID portion if a full Airtable URL was pasted
function extractAirtableBaseId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Look for appXXXX pattern (base ID)
  const match = raw.match(/(app[a-zA-Z0-9]+)/);
  if (match) return match[1];
  return raw.trim();
}

function extractAirtableTableId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Look for tblXXXX pattern first (table ID)
  const tblMatch = raw.match(/(tbl[a-zA-Z0-9]+)/);
  if (tblMatch) return tblMatch[1];
  // Otherwise return as-is (could be a table name like "Grid view" or "Tickets")
  return raw.trim();
}

const AIRTABLE_BASE_ID = extractAirtableBaseId(process.env.AIRTABLE_BASE_ID);
const AIRTABLE_TABLE_ID = extractAirtableTableId(process.env.AIRTABLE_TABLE_ID);
const AIRTABLE_PAT = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_PAT) {
  console.warn("Airtable credentials not fully configured — sync will be limited.");
}

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

export interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
  createdTime: string;
}

export interface AirtableResponse {
  records: AirtableRecord[];
  offset?: string;
}

function headers() {
  return {
    Authorization: `Bearer ${AIRTABLE_PAT}`,
    "Content-Type": "application/json",
  };
}

export async function fetchAirtableRecords(): Promise<AirtableRecord[]> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }

  const records: AirtableRecord[] = [];
  let offset: string | undefined = undefined;

  do {
    const url = new URL(
      `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_ID!)}`
    );
    if (offset) url.searchParams.set("offset", offset);

    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable API error: ${res.status} ${err}`);
    }

    const data: AirtableResponse = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

export async function createAirtableRecord(
  fields: Record<string, any>
): Promise<AirtableRecord> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }

  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_ID!)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable API error: ${res.status} ${err}`);
  }

  return res.json();
}

export async function updateAirtableRecord(
  recordId: string,
  fields: Record<string, any>
): Promise<AirtableRecord> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }

  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_ID!)}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable API error: ${res.status} ${err}`);
  }

  return res.json();
}

const CUSTOMERS_TABLE_ID = "tblRv3dwDV1KQWrrz";
const CONTACTS_TABLE_ID = "tbltkhIjd7JLeTfK6";
const SITES_TABLE_ID = "tbl6noccUUrYmgTNr";

let customerNamesCache: string[] = [];
let customerNamesCacheTime = 0;
const CUSTOMER_CACHE_TTL = 60 * 60 * 1000; // 1 hour - customers change infrequently

export function invalidateCustomerCache() {
  customerNamesCache = [];
  customerNamesCacheTime = 0;
}

async function fetchAllFromTable(tableId: string): Promise<AirtableRecord[]> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }
  const records: AirtableRecord[] = [];
  let offset: string | undefined = undefined;
  do {
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${tableId}`);
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable API error: ${res.status} ${err}`);
    }
    const data: AirtableResponse = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

export interface CustomerContact {
  recordId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface ContactDuplicateGroup {
  customerName: string;
  contactName: string;
  records: CustomerContact[];
}

let customerContactsCache: Record<string, CustomerContact[]> | null = null;
let customerContactsCacheTime = 0;
let customerRecordIdMap: Map<string, string> = new Map();
let contactNameToRecordIdMap: Map<string, string> = new Map();
// Full raw list per customer (including duplicates) for the dedup tool
let rawContactsByCustomer: Record<string, CustomerContact[]> = {};
const CACHE_TTL = 5 * 60 * 1000;

export async function fetchCustomerContacts(): Promise<Record<string, CustomerContact[]>> {
  if (customerContactsCache && Date.now() - customerContactsCacheTime < CACHE_TTL) {
    return customerContactsCache;
  }

  const [customers, contacts] = await Promise.all([
    fetchAllFromTable(CUSTOMERS_TABLE_ID),
    fetchAllFromTable(CONTACTS_TABLE_ID),
  ]);

  const contactMap = new Map<string, CustomerContact>();
  contactNameToRecordIdMap = new Map();
  for (const c of contacts) {
    const f = c.fields;
    const contactName = f.full_name ? String(f.full_name) : [f.first_name, f.last_name].filter(Boolean).join(" ");
    contactMap.set(c.id, {
      recordId: c.id,
      name: contactName,
      email: f.email ? String(f.email) : null,
      phone: f.phone_number ? String(f.phone_number) : null,
    });
    if (contactName) {
      contactNameToRecordIdMap.set(contactName, c.id);
    }
  }

  customerRecordIdMap = new Map();
  rawContactsByCustomer = {};
  const result: Record<string, CustomerContact[]> = {};
  for (const cust of customers) {
    const name = cust.fields.name ? String(cust.fields.name) : null;
    if (!name) continue;
    customerRecordIdMap.set(name, cust.id);
    const contactIds: string[] = Array.isArray(cust.fields.contacts) ? cust.fields.contacts : [];
    const allContacts: CustomerContact[] = [];
    for (const cid of contactIds) {
      const contact = contactMap.get(cid);
      if (contact && contact.name) {
        allContacts.push(contact);
      }
    }
    allContacts.sort((a, b) => a.name.localeCompare(b.name));
    rawContactsByCustomer[name] = allContacts;

    // Deduplicate by name for the dropdown (keep first occurrence)
    const seen = new Set<string>();
    const dedupedContacts = allContacts.filter(c => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });

    if (dedupedContacts.length > 0) {
      result[name] = dedupedContacts;
    }
  }

  customerContactsCache = result;
  customerContactsCacheTime = Date.now();
  return result;
}

export async function fetchContactDuplicates(): Promise<ContactDuplicateGroup[]> {
  // Always refresh to get latest
  customerContactsCache = null;
  await fetchCustomerContacts();

  const groups: ContactDuplicateGroup[] = [];
  for (const [customerName, contacts] of Object.entries(rawContactsByCustomer)) {
    const byName = new Map<string, CustomerContact[]>();
    for (const c of contacts) {
      if (!byName.has(c.name)) byName.set(c.name, []);
      byName.get(c.name)!.push(c);
    }
    for (const [contactName, records] of byName.entries()) {
      if (records.length > 1) {
        groups.push({ customerName, contactName, records });
      }
    }
  }
  groups.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.contactName.localeCompare(b.contactName));
  return groups;
}

export async function deleteAirtableContact(recordId: string): Promise<void> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${CONTACTS_TABLE_ID}/${recordId}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable delete failed: ${res.status} ${body}`);
  }
  // Bust the cache so the next fetch reflects the deletion
  customerContactsCache = null;
  customerContactsCacheTime = 0;
}

export interface ContactWithCustomer extends CustomerContact {
  customerName: string;
}

export async function fetchAllContactsWithCustomer(): Promise<ContactWithCustomer[]> {
  // Use or refresh the raw contact data
  if (!customerContactsCache || Date.now() - customerContactsCacheTime >= CACHE_TTL) {
    await fetchCustomerContacts();
  }
  const result: ContactWithCustomer[] = [];
  for (const [customerName, contacts] of Object.entries(rawContactsByCustomer)) {
    for (const c of contacts) {
      result.push({ ...c, customerName });
    }
  }
  result.sort((a, b) => a.customerName.localeCompare(b.customerName) || a.name.localeCompare(b.name));
  return result;
}

export async function updateAirtableContactRecord(
  recordId: string,
  data: { firstName?: string; lastName?: string; email?: string | null; phone?: string | null }
): Promise<void> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }
  const fields: Record<string, any> = {};
  if (data.firstName !== undefined) fields.first_name = data.firstName;
  if (data.lastName !== undefined) fields.last_name = data.lastName;
  if (data.email !== undefined) fields.email = data.email ?? "";
  if (data.phone !== undefined) fields.phone_number = data.phone ?? "";

  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${CONTACTS_TABLE_ID}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable update failed: ${res.status} ${body}`);
  }
  // Bust cache so next fetch reflects the update
  customerContactsCache = null;
  customerContactsCacheTime = 0;
}

export async function createAirtableContact(data: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  customerName: string;
}): Promise<CustomerContact> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) {
    throw new Error("Airtable credentials not configured");
  }

  if (customerRecordIdMap.size === 0) {
    await fetchCustomerContacts();
  }
  const customerRecordId = customerRecordIdMap.get(data.customerName);
  if (!customerRecordId) {
    throw new Error(`Customer "${data.customerName}" not found in Airtable`);
  }

  const fields: Record<string, any> = {
    first_name: data.firstName,
    last_name: data.lastName,
    customer: [customerRecordId],
  };
  if (data.email) fields.email = data.email;
  if (data.phone) fields.phone_number = data.phone;

  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${CONTACTS_TABLE_ID}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable API error: ${res.status} ${err}`);
  }

  const record: AirtableRecord = await res.json();
  const contact: CustomerContact = {
    recordId: record.id,
    name: `${data.firstName} ${data.lastName}`.trim(),
    email: data.email || null,
    phone: data.phone || null,
  };

  customerContactsCache = null;
  customerContactsCacheTime = 0;
  contactNameToRecordIdMap = new Map();

  return contact;
}

export async function getCustomerRecordId(customerName: string): Promise<string | null> {
  if (customerRecordIdMap.size === 0) {
    await fetchCustomerContacts();
  }
  return customerRecordIdMap.get(customerName) || null;
}

export async function getCustomerNames(): Promise<string[]> {
  const now = Date.now();
  if (customerNamesCache.length > 0 && now - customerNamesCacheTime < CUSTOMER_CACHE_TTL) {
    return customerNamesCache;
  }
  
  try {
    if (!AIRTABLE_BASE_ID || !AIRTABLE_TABLE_ID || !AIRTABLE_PAT) {
      return customerNamesCache.length > 0 ? customerNamesCache : [];
    }
    const customers = await fetchAllFromTable(CUSTOMERS_TABLE_ID);
    const names = customers
      .map((c: any) => c.fields.name)
      .filter((name: any) => name)
      .map((name: any) => String(name))
      .sort();
    customerNamesCache = names;
    customerNamesCacheTime = Date.now();
    console.log("[getCustomerNames] Cached", names.length, "customers (TTL: 1h)");
    return names;
  } catch (err: any) {
    console.error("[getCustomerNames] Failed to fetch from Airtable:", err.message);
    return customerNamesCache.length > 0 ? customerNamesCache : [];
  }
}

export interface CustomerDirectorySyncResult {
  count: number;
  checksum: string;
  changed: boolean;
  entries: { name: string; systemIds: string[] }[];
}

/**
 * Cheap single-request check: asks Airtable "has any customer record been
 * modified since `since`?". Returns true if there are changes, false if not.
 * Uses LAST_MODIFIED_TIME() formula filter + maxRecords=1 so it's ~1 API call.
 */
export async function checkCustomersChangedSince(since: Date): Promise<boolean> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) return true; // assume changed if no creds
  try {
    const iso = since.toISOString();
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${CUSTOMERS_TABLE_ID}`);
    url.searchParams.set("filterByFormula", `IS_AFTER(LAST_MODIFIED_TIME(), "${iso}")`);
    url.searchParams.set("maxRecords", "1");
    url.searchParams.set("fields[]", "name");
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) return true; // assume changed on error
    const data: AirtableResponse = await res.json();
    return data.records.length > 0;
  } catch {
    return true; // assume changed on any error
  }
}

function buildChecksum(entries: { name: string; systemIds: string[] }[]): string {
  const parts = entries.map(e => `${e.name}:[${e.systemIds.sort().join(",")}]`);
  return `${entries.length}:${parts.join("|")}`;
}

export async function fetchCustomerDirectoryFromAirtable(
  since?: Date
): Promise<CustomerDirectorySyncResult> {
  // Quick check: if we have a since timestamp, verify something actually changed
  // before pulling all 100+ records across multiple pages.
  if (since) {
    const changed = await checkCustomersChangedSince(since);
    if (!changed) {
      return { count: 0, checksum: "", changed: false, entries: [] };
    }
  }

  const records = await fetchAllFromTable(CUSTOMERS_TABLE_ID);
  const entries: { name: string; systemIds: string[] }[] = [];
  for (const r of records) {
    const name = r.fields.name ? String(r.fields.name).trim() : null;
    if (!name) continue;
    const rawIds = r.fields.system_ids;
    let systemIds: string[] = [];
    if (Array.isArray(rawIds)) {
      systemIds = rawIds.map((s: any) => String(s).trim()).filter(Boolean);
    } else if (rawIds && typeof rawIds === "string") {
      systemIds = rawIds.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    entries.push({ name, systemIds });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const checksum = buildChecksum(entries);
  return { count: entries.length, checksum, changed: true, entries };
}

export interface SystemInfo {
  systemId: string;
  label: string;
}

let systemsCache: Record<string, SystemInfo[]> = {};
let systemsCacheTime = 0;

// Formic Job Database (separate Airtable base) for System Type / model info
const FJD_BASE_ID = "appzLiACOq8tvPZEF";
const FJD_TABLE_ID = "tblRXewS1BUrOkx1x";

export interface SystemMeta {
  alias?: string;
  region?: string;
  vendor?: string;
}

// Helper: paginate through any URL (no fields[] restriction) and return all records
async function paginatedFetch(baseUrl: URL): Promise<AirtableRecord[]> {
  const allRecords: AirtableRecord[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(baseUrl.toString());
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) break;
    const data: AirtableResponse = await res.json();
    allRecords.push(...data.records);
    offset = data.offset;
  } while (offset);
  return allRecords;
}

// Cache: systemId -> { alias?, region?, vendor? }
let systemMetaCache: Map<string, SystemMeta> = new Map();
// System IDs in FJD with status > 6 (closed/terminated) — filtered from dropdown
let closedFjdIds: Set<string> = new Set();
let systemMetaCacheTime = 0;
const META_CACHE_TTL = 15 * 60 * 1000;

export function getClosedFjdIds(): Set<string> {
  return closedFjdIds;
}

export async function fetchSystemMeta(): Promise<Record<string, SystemMeta>> {
  if (systemMetaCache.size > 0 && Date.now() - systemMetaCacheTime < META_CACHE_TTL) {
    return Object.fromEntries(systemMetaCache);
  }
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) return {};

  // Warm the FJD record cache so field diagnostics log at startup
  ensureFjdRecordCache().catch(() => {});

  const meta = new Map<string, SystemMeta>();

  // 1. jobsdb_sync — alias records (formula field system_id only returned without fields[] restriction)
  try {
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    url.searchParams.set("filterByFormula", '{system_alias} != ""');
    for (const r of await paginatedFetch(url)) {
      const sysId = r.fields.system_id ? String(r.fields.system_id) : "";
      if (!sysId) continue;
      meta.set(sysId, {
        ...meta.get(sysId),
        alias: r.fields.system_alias ? String(r.fields.system_alias) : undefined,
        region: r.fields.region ? String(r.fields.region) : undefined,
      });
    }
  } catch (e: any) {
    console.error("[airtable] fetchSystemMeta alias fetch error:", e.message);
  }

  // 2. jobsdb_sync — non-alias records (plain text system_id, has region)
  try {
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    url.searchParams.set("filterByFormula", '{system_alias} = ""');
    for (const r of await paginatedFetch(url)) {
      const sysId = r.fields.system_id ? String(r.fields.system_id) : "";
      if (!sysId) continue;
      if (!meta.has(sysId)) {
        meta.set(sysId, { region: r.fields.region ? String(r.fields.region) : undefined });
      }
    }
  } catch (e: any) {
    console.error("[airtable] fetchSystemMeta region fetch error:", e.message);
  }

  // 3. Formic Job Database — Vendor name + status filter per Formic System ID
  // Fetch ALL FJD records with a system ID; split into active (status ≤ 6) and closed (status > 6)
  // A system ID is only closed if it has NO active (status ≤ 6) record across all FJD records.
  const newClosedIds = new Set<string>();
  try {
    const url = new URL(`${AIRTABLE_API_BASE}/${FJD_BASE_ID}/${FJD_TABLE_ID}`);
    url.searchParams.set("filterByFormula", 'NOT({Formic System ID} = "")');
    const fjdRecords = await paginatedFetch(url);
    // Two-pass: first collect all active IDs; then build closed set (excluding any confirmed-active)
    const confirmedActiveIds = new Set<string>();
    const candidateClosedIds = new Set<string>();
    for (const r of fjdRecords) {
      const sysId = r.fields["Formic System ID"] ? String(r.fields["Formic System ID"]) : "";
      if (!sysId) continue;
      const statusStr = r.fields["Status"] ? String(r.fields["Status"]) : "";
      const statusNum = statusStr ? parseInt(statusStr, 10) : 0;
      if (!isNaN(statusNum) && statusNum > 6) {
        candidateClosedIds.add(sysId);
      } else {
        confirmedActiveIds.add(sysId);
        // "Vendor(s) (from Vendor(s))" is the lookup field returning actual vendor name(s)
        const vendorRaw = r.fields["Vendor(s) (from Vendor(s))"];
        let vendor: string | undefined;
        if (Array.isArray(vendorRaw)) {
          const texts = vendorRaw.map(String).filter(v => !v.startsWith("rec"));
          if (texts.length > 0) vendor = texts.join(", ");
        } else if (typeof vendorRaw === "string" && !vendorRaw.startsWith("rec")) {
          vendor = vendorRaw;
        }
        if (vendor) meta.set(sysId, { ...meta.get(sysId), vendor });
      }
    }
    // Only mark closed if no active record exists for the same system ID
    for (const sysId of candidateClosedIds) {
      if (!confirmedActiveIds.has(sysId)) newClosedIds.add(sysId);
    }
    console.log(`[airtable] fetchSystemMeta FJD: ${fjdRecords.length} records, ${newClosedIds.size} closed excluded`);
  } catch (e: any) {
    console.error("[airtable] fetchSystemMeta FJD error:", e.message);
  }
  closedFjdIds = newClosedIds;

  systemMetaCache = meta;
  systemMetaCacheTime = Date.now();
  console.log(`[airtable] fetchSystemMeta: cached ${meta.size} entries`);
  return Object.fromEntries(meta);
}

/**
 * Returns the set of Formic System IDs whose FJD Status is exactly 6 (Billing).
 * These are the canonical "in billing" system IDs used for MaintainX visit tracking.
 */
export async function fetchBillingSystemIds(): Promise<Set<string>> {
  if (!AIRTABLE_PAT) return new Set();
  const url = new URL(`${AIRTABLE_API_BASE}/${FJD_BASE_ID}/${FJD_TABLE_ID}`);
  url.searchParams.set("filterByFormula", 'NOT({Formic System ID} = "")');
  const records = await paginatedFetch(url);
  const result = new Set<string>();
  for (const r of records) {
    const sysId = r.fields["Formic System ID"] ? String(r.fields["Formic System ID"]) : "";
    if (!sysId) continue;
    const statusStr = r.fields["Status"] ? String(r.fields["Status"]) : "";
    const statusNum = parseInt(statusStr, 10);
    if (statusNum === 6) result.add(sysId);
  }
  return result;
}

// Cache: systemId -> FJD Airtable record ID
let fjdRecordIdCache: Map<string, string> = new Map();
let fjdRecordIdCacheTime = 0;
const FJD_RECORD_CACHE_TTL = 10 * 60 * 1000;

async function ensureFjdRecordCache() {
  if (fjdRecordIdCache.size > 0 && Date.now() - fjdRecordIdCacheTime < FJD_RECORD_CACHE_TTL) return;
  if (!AIRTABLE_PAT) return;
  try {
    const url = new URL(`${AIRTABLE_API_BASE}/${FJD_BASE_ID}/${FJD_TABLE_ID}`);
    url.searchParams.set("filterByFormula", 'NOT({Formic System ID} = "")');
    // NOTE: Do NOT set fields[] here — Formic System ID may be a formula field
    // which Airtable excludes when fields[] is specified
    const allRecords: AirtableRecord[] = [];
    let offset: string | undefined;
    do {
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url.toString(), { headers: headers() });
      if (!res.ok) break;
      const data: AirtableResponse = await res.json();
      allRecords.push(...data.records);
      offset = (data as any).offset;
    } while (offset);
    fjdRecordIdCache = new Map();
    for (const r of allRecords) {
      const sysId = r.fields["Formic System ID"] ? String(r.fields["Formic System ID"]) : "";
      if (sysId) fjdRecordIdCache.set(sysId, r.id);
    }
    fjdRecordIdCacheTime = Date.now();
    console.log(`[airtable] ensureFjdRecordCache: loaded ${fjdRecordIdCache.size} FJD records`);
  } catch (e: any) {
    console.error("[airtable] ensureFjdRecordCache error:", e.message);
  }
}

export async function getFjdRecordId(systemId: string): Promise<string | null> {
  await ensureFjdRecordCache();
  return fjdRecordIdCache.get(systemId) ?? null;
}

// Returns the cached system meta (alias, region, vendor) for a given systemId without
// triggering a fresh Airtable fetch.  Used by Slack notifications to build enriched labels.
export function getSystemMetaEntry(systemId: string): { alias?: string; region?: string; vendor?: string } | null {
  return systemMetaCache.get(systemId) ?? null;
}

export async function updateJobsDbSync(
  systemId: string,
  fields: { system_alias?: string }
): Promise<void> {
  if (!AIRTABLE_PAT) throw new Error("Airtable credentials not configured");
  const recordId = await getFjdRecordId(systemId);
  if (!recordId) throw new Error(`No FJD record found for systemId: ${systemId}`);

  const updateFields: Record<string, any> = {};
  if (fields.system_alias !== undefined) updateFields["System Alias Nickname"] = fields.system_alias;

  const url = `${AIRTABLE_API_BASE}/${FJD_BASE_ID}/${FJD_TABLE_ID}/${recordId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ fields: updateFields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airtable API error: ${res.status} ${err}`);
  }

  // Update local cache immediately so the next options fetch reflects the change.
  // Do NOT reset systemMetaCacheTime — the in-memory cache already has the correct
  // alias. Airtable's internal sync from FJD → ISR jobsdb_sync is not instant, so
  // busting the TTL would cause a fresh Airtable read that returns the OLD value.
  const existing = systemMetaCache.get(systemId) ?? {};
  const updated: SystemMeta = { ...existing };
  if (fields.system_alias !== undefined) updated.alias = fields.system_alias || undefined;
  systemMetaCache.set(systemId, updated);
}

// Cache: systemId -> region string
let systemRegionCache: Map<string, string> = new Map();
let systemRegionCacheTime = 0;
const REGION_CACHE_TTL = 15 * 60 * 1000;

export async function getAsaNumberForSystem(systemId: string): Promise<string | null> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT || !systemId) return null;
  try {
    // Fetch WITHOUT fields[] so formula fields (which include computed ASA text) are returned
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    url.searchParams.set("filterByFormula", `{system_id} = "${systemId.replace(/"/g, '\\"')}"`);
    url.searchParams.set("maxRecords", "1");
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) return null;
    const data: AirtableResponse = await res.json();
    const record = data.records?.[0];
    if (!record) return null;
    const fields = record.fields as Record<string, unknown>;
    // Log all field keys so we can identify the right ASA field
    console.log(`[airtable] getAsaNumberForSystem fields for ${systemId}:`, Object.keys(fields).join(", "));
    // Look for any text/formula field whose key contains "asa" (case-insensitive) that isn't a record ID
    for (const [key, val] of Object.entries(fields)) {
      if (!key.toLowerCase().includes("asa")) continue;
      if (typeof val === "string" && !val.startsWith("rec")) return val;
      if (Array.isArray(val)) {
        const text = val.map(String).find((v) => !v.startsWith("rec"));
        if (text) return text;
      }
    }
    return null;
  } catch (e: any) {
    console.error("[airtable] getAsaNumberForSystem error:", e.message);
    return null;
  }
}

export async function getAsaRecordId(systemId: string): Promise<string | null> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT || !systemId) return null;
  try {
    // The ticket table's "asa" field is a linked record field that points to the jobsdb_sync
    // record for the system. So the ASA rec ID is simply the jobsdb_sync record's own Airtable ID.
    // Do NOT use fields[] — formula/lookup fields are silently dropped.
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    url.searchParams.set("filterByFormula", `{system_id} = "${systemId.replace(/"/g, '\\"')}"`);
    url.searchParams.set("maxRecords", "1");
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) {
      console.error(`[airtable] getAsaRecordId HTTP ${res.status} for ${systemId}`);
      return null;
    }
    const data: AirtableResponse = await res.json();
    const record = data.records?.[0];
    if (!record) {
      console.log(`[airtable] getAsaRecordId: no jobsdb_sync record found for ${systemId}`);
      return null;
    }
    console.log(`[airtable] getAsaRecordId: resolved ${systemId} → ${record.id}`);
    return record.id;
  } catch (e: any) {
    console.error("[airtable] getAsaRecordId error:", e.message);
    return null;
  }
}

export async function fetchSystemRegion(systemId: string): Promise<string | null> {
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT || !systemId) return null;
  if (systemRegionCache.has(systemId) && Date.now() - systemRegionCacheTime < REGION_CACHE_TTL) {
    return systemRegionCache.get(systemId) ?? null;
  }
  try {
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    url.searchParams.set("filterByFormula", `{system_id} = "${systemId.replace(/"/g, '\\"')}"`);
    // Do NOT use fields[] here — formula fields (like region) are silently excluded when fields[] is specified
    url.searchParams.set("maxRecords", "1");
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) return null;
    const data: AirtableResponse = await res.json();
    const record = data.records?.[0];
    if (!record) return null;
    const region = record.fields.region ? String(record.fields.region) : null;
    if (region) {
      systemRegionCache.set(systemId, region);
      systemRegionCacheTime = Date.now();
    }
    return region;
  } catch (e: any) {
    console.error("[airtable] fetchSystemRegion error:", e.message);
    return null;
  }
}

// Cache: all jobsdb_sync records grouped by linked_customer
let jobsdbCustomerCache: Record<string, string[]> = {};
let jobsdbCustomerCacheTime = 0;
const JOBSDB_CUSTOMER_CACHE_TTL = 5 * 60 * 1000;

export async function fetchAllJobsdbCustomerMappings(): Promise<Record<string, string[]>> {
  if (Object.keys(jobsdbCustomerCache).length > 0 && Date.now() - jobsdbCustomerCacheTime < JOBSDB_CUSTOMER_CACHE_TTL) {
    return jobsdbCustomerCache;
  }
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) return {};
  try {
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    // Do NOT use fields[] — system_id is a formula field and Airtable excludes formula
    // fields when fields[] is specified.
    // Use cellFormat=string so linked-record fields (customer) return the primary
    // field text value instead of record IDs like ["recXXXX"].
    url.searchParams.set("cellFormat", "string");
    url.searchParams.set("timeZone", "UTC");
    url.searchParams.set("userLocale", "en-us");
    const records = await paginatedFetch(url);
    const mapping: Record<string, string[]> = {};
    for (const r of records) {
      const sysId = r.fields.system_id ? String(r.fields.system_id) : "";
      if (!sysId) continue;
      // With cellFormat=string, the linked-record "customer" field returns
      // the primary field of the linked customer record as a plain string.
      const raw = r.fields.customer;
      const customer = raw ? String(raw).trim() : "";
      if (!customer) continue;
      if (!mapping[customer]) mapping[customer] = [];
      if (!mapping[customer].includes(sysId)) mapping[customer].push(sysId);
    }
    for (const k of Object.keys(mapping)) mapping[k].sort();
    jobsdbCustomerCache = mapping;
    jobsdbCustomerCacheTime = Date.now();
    console.log(`[airtable] fetchAllJobsdbCustomerMappings: ${records.length} records, ${Object.keys(mapping).length} customers`);
    return mapping;
  } catch (e: any) {
    console.error("[airtable] fetchAllJobsdbCustomerMappings error:", e.message);
    return {};
  }
}

export async function fetchSystemsForCustomer(customerName: string): Promise<SystemInfo[]> {
  const now = Date.now();
  if (systemsCache[customerName] && now - systemsCacheTime < 5 * 60 * 1000) {
    return systemsCache[customerName];
  }
  if (!AIRTABLE_BASE_ID || !AIRTABLE_PAT) {
    return [];
  }
  try {
    const filterFormula = `FIND("${customerName.replace(/"/g, '\\"')}",{linked_customer})`;
    const url = new URL(`${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/jobsdb_sync`);
    url.searchParams.set("fields[]", "asa");
    url.searchParams.set("fields[]", "system_id");
    url.searchParams.set("fields[]", "system_alias");
    url.searchParams.set("filterByFormula", filterFormula);
    const res = await fetch(url.toString(), { headers: headers() });
    if (!res.ok) {
      console.error(`[airtable] systems fetch failed: ${res.status}`);
      return [];
    }
    const data: AirtableResponse = await res.json();
    const results: SystemInfo[] = data.records.map((r) => {
      const sysId = r.fields.system_id ? String(r.fields.system_id) : "";
      const alias = r.fields.system_alias ? String(r.fields.system_alias) : "";
      return {
        systemId: sysId,
        label: alias ? `${sysId} — ${alias}` : sysId,
      };
    }).filter((s) => s.systemId);
    systemsCache[customerName] = results;
    systemsCacheTime = now;
    return results;
  } catch (e: any) {
    console.error("[airtable] fetchSystemsForCustomer error:", e.message);
    return [];
  }
}

export async function getContactRecordId(contactName: string): Promise<string | null> {
  if (contactNameToRecordIdMap.size === 0) {
    await fetchCustomerContacts();
  }
  return contactNameToRecordIdMap.get(contactName) || null;
}

let customerSiteMap: Map<string, string[]> = new Map();
let systemIdSiteMap: Map<string, string> = new Map();
// Maps site record ID → its cs_channel (for multi-site customers)
let siteChannelMap: Map<string, string> = new Map();
let sitesCacheTime = 0;

async function ensureSitesCache() {
  if (Date.now() - sitesCacheTime < CACHE_TTL && customerSiteMap.size > 0) return;
  const sites = await fetchAllFromTable(SITES_TABLE_ID);
  customerSiteMap = new Map();
  systemIdSiteMap = new Map();
  siteChannelMap = new Map();
  for (const site of sites) {
    const custIds: string[] = Array.isArray(site.fields.customer) ? site.fields.customer : [];
    for (const custId of custIds) {
      const existing = customerSiteMap.get(custId) || [];
      existing.push(site.id);
      customerSiteMap.set(custId, existing);
    }
    const sysId = site.fields.system_id;
    if (sysId) {
      const ids = Array.isArray(sysId) ? sysId : [sysId];
      for (const id of ids) {
        systemIdSiteMap.set(String(id), site.id);
      }
    }
    const channel = site.fields.cs_channel;
    if (channel) {
      siteChannelMap.set(site.id, String(Array.isArray(channel) ? channel[0] : channel));
    }
  }
  sitesCacheTime = Date.now();
}

export async function getSiteChannelForSystemId(systemId: string): Promise<string | null> {
  await ensureSitesCache();
  const siteId = systemIdSiteMap.get(systemId);
  if (!siteId) return null;
  return siteChannelMap.get(siteId) || null;
}

export async function getSiteRecordId(
  customerRecordId: string,
  systemId?: string | null,
  knownChannel?: string | null,
): Promise<string | null> {
  await ensureSitesCache();
  if (systemId && systemIdSiteMap.has(systemId)) {
    return systemIdSiteMap.get(systemId)!;
  }
  const sites = customerSiteMap.get(customerRecordId);
  if (!sites || sites.length === 0) return null;
  if (sites.length === 1) return sites[0];

  // Multiple sites for this customer — prefer the one whose cs_channel matches the known channel.
  // knownChannel is already resolved upstream (via fetchSystemRegion + existing-ticket fallback in
  // the create route), so this is the most reliable disambiguation source.
  if (knownChannel) {
    const byChannel = sites.find(siteId => siteChannelMap.get(siteId) === knownChannel);
    if (byChannel) return byChannel;
  }

  // Secondary fallback: use fetchSystemRegion to get the region string, then find tickets in
  // Airtable with the same system prefix that have a known channel — not feasible here without
  // DB access, so fall through to siteChannelMap scan vs. any non-null channel match.
  return sites[0];
}

export function mapAirtableToTicket(record: AirtableRecord) {
  const f = record.fields;

  const isOpen = f.is_open === "true" || f.is_open === true;
  const status = isOpen ? "open" : "closed";

  const priorityLabel = String(f.priority || "");
  const priorityStr = priorityLabel.toLowerCase();
  let priority = "medium";
  if (priorityStr.includes("p1") || priorityStr.includes("high") || priorityStr.includes("critical")) {
    priority = "high";
  } else if (priorityStr.includes("p3") || priorityStr.includes("p4") || priorityStr.includes("low") || priorityStr.includes("project") || priorityStr.includes("other")) {
    priority = "low";
  }

  const ticketNumber = f.ticket_id ? String(f.ticket_id) : null;
  const description = f.description ? String(f.description) : "No description";
  const assigneeName = f.assignee_name ? String(f.assignee_name).trim() : null;
  const customerName = f.customer_name
    ? String(Array.isArray(f.customer_name) ? f.customer_name[0] : f.customer_name)
    : null;
  const contactName = f.contact_full_name
    ? String(Array.isArray(f.contact_full_name) ? f.contact_full_name[0] : f.contact_full_name)
    : null;
  const contactEmail = f.contact_email ? String(f.contact_email) :
    f.email ? String(f.email) :
    f.customer_email ? String(f.customer_email) : null;
  const contactPhone = f.contact_phone ? String(f.contact_phone) :
    f.phone ? String(f.phone) :
    f.customer_phone ? String(f.customer_phone) : null;
  const csChannel = f.cs_channel ? String(f.cs_channel) : null;
  const resolution = f.resolution ? String(f.resolution) : null;
  const systemId = f.system_id
    ? String(Array.isArray(f.system_id) ? f.system_id[0] : f.system_id)
    : null;
  const commsDirection = f.comms_direction ? String(f.comms_direction) : null;
  const escalationSource = f.receipt_method ? String(f.receipt_method) : null;
  const region = f.region
    ? String(Array.isArray(f.region) ? f.region[0] : f.region)
    : null;
  const submittedAt = f.submission_time_utc ? new Date(f.submission_time_utc) : null;

  let resolvedAt: Date | null = null;
  if (f.resolution_time_epoch) {
    resolvedAt = new Date(Number(f.resolution_time_epoch) * 1000);
  } else if (f.resolution_time_from) {
    const parsed = new Date(f.resolution_time_from);
    if (!isNaN(parsed.getTime())) resolvedAt = parsed;
  }

  return {
    airtableRecordId: record.id,
    ticketNumber,
    title: ticketNumber || "Untitled",
    description,
    status,
    priority,
    priorityLabel: priorityLabel || null,
    assigneeName,
    customerName,
    contactName,
    contactEmail,
    contactPhone,
    systemId,
    csChannel,
    commsDirection,
    escalationSource,
    region,
    resolution,
    submittedAt,
    resolvedAt,
    submittedBy: f.submitter_name ? String(f.submitter_name).trim() : null,
  };
}

const PARTS_ORDERS_BASE_ID = "appe6WGBd1tZKT4Wn";
const PARTS_ORDERS_TABLE_ID = "tbl99oGfVz4CfKMj3";

export async function createPartsOrderRecord(fields: {
  ticketNumber: string;
  customerName?: string | null;
  csChannelId?: string | null;
  asaOrSysNumber?: string;
  vendorPartNumber?: string;
  partDescription?: string;
  needByDate?: string;
  workOrderNumber?: string;
  submittedByName: string;
  submittedBySlackId?: string | null;
  slackThreadUrl?: string | null;
}): Promise<string | null> {
  if (!AIRTABLE_PAT) return null;
  const now = new Date().toISOString();
  const record: Record<string, string> = {
    "Ticket ID": fields.ticketNumber,
    "Time Submitted (UTC)": now,
    "Submitted By": fields.submittedByName,
    "Status": "Open",
  };
  if (fields.customerName) record["Customer Name"] = fields.customerName;
  if (fields.csChannelId) {
    record["Customer CS Channel"] = fields.csChannelId;
    record["Slack Channel ID"] = fields.csChannelId;
  }
  if (fields.asaOrSysNumber) record["ASA or SYS #"] = fields.asaOrSysNumber;
  if (fields.vendorPartNumber) record["Brand, Vendor, Part Number"] = fields.vendorPartNumber;
  if (fields.partDescription) record["Part Description"] = fields.partDescription;
  if (fields.needByDate) record["Need by date"] = fields.needByDate;
  if (fields.workOrderNumber) record["Work Order"] = fields.workOrderNumber;
  if (fields.slackThreadUrl) record["Slack thread"] = fields.slackThreadUrl;
  if (fields.submittedBySlackId) record["Submitted ID"] = fields.submittedBySlackId;

  try {
    const response = await fetch(`${AIRTABLE_API_BASE}/${PARTS_ORDERS_BASE_ID}/${PARTS_ORDERS_TABLE_ID}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_PAT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: record }),
    });
    if (!response.ok) {
      const err = await response.json();
      console.error("[Airtable] createPartsOrderRecord failed:", JSON.stringify(err));
      return null;
    }
    const data = await response.json() as any;
    console.log("[Airtable] Parts order record created:", data.id);
    return data.id || null;
  } catch (err: any) {
    console.error("[Airtable] createPartsOrderRecord error:", err.message);
    return null;
  }
}
