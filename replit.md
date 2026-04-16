# Ticket Tracker

A full-stack app to track tickets across Slack and Airtable with AI-generated summaries.

## Architecture

- **Frontend**: React + TanStack Query + shadcn/ui components
- **Backend**: Express.js + Drizzle ORM + PostgreSQL
- **Integrations**: Slack (via Replit connector), Airtable (REST API with PAT), OpenAI (via Replit AI Integrations)

## Key Features

- **AI Ticket Bucketization**: When closing a ticket, Claude classifies the root cause and resolution into named categories (buckets). Existing buckets are reused; new ones are auto-created. Bucket counts track usage frequency. Visible on closed tickets as "AI Problem Classification".
- Create, edit, and delete tickets with status and priority
- Sync tickets from Airtable (imports records with ISR numbers, descriptions, priority labels)
- AI-generated ticket titles from descriptions (OpenAI gpt-4o-mini via Replit AI Integrations)
- ISR ticket numbers displayed as IDs (e.g., "ISR - 1072")
- Full priority labels shown (e.g., "FS: P1: Robot Down")
- Push new/updated tickets back to Airtable (writable fields: description, assignee_name, priority, resolution, comms_direction, region)
- Ticket creation sends description, priorityLabel, assignee_name, and escalation source to Airtable on record creation
- Priority changes (inline dropdown) sync back to Airtable's `priority` free-form text field
- Slack notifications posted to customer CS channel on ticket creation (bot must be manually invited to channels)
- Slack connectivity check on sync
- Visual indicators showing which tickets are linked to Airtable or Slack
- Email Customer compose dialog (sends from support@formic.co via Gmail integration)
  - Supports multiple recipients (comma-separated To/CC)
  - Email templates with personal and global (shared) options
  - Template variables: `{{ticketRef}}`, `{{customerName}}` auto-fill when loaded

## Environment Variables / Secrets

- `DATABASE_URL` — PostgreSQL connection (auto-provisioned)
- `AIRTABLE_PERSONAL_ACCESS_TOKEN` — Airtable PAT
- `AIRTABLE_BASE_ID` — Airtable base ID (appe6WGBd1tZKT4Wn)
- `AIRTABLE_TABLE_ID` — Airtable table ID (tbldEb28OPP75vHBt)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key (Replit AI Integrations, auto-injected)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL (Replit AI Integrations, auto-injected)
- Slack token managed via Replit connector (auto-injected)

## Airtable Field Mapping

- `ticket_id` → ticketNumber (ISR number, displayed as ID column)
- `description` → description (used for AI title generation)
- `priority` → priorityLabel (full label like "FS: P2: Robot Down") + derived priority (high/medium/low)
- `is_open` → status derivation (formula field based on `resolution_time_from_slack`)
- `resolution_time_from_slack` → writable source field that controls `is_open`, `resolution_time_utc`, `resolution_time_epoch`
- `assignee_name` → assigneeName
- `customer_name` → customerName
- `contact_full_name` → contactName (linked record, resolved by name → record ID lookup)
- `contact_email` / `email` / `customer_email` → contactEmail (tries multiple field names)
- `contact_phone` / `phone` / `customer_phone` → contactPhone (tries multiple field names)
- `comms_direction` → commsDirection
- `receipt_method` → escalationSource (mapped: "Phone Call" → "Support Phone Line (RingCentral)", "Email" → "Support Email (support@formic.co)", others → "Other")
- `cs_channel` → csChannel (Slack channel for customer notifications)
- `resolution` → resolution
- `resolution_time_epoch` / `resolution_time_from` → resolvedAt (used for analytics duration calculation)
- `ticket_id` and `priority` are computed fields — NOT written back to Airtable
- Close ticket: writes `resolution` + `resolution_time_from_slack` to Airtable (flips `is_open` to false)
- Reopen ticket: clears `resolution` + sets `resolution_time_from_slack` to null (flips `is_open` to true)

## Database Schema

### tickets table
- id (serial PK), ticketNumber (ISR number), title (AI-generated), description, status, priority, priorityLabel, assigneeName, customerName, contactName, contactEmail, contactPhone, systemId, csChannel, commsDirection, escalationSource, resolution, nextSteps, estimatedNextUpdate, submittedAt, resolvedAt, slackMessageId, airtableRecordId, submittedBy (display name of who created the ticket), createdAt, updatedAt

### saved_views table
- id (serial PK), name, isGlobal (boolean), userId (varchar), filters (jsonb: { status?, priority?, assignee? }), createdAt

### email_templates table
- id (serial PK), name, subject, body, isGlobal (boolean), userId (varchar), createdAt
- Templates support `{{ticketRef}}` and `{{customerName}}` placeholders that auto-fill when loaded

### daily_reviews table
- id (serial PK), date (varchar unique, YYYY-MM-DD), sections (jsonb), createdBy, updatedBy, createdAt, updatedAt
- Sections: p1p2Tickets, hyperCare, p3Tickets, confirmedInstalls, delayedInstalls, parkingLot, usefulLinks, connectivityConcerns, onCallRotation
- p1p2Tickets and p3Tickets use TicketLinesEditor: structured grid display with Slack hyperlinks (system ID → channel, assignee → search), aligned columns (130px sysId, 140px assignee, 100px nextUpdate, 90px ticketNum, 1fr title), editable `// ` comment inputs under each ticket
- Stored text format: `{sysId}, {assignee}, {nextUpdate}, {ticketNum}\n// {comment}\n...`
- Parser/serializer preserves ordered content blocks (ticket blocks + free text blocks) so edits don't reorder content

## Authentication

- Replit Auth (OIDC) with Google, GitHub, Apple, email login
- Domain restriction: only @formic.co email addresses can access the app
- Middleware chain: `isAuthenticated` (session check) → `requireFormicEmail` (domain check) on all API routes
- Non-@formic.co users get 403 and session is destroyed
- Login page: split-screen with Formic branding (left) and sign-in button (right)
- User email shown in header; logout button links to `/api/logout`

## Branding

- Colors: Formic orange `#FF9100`, dark teal-black `#091517`, mint white `#F0F5F1`, gray-greens `#333E3C`, `#9BA19E`, `#D1D5D4`
- Header: dark `#091517` glass effect with Formic angular "F" mark in orange
- Primary action buttons use `#FF9100` orange
- Table header: dark `#091517` background with light text
- Logo components: `FormicLogo` (full wordmark) and `FormicMark` (F icon only) in `client/src/components/formic-logo.tsx`

## Project Structure

```
server/
  index.ts        - Entry point
  routes.ts       - API routes + sync logic (batched AI title generation)
  storage.ts      - Database storage layer
  db.ts           - Drizzle + PostgreSQL connection
  slack.ts        - Slack client (Replit connector)
  airtable.ts     - Airtable REST API helpers + field mapping
  ai-summary.ts   - OpenAI-powered title generation from descriptions
  gmail.ts        - Gmail send via Replit connector (support@formic.co)

shared/
  schema.ts       - Drizzle table + Zod schemas
  routes.ts       - API contract (paths, methods, validation)

client/src/
  pages/dashboard.tsx       - Main dashboard page
  pages/daily-review.tsx    - Daily standup review page with date tabs
  components/ticket-table.tsx - Table with ISR numbers, AI titles, priority labels
  components/ticket-form.tsx
  components/ticket-badges.tsx
  components/email-compose-dialog.tsx - Email compose with templates
  hooks/use-tickets.ts      - React Query hooks
```
