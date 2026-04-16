import { WebClient } from '@slack/web-api';
import type { Ticket } from '@shared/schema';
import { getSystemMetaEntry, getSiteChannelForSystemId } from './airtable';

// Builds the same enriched label shown in the ticket form dropdown:
// "SYSTEM_ID — (REGION) — ALIAS — VENDOR"
export function buildSystemIdLabel(systemId: string): string {
  const meta = getSystemMetaEntry(systemId);
  if (!meta) return systemId;
  let label = systemId;
  if (meta.region) label += ` — (${meta.region})`;
  if (meta.alias) label += ` — ${meta.alias}`;
  if (meta.vendor) label += ` — ${meta.vendor}`;
  return label;
}

let connectionSettings: any;
async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X-Replit-Token not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=slack',
    {
      headers: {
        'Accept': 'application/json',
        'X-Replit-Token': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Slack not connected');
  }
  return accessToken;
}

// Returns a client with users:read scope for lookups (uses SLACK_BOT_TOKEN if set)
async function getUserLookupClient() {
  const token = process.env.SLACK_BOT_TOKEN || await getAccessToken();
  return new WebClient(token);
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
export async function getUncachableSlackClient() {
  const token = process.env.SLACK_BOT_TOKEN || await getAccessToken();
  return new WebClient(token);
}

let slackUserCache: Map<string, string> = new Map();
let slackMembersData: Array<{ name: string; id: string }> = [];
let slackEmailToNameCache: Map<string, string> = new Map();
let slackUserCacheTime = 0;
const SLACK_CACHE_TTL = 10 * 60 * 1000;

let _botUserId: string | null = null;
export async function getBotUserId(): Promise<string | null> {
  if (_botUserId) return _botUserId;
  try {
    const slack = await getUncachableSlackClient();
    const auth: any = await slack.auth.test();
    _botUserId = auth.user_id || null;
  } catch {
    _botUserId = null;
  }
  return _botUserId;
}

async function ensureSlackUserCache() {
  if (slackUserCache.size > 0 && Date.now() - slackUserCacheTime < SLACK_CACHE_TTL) {
    return;
  }
  try {
    const slack = await getUserLookupClient();
    const allMembers: any[] = [];
    let cursor: string | undefined;
    do {
      const result: any = await slack.users.list({ limit: 200, cursor });
      if (result.members) allMembers.push(...result.members);
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    slackUserCache = new Map();
    slackMembersData = [];
    slackEmailToNameCache = new Map();
    for (const m of allMembers) {
      if (m.deleted || m.is_bot) continue;
      const realName = m.real_name || m.profile?.real_name;
      const displayName = m.profile?.display_name;
      if (realName) slackUserCache.set(realName.toLowerCase(), m.id);
      if (displayName) slackUserCache.set(displayName.toLowerCase(), m.id);
      const firstName = m.profile?.first_name;
      const lastName = m.profile?.last_name;
      const memberEmail = m.profile?.email;
      let memberDisplayName: string | undefined;
      if (firstName && lastName) {
        const fullName = `${firstName} ${lastName}`;
        slackUserCache.set(fullName.toLowerCase(), m.id);
        slackMembersData.push({ name: fullName, id: m.id });
        memberDisplayName = fullName;
      } else if (realName) {
        slackMembersData.push({ name: realName, id: m.id });
        memberDisplayName = realName;
      }
      if (memberEmail && memberDisplayName) {
        slackEmailToNameCache.set(memberEmail.toLowerCase(), memberDisplayName);
      }
    }
    slackMembersData.sort((a, b) => a.name.localeCompare(b.name));
    slackUserCacheTime = Date.now();
  } catch (err: any) {
    console.error("Failed to fetch Slack users:", err.message || err);
  }
}

export async function getSlackMembers(): Promise<Array<{ name: string; id: string }>> {
  await ensureSlackUserCache();
  return slackMembersData;
}

export async function lookupSlackNameByEmail(email: string): Promise<string | null> {
  await ensureSlackUserCache();
  return slackEmailToNameCache.get(email.toLowerCase()) ?? null;
}

// Cache mapping Slack channel IDs to channel names.
let slackChannelNameCache = new Map<string, string>();
let slackChannelNameCacheTime = 0;
const SLACK_CHANNEL_NAME_CACHE_TTL = 30 * 60 * 1000;

export async function getSlackChannelNamesForIds(channelIds: string[]): Promise<Array<{ id: string; name: string }>> {
  if (channelIds.length === 0) return [];

  const now = Date.now();
  if (now - slackChannelNameCacheTime > SLACK_CHANNEL_NAME_CACHE_TTL) {
    slackChannelNameCache = new Map();
    slackChannelNameCacheTime = now;
  }

  const uncached = channelIds.filter((id) => !slackChannelNameCache.has(id));
  if (uncached.length > 0) {
    const needed = new Set(uncached);
    try {
      const slack = await getUserLookupClient();
      let cursor: string | undefined;
      do {
        const result: any = await slack.conversations.list({
          limit: 200,
          cursor,
          types: 'public_channel,private_channel',
          exclude_archived: true,
        });
        for (const ch of (result.channels || [])) {
          if (needed.has(ch.id)) {
            slackChannelNameCache.set(ch.id, ch.name);
            needed.delete(ch.id);
          }
        }
        cursor = result.response_metadata?.next_cursor;
        if (needed.size === 0) break;
      } while (cursor);
    } catch (err: any) {
      console.error("Failed to fetch Slack channel names:", err.message || err);
    }
  }

  return channelIds
    .filter((id) => slackChannelNameCache.has(id))
    .map((id) => ({ id, name: slackChannelNameCache.get(id)! }));
}

export async function lookupSlackUserId(name: string): Promise<string | null> {
  if (!name) return null;
  await ensureSlackUserCache();
  return slackUserCache.get(name.toLowerCase()) || null;
}

// Resolves Slack message tokens to human-readable text:
//   <@USERID>          → "First Last"
//   <#CHANNELID>       → "#channel-name"  (via API lookup)
//   <#CHANNELID|name>  → "#name"          (uses the inline name Slack provides)
export async function resolveSlackMentions(text: string): Promise<string> {
  if (!text) return text;
  await ensureSlackUserCache();

  // Build reverse ID→name map from the already-populated slackMembersData
  const idToName = new Map<string, string>(slackMembersData.map(m => [m.id, m.name]));

  // 1. Resolve <@USERID> → display name
  let resolved = text.replace(/<@([A-Z0-9]+)>/g, (_match, userId: string) => {
    return idToName.get(userId) || `@${userId}`;
  });

  // 2. Resolve <#CHANNELID|display-name> → #display-name[CHANNELID]
  //    Embedding the ID lets the UI render a direct Slack deep-link without a separate lookup.
  resolved = resolved.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, (_match, chanId: string, name: string) => `#${name}[${chanId}]`);

  // 3. Resolve remaining bare <#CHANNELID> → #channel-name[CHANNELID] via conversations.info
  //    (uses channels:read only — avoids conversations.list which also needs groups:read)
  const bareChannelIds: string[] = [];
  resolved.replace(/<#([A-Z0-9]+)>/g, (_match, chanId: string) => {
    bareChannelIds.push(chanId);
    return _match;
  });

  if (bareChannelIds.length > 0) {
    try {
      const slack = await getUserLookupClient();
      const channelMap = new Map<string, string>();
      await Promise.all(
        bareChannelIds.map(async (chanId) => {
          try {
            const result: any = await slack.conversations.info({ channel: chanId });
            if (result.channel?.name) channelMap.set(chanId, result.channel.name);
          } catch {
            // leave unresolved — will fall back to bare ID
          }
        })
      );
      resolved = resolved.replace(/<#([A-Z0-9]+)>/g, (_match, chanId: string) =>
        channelMap.has(chanId) ? `#${channelMap.get(chanId)}[${chanId}]` : `#${chanId}`
      );
    } catch {
      // If client creation fails, leave IDs as-is
    }
  }

  return resolved;
}

// Returns <@USERID> if the name resolves to a Slack user, otherwise returns the name as-is.
export async function mentionName(name: string): Promise<string> {
  if (!name?.trim()) return name;
  const id = await lookupSlackUserId(name);
  return id ? `<@${id}>` : name;
}

// Scans free-form text and replaces known Slack member full names with <@USERID> mentions.
// Only replaces names that contain a space (first + last) to avoid false matches on single words.
// Sorts by name length descending so "Bradley Rasberry" is matched before "Brad" if both exist.
export async function replaceNamesWithMentions(text: string): Promise<string> {
  if (!text) return text;
  await ensureSlackUserCache();
  const entries = Array.from(slackUserCache.entries())
    .filter(([name]) => name.includes(' '))
    .sort((a, b) => b[0].length - a[0].length);

  let result = text;
  for (const [name, id] of entries) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Don't replace names that are already inside a <@...> mention
    const regex = new RegExp(`(?<!<@[A-Z0-9]*)\\b${escaped}\\b`, 'gi');
    result = result.replace(regex, `<@${id}>`);
  }
  return result;
}

// Replaces @Name patterns (including first-name-only) in text with Slack <@USERID> mentions.
// Uses prefix matching so "@Charlson" resolves to "Charlson Price" in the cache.
// Handles 1–3 word names (e.g. @Brad, @Bradley Rasberry, @Bradley J Rasberry).
export async function resolveAtMentions(text: string): Promise<string> {
  if (!text) return text;
  await ensureSlackUserCache();

  // Collect all @Name matches (greedy: try longest match first)
  const regex = /@([A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*)?(?: [A-Za-z][A-Za-z'-]*)?)/g;
  const matches: Array<{ match: string; name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    matches.push({ match: m[0], name: m[1], index: m.index });
  }
  if (matches.length === 0) return text;

  let result = text;
  let offset = 0;
  for (const { match, name, index } of matches) {
    const lower = name.toLowerCase();
    let slackId: string | undefined;

    // 1. Exact match
    slackId = slackUserCache.get(lower);

    // 2. Starts-with match (first name prefix → "charlson" matches "charlson price")
    if (!slackId) {
      for (const [cachedName, id] of slackUserCache.entries()) {
        if (cachedName.startsWith(lower + " ") || cachedName === lower) {
          slackId = id;
          break;
        }
      }
    }

    if (!slackId) continue; // no match — leave @Name as-is

    const replacement = `<@${slackId}>`;
    result = result.slice(0, index + offset) + replacement + result.slice(index + offset + match.length);
    offset += replacement.length - match.length;
  }
  return result;
}

export async function lookupSlackUserIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  try {
    const slack = await getUserLookupClient();
    const result = await slack.users.lookupByEmail({ email });
    return result.user?.id || null;
  } catch (err: any) {
    console.error("Failed to lookup Slack user by email:", err.message || err);
    return null;
  }
}

export async function postThreadReply(
  channel: string,
  slackMessageId: string,
  text: string,
): Promise<void> {
  if (!channel || !slackMessageId) return;
  try {
    const slack = await getUncachableSlackClient();
    await slack.chat.postMessage({
      channel,
      thread_ts: slackMessageId,
      reply_broadcast: false,
      text,
      unfurl_links: false,
      unfurl_media: false,
    });
    console.log(`[Slack] Thread reply posted to ${channel} / thread ${slackMessageId}`);
  } catch (err: any) {
    const errCode = err.data?.error || err.message || String(err);
    if (errCode === "thread_not_found" || errCode === "message_not_found") {
      console.warn(`[Slack] Thread ${slackMessageId} not found in ${channel} — reply dropped. Consider re-posting the original ticket to Slack.`);
    } else {
      console.error(`[Slack] Failed to post thread reply to ${channel} / thread ${slackMessageId}: ${errCode}`);
    }
  }
}

// Searches a channel's recent history for a root-level message that mentions
// the given ticket number.  Returns the thread timestamp if found, or null.
async function findExistingChannelThread(
  slack: WebClient,
  channel: string,
  ticketNumber: string,
): Promise<string | null> {
  if (!ticketNumber) return null;
  try {
    const result: any = await slack.conversations.history({
      channel,
      limit: 200,
    });
    for (const msg of (result.messages || [])) {
      // Only match root messages (not themselves thread replies)
      const isRoot = !msg.thread_ts || msg.thread_ts === msg.ts;
      if (!isRoot) continue;
      if (!msg.text || !msg.text.includes(ticketNumber)) continue;
      // Exclude update/review messages that accidentally ended up as root messages —
      // these should never be used as the thread anchor for a ticket.
      const looksLikeUpdate =
        msg.text.startsWith(":pencil2:") ||
        msg.text.startsWith(":white_check_mark:") ||
        msg.text.startsWith(":arrows_counterclockwise:") ||
        msg.text.startsWith(":calendar:") ||
        msg.text.startsWith(":construction_worker:");
      if (looksLikeUpdate) continue;
      return msg.ts as string;
    }
  } catch (err: any) {
    // Silently ignore — if we can't read history, fall back to posting new
    console.warn(`Could not read history for channel ${channel}:`, err.data?.error || err.message);
  }
  return null;
}

export async function postTicketToSlack(
  ticket: Ticket,
  submitterName?: string,
  assigneeSlackId?: string | null,
  submitterSlackId?: string | null,
  notifySlackIds?: string[],
): Promise<{ ts: string; channel: string } | null> {
  // Prefer the site-specific channel from the Sites table (keyed by systemId) over the
  // generic inbound channel stored on the ticket record.
  const siteChannel = ticket.systemId ? await getSiteChannelForSystemId(ticket.systemId) : null;
  const channel = siteChannel || ticket.csChannel;
  if (!channel) {
    console.warn(`No cs_channel for ticket ${ticket.ticketNumber || ticket.id}, skipping Slack notification`);
    return null;
  }
  try {
    const slack = await getUncachableSlackClient();

    const ticketRef = ticket.ticketNumber || `#${ticket.id}`;
    const priorityDisplay = ticket.priorityLabel || ticket.priority || "Unknown";
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + ", " + now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const contactDisplay = [
      ticket.contactName || ticket.customerName || null,
      ticket.contactPhone ? `: ${ticket.contactPhone}` : null,
    ].filter(Boolean).join(" ");

    const assigneeDisplay = assigneeSlackId
      ? `<@${assigneeSlackId}>`
      : ticket.assigneeName || null;
    const submitterDisplay = submitterSlackId
      ? `<@${submitterSlackId}>`
      : submitterName || null;

    const appDomain = process.env.REPLIT_DOMAINS;
    const ticketLink = appDomain
      ? `https://${appDomain}/?ticket=${ticket.id}`
      : null;

    const headerLine = ticketLink
      ? `*<${ticketLink}|${ticketRef}>* ${priorityDisplay}`
      : `*${ticketRef}* ${priorityDisplay}`;

    const notifyDisplay = notifySlackIds?.length
      ? notifySlackIds.map(id => `<@${id}>`).join(" ")
      : null;

    const systemIdLabel = ticket.systemId ? buildSystemIdLabel(ticket.systemId) : null;

    const lines = [
      `*Inbound Support Request*`,
      headerLine,
      ticket.description,
      ``,
      systemIdLabel ? `*System ID:* ${systemIdLabel}` : null,
      `*Comms direction:* ${ticket.commsDirection || "Inbound"}`,
      contactDisplay ? `*Customer Contact:* ${contactDisplay}` : null,
      `*Date:* ${dateStr}${assigneeDisplay ? ` | *Assigned to:* ${assigneeDisplay}` : ""}${submitterDisplay ? ` | *Submitted by:* ${submitterDisplay}` : ""}`,
      notifyDisplay ? `*Notify:* ${notifyDisplay}` : null,
    ].filter(v => v !== null).join("\n");

    // Check if this ticket already has a thread in the system channel
    const existingSystemTs = ticketRef
      ? await findExistingChannelThread(slack, channel, ticketRef)
      : null;

    let ts: string | null;

    if (existingSystemTs) {
      // Post as a reply to the existing thread instead of a new root message
      await slack.chat.postMessage({
        channel,
        thread_ts: existingSystemTs,
        text: lines,
        unfurl_links: false,
        unfurl_media: false,
      });
      ts = existingSystemTs;
      console.log(`[Slack] Replied to existing thread ${existingSystemTs} for ${ticketRef} in ${channel}`);
    } else {
      const result = await slack.chat.postMessage({
        channel,
        text: lines,
        unfurl_links: false,
        unfurl_media: false,
      });
      ts = result.ts || null;
    }

    // Also post to the central all-tickets channel for a unified running list
    const CENTRAL_CHANNEL = "C09AUU81X9P";
    if (ts && channel !== CENTRAL_CHANNEL) {
      try {
        const channelId = channel.replace(/^#/, "");
        const threadLink = `https://formic.slack.com/archives/${channelId}/p${ts.replace(".", "")}`;
        const channelNames = await getSlackChannelNamesForIds([channelId]);
        const channelName = channelNames.find(c => c.id === channelId)?.name || channelId;
        const centralLines = [
          `*Inbound Support Request*`,
          headerLine,
          ticket.customerName ? `*Customer:* ${ticket.customerName}` : null,
          systemIdLabel ? `*System ID:* ${systemIdLabel}` : null,
          ticket.description,
          ``,
          `*Date:* ${dateStr}${assigneeDisplay ? ` | *Assigned to:* ${assigneeDisplay}` : ""}${submitterDisplay ? ` | *Submitted by:* ${submitterDisplay}` : ""}`,
          notifyDisplay ? `*Notify:* ${notifyDisplay}` : null,
          `*Channel thread:* <${threadLink}|View in #${channelName}>`,
        ].filter(v => v !== null).join("\n");

        // Same logic for the central channel — reply to existing thread if present
        const existingCentralTs = ticketRef
          ? await findExistingChannelThread(slack, CENTRAL_CHANNEL, ticketRef)
          : null;

        if (existingCentralTs) {
          await slack.chat.postMessage({
            channel: CENTRAL_CHANNEL,
            thread_ts: existingCentralTs,
            text: centralLines,
            unfurl_links: false,
            unfurl_media: false,
          });
        } else {
          await slack.chat.postMessage({
            channel: CENTRAL_CHANNEL,
            text: centralLines,
            unfurl_links: false,
            unfurl_media: false,
          });
        }
      } catch (centralErr: any) {
        console.error("Failed to post to central Slack channel:", centralErr.data?.error || centralErr.message || centralErr);
      }
    }

    return ts ? { ts, channel } : null;
  } catch (err: any) {
    const errMsg = err.data?.error || err.message || err;
    if (errMsg === 'not_in_channel' || errMsg === 'channel_not_found') {
      console.error(`Slack: Bot is not a member of channel ${channel}. Please invite the bot to this channel in Slack first (e.g. /invite @YourBot)`);
    } else {
      console.error("Failed to post ticket to Slack:", errMsg);
    }
    return null;
  }
}

// Send a DM to the assignee when a ticket is assigned or reassigned to them.
// Uses the same layout as the inbound channel notification.
export async function postAssigneeDm(
  ticket: Ticket,
  assigneeSlackId: string,
  slackThreadLink?: string | null,
): Promise<void> {
  try {
    const slack = await getUncachableSlackClient();

    // Post directly to the user's Slack ID — avoids needing im:write scope.
    // Slack's chat.postMessage accepts a user ID as the channel and opens
    // (or reuses) the DM automatically with only the chat:write scope.
    const dmChannel = assigneeSlackId;
    if (!dmChannel) {
      console.warn(`[Slack] No Slack ID provided for assignee DM`);
      return;
    }

    const ticketRef = ticket.ticketNumber || `#${ticket.id}`;
    const priorityDisplay = ticket.priorityLabel || ticket.priority || "Unknown";
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }) + ", " + now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

    const appDomain = process.env.REPLIT_DOMAINS;
    const ticketLink = appDomain ? `https://${appDomain}/?ticket=${ticket.id}` : null;

    const headerLine = ticketLink
      ? `*<${ticketLink}|${ticketRef}>* ${priorityDisplay}`
      : `*${ticketRef}* ${priorityDisplay}`;

    const contactDisplay = [
      ticket.contactName || ticket.customerName || null,
      ticket.contactPhone ? `: ${ticket.contactPhone}` : null,
    ].filter(Boolean).join(" ");

    const systemIdLabel = ticket.systemId ? buildSystemIdLabel(ticket.systemId) : null;

    const lines = [
      `:clipboard: *You've been assigned a ticket*`,
      headerLine,
      ticket.description,
      ``,
      ticket.customerName ? `*Customer:* ${ticket.customerName}` : null,
      systemIdLabel ? `*System ID:* ${systemIdLabel}` : null,
      `*Comms direction:* ${ticket.commsDirection || "Inbound"}`,
      contactDisplay ? `*Customer Contact:* ${contactDisplay}` : null,
      `*Date:* ${dateStr}`,
      slackThreadLink ? `*Channel thread:* <${slackThreadLink}|View thread>` : null,
    ].filter(v => v !== null).join("\n");

    await slack.chat.postMessage({
      channel: dmChannel,
      text: lines,
      unfurl_links: false,
      unfurl_media: false,
    });

    console.log(`[Slack] DM sent to ${assigneeSlackId} for ticket ${ticketRef}`);
  } catch (err: any) {
    console.error("[Slack] Failed to send assignee DM:", err.data?.error || err.message || err);
  }
}

export async function getWorkflowTriggerUrl(workflowId: string): Promise<string | null> {
  try {
    const client = await getUncachableSlackClient();
    const result: any = await (client as any).apiCall("workflows.triggers.list", {
      workflow_app_id: workflowId,
    });
    const triggers: any[] = result?.triggers || [];
    for (const t of triggers) {
      const url = t.shortcut_url || t.trigger_url || t.url;
      if (url) return url;
    }
    return null;
  } catch (err: any) {
    console.log(`[Slack] getWorkflowTriggerUrl(${workflowId}):`, err?.data?.error || err?.message);
    return null;
  }
}
