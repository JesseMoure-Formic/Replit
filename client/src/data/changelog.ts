export type ChangeType = "Major" | "Minor" | "Patch";

export interface ChangelogEntry {
  version: string;
  type: ChangeType;
  date: string;
  title: string;
  changes: string[];
}

export interface MajorFunction {
  name: string;
  description: string;
  status: "Live" | "Beta" | "Planned";
  tokenCount: number;
}

export interface MinorFeature {
  name: string;
  description: string;
  tokenCount: number;
}

// Token counts derived from actual file sizes (chars ÷ 4).

export const majorFunctions: MajorFunction[] = [
  {
    name: "Ticket Management",
    description: "ISR ticket dashboard with real-time filtering, sorting, bulk actions, and mobile view. Inline edit dialog covers title, assignee, priority, status, next steps, escalation level, and close/reopen workflow. Triage mode surfaces unassigned tickets. SSO and role-based access (Admin, Manager, Agent, Requester) control permissions.",
    status: "Live",
    tokenCount: 42298,
  },
  {
    name: "Data & Integrations",
    description: "Bi-directional Airtable sync for tickets, customers, and contacts. Customer directory with full contact lists cached locally. System alias editor writes to the Formic Job Database. Email customer compose dialog. Saved views (global and personal) with per-user defaults.",
    status: "Live",
    tokenCount: 21900,
  },
  {
    name: "Slack Integration",
    description: "Bot posts ticket creation, updates, and thread-replies to per-site and central channels. /ticket slash command for creating and looking up tickets from Slack. Check-in flow posts FSE arrival details and all open site tickets to the CS channel. File attachments from ticket dialogs post directly to Slack threads.",
    status: "Live",
    tokenCount: 14573,
  },
  {
    name: "Daily Review",
    description: "Morning briefing page with P1/P2 tickets, confirmed installs (grouped by customer+date), delayed installs, hyper-care, and parking lot sections. Posts to Slack with a stats block, closed P1/P2 section, and empty-section suppression. Locked read-only with a 'Sent to Slack' badge after posting.",
    status: "Live",
    tokenCount: 28000,
  },
  {
    name: "AI & Analytics",
    description: "Claude-powered automatic title generation and AI Assist buttons for description, next steps, and close-ticket fields. Analytics dashboard with open-ticket charts, priority breakdown, resolution trends, and assignee workload.",
    status: "Live",
    tokenCount: 7626,
  },
];

export const minorFeatures: MinorFeature[] = [
  { name: "Filtering, Sorting & Search", description: "Status chips, priority, assignee, customer, and keyword filters. Advanced panel with date range, region, escalation source, and system ID. Column sort and per-column filter popovers. Overdue/due-today quick-apply chips.", tokenCount: 5990 },
  { name: "Ticket Form UX", description: "Keyboard-searchable dropdowns for Customer, System ID, Assignee, and Contact. Rich text description editor. @mention and #channel autocomplete. Contact info popover. Notify multi-select. Internal-Only customer option. Discard-changes confirmation.", tokenCount: 5030 },
  { name: "Inline Ticket Actions", description: "Close/Reopen workflow with final determination fields and Slack notification. Priority change directly from the table row — no dialog needed.", tokenCount: 1430 },
  { name: "Audit / History Trail", description: "Per-ticket history log showing who changed what and when.", tokenCount: 1300 },
  { name: "Install Lines Editor", description: "Structured INST/FSE/WO// block editor for confirmed and delayed install sections. Same-customer/same-date systems group into a single card with shared FSE, date, WO, and comment fields.", tokenCount: 2800 },
  { name: "Daily Review Enhancements", description: "Stats snapshot (open count, P1–P4, 24h/7d opened/closed) posted to Slack. Closed P1/P2 section auto-computed. Empty sections suppressed. Review locked read-only with 'Sent to Slack' badge after posting.", tokenCount: 2100 },
  { name: "Slack File Attachments", description: "Attach files directly from the New or Edit ticket form. In edit mode, uploads immediately to the Slack thread; in new-ticket mode, queues and uploads automatically after ticket creation.", tokenCount: 1200 },
  { name: "Sync & Data Quality", description: "Rate-limit on manual sync prevents Airtable API overuse. Startup deduplication repairs Airtable sync artifacts. FJD active-wins logic excludes closed system IDs from dropdowns.", tokenCount: 1660 },
  { name: "Saved Views & Exports", description: "Per-user default view auto-applied on login. Email list export generates a formatted digest of the current filtered ticket set.", tokenCount: 850 },
  { name: "UI Polish", description: "Full dark/light theme support. Time-since-last-update shown per ticket row. Formic logo navigates home from any page.", tokenCount: 610 },
];

export const changelog: ChangelogEntry[] = [
  {
    version: "2.7.0",
    type: "Minor",
    date: "2026-04-15",
    title: "Role Hierarchy, Custom Roles & Generate Daily Report Permission",
    changes: [
      "New 'Generate Daily Report' permission controls who can trigger daily report generation — separate from the Edit Daily Review permission.",
      "Hierarchy order: use ↑↓ arrows in Configure Roles to set which roles rank above others.",
      "Add custom roles with a name of your choice; set their permissions the same as built-in roles.",
      "Delete custom roles at any time; built-in roles (Admin, Manager, Agent, Requester) are protected.",
      "Custom roles are fully supported in the Users tab — assign any user to any built-in or custom role.",
      "Permissions for custom roles are applied dynamically — users inherit the correct access on next load.",
    ],
  },
  {
    version: "2.6.0",
    type: "Minor",
    date: "2026-04-14",
    title: "Parts Ordering via Slack",
    changes: [
      "Order parts directly from the Edit Ticket dialog — system ID and ASA number pre-fill from the open ticket automatically.",
      "Posts a formatted request to the #parts-tracking Slack channel with machine details, site info, and requester @mention.",
      "Creates an Airtable record in the Parts Requests table automatically on submission.",
      "Form shows a Slack permalink after the order is sent so the requester can jump to the thread.",
      "The Slack notification includes a direct link to open the full Parts workflow for follow-up.",
    ],
  },
  {
    version: "2.5.9",
    type: "Patch",
    date: "2026-04-14",
    title: "Submitter Name & ASA Data Integrity",
    changes: [
      "Submitter name now recorded on all ticket creation paths: web form, admin fix, and Slack /ticket command.",
      "Fixed ASA record linking — getAsaRecordId now returns the correct jobsdb_sync record ID instead of hunting inside fields.",
      "Backfilled submitter_name for ~428 historical tickets and ASA field for ~141 tickets that were missing data.",
    ],
  },
  {
    version: "2.5.8",
    type: "Patch",
    date: "2026-04-14",
    title: "Ticket UX & Access Improvements",
    changes: [
      "Closing a ticket now requires both Issue Type and Solution fields to be completed before saving.",
      "All logged-in @formic.co users can view the Daily Review page (previously restricted to admins).",
      "Toggle buttons (Parts Needed, escalation) repositioned above system ID for a cleaner ticket row layout.",
      "Ticket title displayed as plain text; the ISR number is now the clickable deep-link.",
      "Check-in site selector now dynamically pulls all customers from Airtable instead of a fixed list.",
      "Mobile ticket cards improved — better field spacing and corrected Slack channel name display.",
    ],
  },
  {
    version: "2.5.7",
    type: "Minor",
    date: "2026-04-13",
    title: "Analytics & Insights Overhaul",
    changes: [
      "Tickets created per person added to the Insights page — top 9 contributors shown with an aggregated 'Other' bucket.",
      "All-time submission totals and historical backfill populate per-user ticket counts from day one.",
      "Ticket statistics broken down by region on the Insights page.",
      "Authorized users can group and rename regions directly from the Insights panel.",
      "Escalation level added as a filter on the main dashboard and saved into named views.",
      "Flexible time-range selector (7 days, 30 days, all time) across analytics charts.",
      "Sticky summary header keeps ticket stats visible while scrolling through long ticket lists.",
      "Closed ticket duration tracked accurately using the resolution date as the end point.",
      "Slack-resolved display names shown in analytics charts (replaces raw email addresses).",
      "Assignee filter on analytics — click any bar to filter the ticket list by that person.",
    ],
  },
  {
    version: "2.5.6",
    type: "Minor",
    date: "2026-04-10",
    title: "AI Bucketization & Closed Ticket Insights",
    changes: [
      "Auto-condense similar ticket categories — AI merges near-duplicate bucket names into a single canonical label.",
      "'Reassess All Closed Tickets' button recategorizes all historical tickets against the current bucket definitions.",
      "Clear All button removes all issue and solution type definitions for a clean slate.",
      "AI Classify button on the Closed Ticket Insights page hidden for non-admin users.",
      "Chart readability improvements — long label wrapping, labels placed above bars, adjusted spacing.",
      "Ticket issue types and solution types display human-readable names instead of database IDs.",
    ],
  },
  {
    version: "2.5.5",
    type: "Patch",
    date: "2026-04-08",
    title: "SOP, Smart Search & MaintainX Improvements",
    changes: [
      "Inline screenshot insert and replace for any SOP section — upload an image and it renders in the doc immediately.",
      "Ticket ownership and reassignment rules added to the SOP page.",
      "SOP editing restricted to Admins only; non-admins see a clearly labeled read-only view.",
      "AI smart search now handles priority prefixes (P1:, P2:) and escalation terms without breaking results.",
      "Self-healing fallback for AI searches that return no results — retries with a relaxed query.",
      "MaintainX tracker now identifies scheduled preventive maintenance by analyzing WO titles, tracks unvisited systems, and shows PM completion percentage on asset cards.",
      "Parts Needed toggle added to ticket rows — marks a ticket as waiting on parts with a visible badge in the table.",
    ],
  },
  {
    version: "2.5.4",
    type: "Patch",
    date: "2026-04-14",
    title: "Tags Bubble — Optimistic UI Fix",
    changes: [
      "Tag chips now appear immediately when a tag is added — no longer requires closing and reopening the ticket.",
      "Removing a tag also disappears instantly without waiting for the server round-trip.",
      "If the save fails the tag reverts automatically, keeping the UI consistent with the server state.",
    ],
  },
  {
    version: "2.5.3",
    type: "Patch",
    date: "2026-04-07",
    title: "Confirmed Installs Grouping & Navigation Polish",
    changes: [
      "Same-customer/same-date installs now render as a single card in the Daily Review editor — system IDs appear inline (e.g. #FLOORGRD_SYS1, #FLOORGRD_SYS2, #FLOORGRD_SYS3) with individual delete buttons per system.",
      "Server sorts installs by customer then installationStarts at generation time so same-install systems are always adjacent.",
      "Editing FSE name, install date, FSE arrival, WO, or comment on a grouped card updates all systems in that group simultaneously.",
      "Clicking the Formic mark in either the main dashboard or the Daily Review header navigates back to the Service Requests page.",
      "Empty sections (Hyper Care, Delayed, Parking Lot, Next Parking Lot) are now fully suppressed from the Slack post — no divider or label is emitted when a section has no content.",
    ],
  },
  {
    version: "2.5.2",
    type: "Minor",
    date: "2026-04-05",
    title: "Daily Review Slack Lock & Snapshot Stats",
    changes: [
      "Daily Review becomes read-only after posting to Slack — a green 'Sent to Slack' badge replaces the Post button and all section editors are locked.",
      "Open ticket count, P1–P4 breakdown, and 24h/7d opened/closed counts are captured as a snapshot at review creation time and stored in the database.",
      "The stats bar always shows the frozen snapshot values (not live counts) for posted reviews, so the numbers match what was sent to Slack.",
      "Slack post includes a formatted stats block directly after the header line.",
      "Confirmed Installs grouped by customer+date in the Slack post (same as the app UI) — multiple systems for the same customer and install date appear in a single entry.",
      "✅ P1 & P2 Closed Since Last Review section auto-computed and inserted in the Slack post, using the previous review's date as the cutoff.",
    ],
  },
  {
    version: "2.5.1",
    type: "Minor",
    date: "2026-04-03",
    title: "Role Management System",
    changes: [
      "Admin panel (Admin-only) for assigning roles to @formic.co users: Admin, Manager, Agent, and Requester.",
      "Role controls UI access: Admins and Managers see all actions; Agents have full edit rights; Requesters see a read-only view.",
      "Role assignments take effect on the user's next page load.",
      "Only @formic.co email accounts are listed in the role panel.",
    ],
  },
  {
    version: "2.5.0",
    type: "Minor",
    date: "2026-04-01",
    title: "Escalation Level System",
    changes: [
      "Four-tier escalation flag added to each ticket: Standard (green), Elevated (amber), High (orange), Critical (red).",
      "Escalation badge displayed on ticket rows and in the edit dialog with color-coded indicators.",
      "Inline escalation toggle from the ticket row — no need to open the full edit dialog.",
      "Escalation level changes trigger a Slack notification to the ticket's channel.",
      "Escalation level included in Slack ticket-creation and update messages.",
    ],
  },
  {
    version: "2.4.6",
    type: "Minor",
    date: "2026-03-24",
    title: "Slack File Upload from Ticket Dialogs",
    changes: [
      "A new 'Attach file to Slack' section appears in both the New Ticket and Edit Ticket forms.",
      "In edit mode, selecting a file and clicking 'Upload now' immediately posts the file into the ticket's Slack thread.",
      "In new ticket mode, selecting a file queues it — it is automatically uploaded to Slack right after the ticket is created.",
      "Uploaded files appear as clickable Slack permalink links inside the form once the upload succeeds.",
      "Express JSON body limit raised from 5 MB to 15 MB to accommodate base64-encoded file payloads.",
    ],
  },
  {
    version: "2.4.5",
    type: "Patch",
    date: "2026-03-24",
    title: "Confirmed Installs — Editable Fields & Cleanup",
    changes: [
      "Fixed a bug where typing spaces in Confirmed Install comments was impossible — each keystroke re-parsed the stored text and .trim() silently ate every trailing space.",
      "Install Date, DPLY FSE name, and FSE Arrival date are now editable inline. Changes write back to Airtable on blur.",
      "Installs with no FSE Arrival date are excluded when the Confirmed Installs section is built from Airtable.",
    ],
  },
  {
    version: "2.4.4",
    type: "Patch",
    date: "2026-03-24",
    title: "Ticket 'Time Since Last Update' Fixed",
    changes: [
      "Fixed time-since-last-update always showing a few minutes because the background Airtable sync bumped a database timestamp on every ticket. Now uses only human history entries as the source of truth.",
    ],
  },
  {
    version: "2.4.3",
    type: "Patch",
    date: "2026-03-24",
    title: "@Mention Autocomplete Fixed",
    changes: [
      "Fixed @ and # autocomplete in the Next Steps field — typing @ shows Slack team members; typing # shows channels.",
      "Same autocomplete added to the Description rich-text editor in both inline and expanded modes.",
      "Dropdown is pre-filtered as you type on partial name matches.",
    ],
  },
  {
    version: "2.4.2",
    type: "Patch",
    date: "2026-03-24",
    title: "Claude AI Migration & Sync Bug Fix",
    changes: [
      "All AI features now run on Anthropic's Claude instead of OpenAI GPT-4o-mini.",
      "Fixed a ReferenceError crash in the Airtable sync loop when back-populating slack_ts to Airtable for existing tickets.",
    ],
  },
  {
    version: "2.4.1",
    type: "Patch",
    date: "2026-03-24",
    title: "FJD Active-Wins & Login Crash Fix",
    changes: [
      "Fixed system ID dropdown showing all systems for customers with both active and canceled FJD records. Now uses two-pass approach — any system with at least one active FJD record is kept.",
      "Fixed server crash on login when a user's Replit account ID changed but the email remained the same.",
    ],
  },
  {
    version: "2.4.0",
    type: "Minor",
    date: "2026-03-23",
    title: "AI Assist, Thread Links & Check-In Improvements",
    changes: [
      "✨ AI Assist button next to the Description field — plain English polished to professional ticket copy.",
      "✨ AI Assist button next to the Next Steps field.",
      "✨ AI Assist button in the Close Ticket panel — fills both Final Determination and Final Solution simultaneously.",
      "Title auto-regenerates (debounced 2.5 s) when the description changes in edit mode.",
      "Slack thread link added to the edit dialog — 'Thread ↗' deeplinks directly to the ticket's Slack thread.",
      "Check-in Slack message now lists all open tickets at the same customer location grouped by system ID.",
    ],
  },
  {
    version: "2.3.1",
    type: "Patch",
    date: "2026-03-22",
    title: "System Alias Write & Display Fix",
    changes: [
      "Fixed alias save writing to the correct Airtable field 'System Alias Nickname' in the Formic Job Database.",
      "Alias now reflects immediately after saving without a stale Airtable re-read.",
      "Restored getAsaRecordId() after accidental removal.",
      "Fixed searchable dropdown closing when clicking into the search input.",
    ],
  },
  {
    version: "2.3.0",
    type: "Minor",
    date: "2026-03-21",
    title: "System Alias Inline Editor & Enhanced System ID Labels",
    changes: [
      "CPU icon toggle in the edit ticket form opens an inline 'Edit System Info' panel.",
      "System ID dropdown labels now include region, vendor, and alias (e.g. 'FRESCMEX_SYS4 — (98-SEA) — Formic').",
      "FJD record cache warm-up at startup ensures alias lookups are fast.",
      "Closed system IDs are excluded from the system ID dropdown.",
    ],
  },
  {
    version: "2.2.0",
    type: "Minor",
    date: "2026-03-20",
    title: "Contact Popover, UX Hardening & Slack Thread Replies",
    changes: [
      "Clickable contact info popover shows email and phone with one-tap copy/dial links.",
      "Slack thread replies: ticket history updates post as replies to the original ticket thread.",
      "Central Slack channel receives all ticket update events in addition to the per-site channel.",
      "Discard-changes confirmation dialog when closing an edit form with unsaved edits.",
      "Time since last update shown below the assignee name in the ticket table.",
    ],
  },
  {
    version: "2.1.0",
    type: "Minor",
    date: "2026-03-19",
    title: "Internal-Only Tickets, Default Views & Notify Multi-Select",
    changes: [
      "\"Internal Only\" customer option creates tickets without requiring a system ID.",
      "Per-user default view: users can designate any saved view as their default, auto-applied on login.",
      "Notify field now supports multi-select so multiple teammates receive Slack mention alerts.",
    ],
  },
  {
    version: "2.0.0",
    type: "Major",
    date: "2026-03-18",
    title: "Customer Directory, Searchable Dropdowns & Rich Text Editor",
    changes: [
      "Customer Directory page displays all customers with their contacts, pulled from Airtable and cached locally.",
      "All ticket form dropdowns upgraded to searchable selects with keyboard navigation.",
      "Rich text editor (bold, italic, lists) for the ticket description field.",
      "Slack @mention and #channel autocomplete in free-text ticket entry fields.",
    ],
  },
  {
    version: "1.9.0",
    type: "Minor",
    date: "2026-03-17",
    title: "Daily Review Install Intelligence",
    changes: [
      "Confirmed Installs carry forward WO numbers and comments from the previous day's review.",
      "Installs dropped from today's Airtable list (but not yet past their start date) are automatically moved to Delayed/Moved Installs.",
      "Delayed/Moved Installs section uses InstallLinesEditor for structured INST block display.",
    ],
  },
  {
    version: "1.5.0",
    type: "Major",
    date: "2026-03-10",
    title: "Saved Views & Personal Filters",
    changes: [
      "Saved Views menu with global and personal named filter presets.",
      "Views support any combination of status, priority, assignee, and customer filters.",
      "Delete-view button on personal views.",
    ],
  },
  {
    version: "1.4.0",
    type: "Major",
    date: "2026-03-06",
    title: "Priority Management & History",
    changes: [
      "Inline priority editor in the ticket table.",
      "Priority changes pushed back to Airtable in real time.",
      "Change history log tracks priority edits with user and timestamp.",
      "P1–P4 priority tier structure.",
    ],
  },
  {
    version: "1.3.0",
    type: "Major",
    date: "2026-02-28",
    title: "Slack Integration & Notifications",
    changes: [
      "Slack bot posts ticket creation messages with assignee @mentions.",
      "/ticket slash command for creating tickets from Slack.",
      "Ticket update events trigger Slack thread replies.",
      "Close/Reopen workflow sends status-change notification to Slack.",
    ],
  },
  {
    version: "1.2.0",
    type: "Major",
    date: "2026-02-20",
    title: "AI Titles, Email, & Analytics",
    changes: [
      "AI integration auto-generates ticket titles from descriptions.",
      "Email Customer button opens compose dialog with pre-filled recipient.",
      "Analytics dashboard with open-ticket charts and assignee workload.",
      "Daily Review page surfaces tickets needing same-day attention.",
    ],
  },
  {
    version: "1.1.0",
    type: "Major",
    date: "2026-02-10",
    title: "Airtable Sync & Ticket Editing",
    changes: [
      "Bi-directional Airtable sync (tickets, customers, contacts, sites).",
      "In-line edit dialog for title, assignee, priority, status, notes.",
      "Audit trail records all edits with user and timestamp.",
      "Advanced filter panel with date range, region, and escalation source.",
      "Triage mode for prioritizing unassigned/new tickets.",
    ],
  },
  {
    version: "1.0.0",
    type: "Major",
    date: "2026-02-01",
    title: "Initial Launch",
    changes: [
      "ISR ticket tracker built on Airtable and PostgreSQL.",
      "SSO restricted to @formic.co emails via Replit OAuth.",
      "Ticket table with status, priority, customer, assignee, and age columns.",
      "Formic branding with orange/dark color scheme.",
    ],
  },
];

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
