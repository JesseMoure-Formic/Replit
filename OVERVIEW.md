# Formic Field Ticketing — App Overview

Internal ISR (Incident & Service Request) tracker for Formic Technologies. Used by field engineers, account managers, and team leads to log, track, escalate, and close robot service tickets.

---

## Pages

| Route | What it does |
|---|---|
| `/` | Main dashboard — ticket table, filters, saved views, analytics |
| `/daily-review` | Daily standup view — P1/P2 tickets, hyper-care, install updates, Slack post |
| `/closed-tickets` | Archive of resolved tickets with bucket insights |
| `/sop` | Standard Operating Procedure reference guide |
| `/check-in` | Dashboard with the quick check-in dialog pre-opened |
| `/login` | Replit SSO authentication |

---

## Ticket Lifecycle

1. **Create** — New ticket is logged with customer, system ID, priority, assignee, and description
2. **Slack notification** — Auto-posted to the central Slack channel; a thread is opened
3. **Work in progress** — Engineers add next steps, update escalation level, and sync notes back to Slack
4. **Escalation** — 4-tier system (Standard → Elevated → High → Critical); high-tier escalations require manager-level role
5. **Close** — AI generates a Final Determination and Final Solution summary; closure post sent to Slack
6. **Reopen** — Ticket can be reopened with a reason; history is preserved
7. **Convert to Project** — Ticket is sent to the Project Tracker app; a live 6-step status bar (Sent → Scoping → Resources → In Progress → Timeline → Created) syncs in real time as the PM app updates the project

---

## Core Features

### Ticket Management
- Rich edit dialog with customer, system ID, priority, assignee, description, and next steps
- `Parts Needed` flag with automated Slack message to the parts channel and Airtable record creation
- Tags (including auto-applied `project` tag on conversion)
- Full history log — every edit, escalation change, and project tracker update is recorded

### Filters & Views
- Multi-select column filters (status, priority, assignee, customer, region, escalation, tags, parts flag)
- Natural language smart search powered by Claude AI (e.g. "my P1 tickets this week")
- Saved views — personal and global; any filter combination can be saved and shared

### AI Features
- **Auto-title** — generates a concise title from a long issue description
- **Text polish** — rewrites draft descriptions and next steps for clarity
- **Close assist** — drafts Final Determination and Final Solution at ticket closure
- **Smart search** — parses freeform queries into structured filters
- **Bucket categorization** — classifies closed tickets into Issue Type and Solution Type buckets for insights

### Daily Review
- Auto-pulls open P1/P2 tickets, hyper-care customers, and scheduled installs from Airtable
- Editable standup notes per ticket
- One-click post to the `#daily-review` Slack channel

### Analytics
- Ticket volume over time
- Average ticket age by assignee
- Region breakdown
- Systems Visited tracker (pulls from MaintainX work orders)
- Closed Ticket Insights — bucket-level breakdown of resolved issue and solution types

### Customer Directory
- Synced from Airtable (118 customers, 270+ site mappings)
- Searchable contact list with dedup merge tool
- System ID lookup used throughout the ticket form

### Role System
- Roles: Admin, Manager, Field Engineer, Account Manager, Requester (fully configurable)
- Permissions per role: close tickets, reopen, edit daily review, manage escalations, access admin tools, manage roles
- Hierarchy order enforced — you can only assign roles below your own level

---

## Integrations

### Slack
- New ticket posts → `#central` channel
- Thread replies synced back from app updates
- Parts order requests → `#parts-tracking` channel
- Daily Review posts → `#daily-review` channel
- Check-in status updates → posted as Slack messages
- @mention resolution — names resolve to Slack user IDs in notifications

### Airtable
- **ISR Tickets table** — source of truth for ticket records (bidirectional sync)
- **Parts Requests table** — new record created on every Parts Order submission
- **JobsDB / FJD** — customer and system ID reference data
- **Confirmed Installs** — feeds the Daily Review install section

### Claude AI (Haiku)
- Smart search query parsing
- Text polishing and auto-title
- Close assist summaries
- Ticket bucket categorization

### MaintainX
- Work order data pulled for the Systems Visited analytics section

### Gmail
- Outbound support emails composed and sent directly from a ticket's edit dialog

### Project Tracker (external app)
- `POST /api/convert-to-project` — sends ticket data to the PM app
- `POST /api/convert-to-project/complete/:ticketId` — PM app calls this (or manual override) to mark project as created
- Tracker polls every 10 seconds and reflects the current step set by the PM app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| Routing | Wouter |
| UI | Shadcn/ui + Tailwind CSS |
| Data fetching | TanStack Query v5 |
| Backend | Express + TypeScript |
| Database | PostgreSQL via Drizzle ORM |
| Auth | Replit SSO |
| AI | Anthropic Claude (Haiku) |
| Charts | Recharts |

---

## Key Environment Variables

| Variable | Purpose |
|---|---|
| `AIRTABLE_PERSONAL_ACCESS_TOKEN` | Airtable API access |
| `AIRTABLE_BASE_ID` | ISR Airtable base |
| `AIRTABLE_TABLE_ID` | ISR tickets table |
| `SLACK_BOT_TOKEN` | Slack posting and user lookup |
| `MAINTAINX_API_KEY` | MaintainX work order sync |
| `SESSION_SECRET` | Express session signing |
| `INTER_APP_SECRET` | Auth between ISR and Project Tracker |
| `ISR_API_KEY` | Inbound API key for external callers |
