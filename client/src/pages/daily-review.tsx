import { useState, useEffect, useCallback, useRef, useMemo, type RefCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { FormicMark } from "@/components/formic-logo";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import {
  LogOut,
  ArrowLeft,
  Plus,
  Save,
  Loader2,
  Check,
  CalendarPlus,
  AlertTriangle,
  AlertCircle,
  X,
  ChevronDown,
  ChevronRight,
  Send,
  RefreshCw,
  CheckCircle2,
  Flag,
  Sparkles,
  Trash2,
  Package,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TicketForm } from "@/components/ticket-form";
import type { DailyReview, Ticket } from "@shared/schema";

const SECTION_CONFIG = [
  { key: "p1p2Tickets", label: "P1, P2 & Escalated Tickets", color: "border-red-500/50" },
  { key: "hyperCare", label: "Hyper Care - Maintained by CS", color: "border-orange-500/50" },
  { key: "p3Tickets", label: "P3 - Needing Immediate Review/Action/Parts", color: "border-yellow-500/50" },
  { key: "confirmedInstalls", label: "Confirmed Installs", color: "border-green-500/50", link: "https://airtable.com/appzLiACOq8tvPZEF/shrfh5E3yoR18H7dT/tblRXewS1BUrOkx1x" },
  { key: "delayedInstalls", label: "Delayed/Moved Installs", color: "border-red-400/50" },
  { key: "parkingLot", label: "Parking Lot", color: "border-blue-500/50" },
  { key: "nextParkingLot", label: "Next Parking Lot", color: "border-blue-400/50" },
  { key: "onCallRotation", label: "FS On Call Rotation - Maintained by Ops Command", color: "border-emerald-500/50" },
] as const;

type SectionKey = typeof SECTION_CONFIG[number]["key"];

const EMPTY_SECTIONS: Record<SectionKey, string> = {
  p1p2Tickets: "",
  hyperCare: "",
  p3Tickets: "",
  confirmedInstalls: "",
  delayedInstalls: "",
  parkingLot: "",
  nextParkingLot: "",
  onCallRotation: "",
};

function getScrollAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflow, overflowY } = getComputedStyle(node);
    if (/auto|scroll/.test(overflow + overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  const scrollAncestor = getScrollAncestor(el);
  const savedScrollAncestor = scrollAncestor ? scrollAncestor.scrollTop : window.scrollY;
  const savedScrollEl = el.scrollTop;
  // Use "1px" instead of "0" to avoid fully collapsing the textarea,
  // which would cause the scroll container to jump.
  el.style.height = "1px";
  el.style.height = Math.max(el.scrollHeight, 24) + "px";
  el.scrollTop = savedScrollEl;
  if (scrollAncestor) {
    scrollAncestor.scrollTop = savedScrollAncestor;
  } else {
    window.scrollTo(window.scrollX, savedScrollAncestor);
  }
}

function shortenPriority(label: string): string {
  const parts = label.split(":");
  if (parts.length >= 2) {
    return parts.slice(0, 2).map(s => s.trim()).join(": ");
  }
  return label;
}

function isP1orP2(ticket: Ticket): boolean {
  // Escalated tickets (any non-standard level, same logic as the badge in the ticket table)
  if (ticket.escalationLevel && ticket.escalationLevel !== "Standard" && ticket.escalationLevel !== "Normal") return true;
  if (!ticket.priorityLabel) return ticket.priority === "high";
  const short = shortenPriority(ticket.priorityLabel);
  return short.includes("P1") || short.includes("P2");
}

function isP3(ticket: Ticket): boolean {
  if (!ticket.priorityLabel) return false;
  const short = shortenPriority(ticket.priorityLabel);
  return short.includes("P3");
}

function hoursOpen(ticket: Ticket): string {
  const start = ticket.submittedAt || ticket.createdAt;
  if (!start) return "";
  const startDate = new Date(start);
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d`;
}

function extractFinalSolution(resolution: string | null): string {
  if (!resolution) return "";
  const match = resolution.match(/Final Solution:\s*([\s\S]+?)(?:Final Determination:|$)/i);
  if (match) return match[1].trim();
  // Also check if it's just "Final Solution:" at the top
  const simple = resolution.match(/Final Solution:\s*([\s\S]+)/i);
  if (simple) return simple[1].trim();
  return resolution.trim();
}

function ClosedP1P2Panel({ tickets, sinceLabel }: { tickets: Ticket[]; sinceLabel?: string }) {
  if (tickets.length === 0) return null;
  const TICKET_ROW_HEIGHT = 92;
  const maxVisible = 4;
  return (
    <div className="border-l-4 border-green-600 bg-card rounded-lg shadow-sm">
      <div className="px-4 py-2.5 border-b bg-muted/30 rounded-t-lg flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <h3 className="font-semibold text-sm text-foreground">
          P1, P2 &amp; Escalated Closed Since Last Review
        </h3>
        {sinceLabel && (
          <span className="text-xs text-muted-foreground">({sinceLabel})</span>
        )}
        <Badge variant="secondary" className="ml-auto text-xs">{tickets.length}</Badge>
      </div>
      <div className="divide-y overflow-y-auto" style={{ maxHeight: `${maxVisible * TICKET_ROW_HEIGHT}px` }}>
        {tickets.map((ticket) => {
          const solution = extractFinalSolution(ticket.resolution ?? null);
          return (
            <div key={ticket.id} className="px-4 py-2.5 text-sm" data-testid={`closed-p1p2-ticket-${ticket.id}`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-xs text-muted-foreground shrink-0">{ticket.ticketNumber}</span>
                {ticket.priorityLabel && (
                  <span className="text-xs text-muted-foreground truncate">{shortenPriority(ticket.priorityLabel)}</span>
                )}
                {ticket.resolvedAt && (
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    closed {new Date(ticket.resolvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </div>
              <div className="font-medium text-foreground truncate">{ticket.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                {ticket.customerName && <span className="truncate">{ticket.customerName}</span>}
                {ticket.customerName && ticket.assigneeName && <span>·</span>}
                {ticket.assigneeName && <span className="truncate">{ticket.assigneeName}</span>}
                {ticket.systemId && <span className="text-muted-foreground/60">({ticket.systemId})</span>}
              </div>
              {solution && (
                <div className="mt-1.5 text-xs text-green-400/90 bg-green-950/30 rounded px-2 py-1 line-clamp-2">
                  <span className="font-medium text-green-500">Solution: </span>{solution}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LiveTicketPanel({ tickets, title, icon, borderColor }: {
  tickets: Ticket[];
  title: string;
  icon: React.ReactNode;
  borderColor: string;
}) {
  if (tickets.length === 0) {
    return (
      <div className={`border-l-4 ${borderColor} bg-card rounded-lg shadow-sm`}>
        <div className="px-4 py-2.5 border-b bg-muted/30 rounded-t-lg flex items-center gap-2">
          {icon}
          <h3 className="font-semibold text-sm text-foreground">{title}</h3>
          <Badge variant="secondary" className="ml-auto text-xs">0</Badge>
        </div>
        <div className="px-4 py-3 text-sm text-muted-foreground">No open tickets</div>
      </div>
    );
  }

  const TICKET_ROW_HEIGHT = 76;
  const maxVisible = 5;

  return (
    <div className={`border-l-4 ${borderColor} bg-card rounded-lg shadow-sm`}>
      <div className="px-4 py-2.5 border-b bg-muted/30 rounded-t-lg flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-sm text-foreground">{title}</h3>
        <Badge variant="secondary" className="ml-auto text-xs">{tickets.length}</Badge>
      </div>
      <div className="divide-y overflow-y-auto" style={{ maxHeight: `${maxVisible * TICKET_ROW_HEIGHT}px` }}>
        {tickets.map((ticket) => (
          <div key={ticket.id} className="px-4 py-2.5 flex items-start gap-3 text-sm" data-testid={`live-ticket-${ticket.id}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-xs text-muted-foreground shrink-0">{ticket.ticketNumber}</span>
                {ticket.priorityLabel && (
                  <span className="text-xs text-muted-foreground truncate">{shortenPriority(ticket.priorityLabel)}</span>
                )}
                <span className="text-xs text-muted-foreground/60 shrink-0">{hoursOpen(ticket)}</span>
              </div>
              <div className="font-medium text-foreground truncate">{ticket.title}</div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                {ticket.customerName && <span className="truncate">{ticket.customerName}</span>}
                {ticket.customerName && ticket.assigneeName && <span>·</span>}
                {ticket.assigneeName && <span className="truncate">{ticket.assigneeName}</span>}
                {ticket.systemId && <span className="text-muted-foreground/60">({ticket.systemId})</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SystemInfo {
  systemId: string;
  customerName: string;
  csChannel: string | null;
}

interface SlackMember {
  name: string;
  slackId: string;
}

interface SlackChannel {
  id: string;
  name: string;
}

type SuggestionItem =
  | { type: "system"; data: SystemInfo }
  | { type: "user"; data: SlackMember }
  | { type: "channel"; data: SlackChannel };

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function resolveDateWord(word: string): string | null {
  const lower = word.toLowerCase();
  const now = new Date();

  if (lower === "today") {
    return formatShortDate(now);
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatShortDate(d);
  }
  if (lower === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return formatShortDate(d);
  }

  const dayIdx = DAY_NAMES.indexOf(lower);
  if (dayIdx !== -1) {
    const d = new Date(now);
    const currentDay = d.getDay();
    let diff = dayIdx - currentDay;
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    return formatShortDate(d);
  }

  const slashMatch = word.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = now.getFullYear();
      const candidate = new Date(year, month - 1, day);
      if (candidate < now) {
        candidate.setFullYear(year + 1);
      }
      return formatShortDate(candidate);
    }
  }

  return null;
}

function formatShortDate(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

function formatTicketLine(ticket: Ticket): string {
  const sysId = ticket.systemId || "N/A";
  const assignee = ticket.assigneeName || "Unassigned";
  let nextUpdate = "TBD";
  if (ticket.estimatedNextUpdate) {
    const d = new Date(ticket.estimatedNextUpdate);
    if (!isNaN(d.getTime())) {
      nextUpdate = formatShortDate(d);
    }
  }
  const ticketNum = ticket.ticketNumber || `#${ticket.id}`;
  return `${sysId}, ${assignee}, ${nextUpdate}, ${ticketNum}`;
}

function extractPreviousDayComments(prevSectionText: string, ticketNumber: string): string[] {
  if (!prevSectionText || !ticketNumber) return [];
  const lines = prevSectionText.split("\n");
  let capturing = false;
  const comments: string[] = [];
  for (const line of lines) {
    if (line.includes(ticketNumber)) {
      capturing = true;
      continue;
    }
    if (capturing) {
      if (line.trim() === "" || /^[A-Z0-9_#]/.test(line.trim()) && line.includes(",")) {
        break;
      }
      comments.push(line);
    }
  }
  return comments;
}

function ensureCommentLines(text: string): string {
  if (!text.trim()) return text;
  const lines = text.split("\n");
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    if (lines[i].match(/ISR\s*-\s*\d+/) && !lines[i].trimStart().startsWith("//")) {
      const nextLine = lines[i + 1];
      if (!nextLine || !nextLine.trimStart().startsWith("//")) {
        result.push("// ");
      }
    }
  }
  return result.join("\n");
}

function generateTicketSummary(ticket: Ticket): string {
  const tag = " (Auto-Generated)";
  const maxLen = 120 - tag.length;
  if (ticket.nextSteps) {
    const cleaned = ticket.nextSteps.replace(/\s+/g, " ").trim();
    if (cleaned.length <= maxLen) return `// ${cleaned}${tag}`;
    return `// ${cleaned.slice(0, maxLen - 3)}...${tag}`;
  }
  if (ticket.resolution) {
    const cleaned = ticket.resolution.replace(/\s+/g, " ").trim();
    if (cleaned.length <= maxLen) return `// ${cleaned}${tag}`;
    return `// ${cleaned.slice(0, maxLen - 3)}...${tag}`;
  }
  if (ticket.description) {
    const firstLine = ticket.description.split("\n")[0].replace(/\s+/g, " ").trim();
    if (firstLine.length <= maxLen) return `// ${firstLine}${tag}`;
    return `// ${firstLine.slice(0, maxLen - 3)}...${tag}`;
  }
  return "// ";
}

function generateTicketLines(
  tickets: Ticket[],
  existingSectionText: string,
  prevSectionText: string | undefined,
): string {
  const sortedTickets = [...tickets].sort((a, b) => {
    const aId = a.id || 0;
    const bId = b.id || 0;
    return aId - bId;
  });

  const openTicketNums = new Set(
    tickets.map((t) => (t.ticketNumber || "").replace(/\s+/g, ""))
  );

  const existingBlocks = parseTicketText(existingSectionText);
  const prunedBlocks = existingBlocks.filter((block) => {
    if (block.type !== "ticket") return true;
    const normalized = block.ticketNum.replace(/\s+/g, "");
    return openTicketNums.has(normalized);
  });
  const existingLines = prunedBlocks.length < existingBlocks.length
    ? serializeBlocks(prunedBlocks)
    : (existingSectionText || "");

  const newLines: string[] = [];

  for (const ticket of sortedTickets) {
    const ticketNum = ticket.ticketNumber || `#${ticket.id}`;
    if (existingLines.includes(ticketNum)) continue;

    const line = formatTicketLine(ticket);
    newLines.push(line);

    if (prevSectionText && existingLines.trim()) {
      const prevComments = extractPreviousDayComments(prevSectionText, ticketNum);
      if (prevComments.length > 0) {
        newLines.push(...prevComments);
      } else {
        newLines.push(generateTicketSummary(ticket));
      }
    } else {
      newLines.push(generateTicketSummary(ticket));
    }
  }

  let result: string;
  if (newLines.length === 0) {
    result = existingLines;
  } else if (existingLines.trim()) {
    result = existingLines.trimEnd() + "\n" + newLines.join("\n");
  } else {
    result = newLines.join("\n");
  }

  return ensureCommentLines(result);
}

const SLACK_TEAM_ID = "T019Y3V5LR4";

interface TicketBlock {
  type: "ticket";
  ticketNum: string;
  rawLine: string;
  comment: string;
}

interface TextBlock {
  type: "text";
  content: string;
}

type ContentBlock = TicketBlock | TextBlock;

function parseTicketText(text: string | undefined | null): ContentBlock[] {
  if (!text || !text.trim()) return [];
  const lines = text.split("\n");
  const blocks: ContentBlock[] = [];
  let currentTicketNum: string | null = null;
  let currentRawLine = "";
  let currentCommentLines: string[] = [];
  let pendingTextLines: string[] = [];

  const flushText = () => {
    if (pendingTextLines.length > 0) {
      blocks.push({ type: "text", content: pendingTextLines.join("\n") });
      pendingTextLines = [];
    }
  };

  const flushTicket = () => {
    if (currentTicketNum) {
      flushText();
      blocks.push({
        type: "ticket",
        ticketNum: currentTicketNum,
        rawLine: currentRawLine,
        comment: currentCommentLines.map((l) => l.replace(/^\s*\/\/\s?/, "")).join("\n"),
      });
      currentTicketNum = null;
      currentRawLine = "";
      currentCommentLines = [];
    }
  };

  for (const line of lines) {
    const match = line.match(/ISR\s*-\s*(\d+)/);
    if (match && !line.trimStart().startsWith("//")) {
      flushTicket();
      flushText();
      currentTicketNum = `ISR - ${match[1]}`;
      currentRawLine = line;
      currentCommentLines = [];
    } else if (currentTicketNum && line.trimStart().startsWith("//")) {
      currentCommentLines.push(line);
    } else {
      flushTicket();
      pendingTextLines.push(line);
    }
  }
  flushTicket();
  flushText();

  return blocks;
}

function serializeBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "ticket") {
      parts.push(block.rawLine);
      if (block.comment.trim()) {
        const commentLines = block.comment.split("\n").map((l) => `// ${l}`);
        parts.push(...commentLines);
      } else {
        parts.push("// ");
      }
    } else {
      parts.push(block.content);
    }
  }
  return parts.join("\n");
}

// ─── Install block types + helpers ──────────────────────────────────────────

type InstallBlock = {
  customer: string;
  systemId: string;
  csChannel: string;
  installationStarts: string;
  fseName: string;
  fseSlackId: string;
  fseArrival: string;
  wo: string;
  comment: string;
};

function parseInstallBlocks(text: string): InstallBlock[] {
  const lines = text.split("\n");
  const blocks: InstallBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("INST:")) {
      let instContent = line.slice(5);
      // Defensive: if the INST line was split by an embedded newline in a field value,
      // the continuation starts with "|" (e.g. "||2026-03-23"). Re-join it.
      if (instContent.split("|").length < 4 && i + 1 < lines.length && lines[i + 1].startsWith("|")) {
        instContent += lines[i + 1];
        i++;
      }
      const parts = instContent.split("|");
      const customer = (parts[0] || "").trim();
      const systemId = (parts[1] || "").trim();
      const csChannel = (parts[2] || "").trim();
      const installationStarts = (parts[3] || "").trim();
      let fseName = "", fseSlackId = "", fseArrival = "";
      if (i + 1 < lines.length && lines[i + 1].startsWith("FSE:")) {
        const fp = lines[i + 1].slice(4).split("|");
        fseName = fp[0] || ""; fseSlackId = fp[1] || ""; fseArrival = fp[2] || "";
        i++;
      }
      let wo = "";
      if (i + 1 < lines.length && lines[i + 1].startsWith("WO:")) {
        wo = lines[i + 1].slice(3).trim(); i++;
      }
      let comment = "";
      if (i + 1 < lines.length && lines[i + 1].startsWith("//")) {
        comment = lines[i + 1].slice(2); i++;
      }
      blocks.push({ customer, systemId, csChannel, installationStarts, fseName, fseSlackId, fseArrival, wo, comment });
    }
    i++;
  }
  return blocks;
}

function serializeInstallBlocks(blocks: InstallBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    lines.push(`INST:${b.customer}|${b.systemId}|${b.csChannel}|${b.installationStarts}`);
    lines.push(`FSE:${b.fseName}|${b.fseSlackId}|${b.fseArrival}`);
    lines.push(`WO:${b.wo}`);
    lines.push(`//${b.comment}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function fmtInstallDate(dateStr: string): string {
  if (!dateStr) return "TBD";
  const d = new Date(dateStr.includes("T") ? dateStr : dateStr + "T12:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return formatShortDate(d);
}

type AirtableInstallRef = { id: string; systemId: string; installationStarts?: string | null; dplyFse?: string | null; fseArrival?: string | null };

function InstallLinesEditor({
  value,
  onChange,
  readOnly,
  systems,
  users,
  channels,
  installs = [],
  "data-testid": testId,
}: {
  value: string;
  onChange: (val: string) => void;
  readOnly?: boolean;
  systems: SystemInfo[];
  users: SlackMember[];
  channels: SlackChannel[];
  installs?: AirtableInstallRef[];
  "data-testid"?: string;
}) {
  const { toast } = useToast();
  const blocks = useMemo(() => parseInstallBlocks(value), [value]);

  // Auto-sync empty block fields from live Airtable data.
  // Runs whenever the live installs list arrives/changes.
  useEffect(() => {
    if (!installs.length || readOnly) return;
    let changed = false;
    const updated = blocks.map(block => {
      const live = installs.find(i => i.systemId === block.systemId);
      if (!live) return block;
      const patch: Partial<typeof block> = {};
      if (!block.installationStarts && live.installationStarts) patch.installationStarts = live.installationStarts;
      if (!block.fseName && live.dplyFse) patch.fseName = live.dplyFse;
      if (!block.fseArrival && live.fseArrival) patch.fseArrival = live.fseArrival;
      if (Object.keys(patch).length === 0) return block;
      changed = true;
      return { ...block, ...patch };
    });
    if (changed) onChange(serializeInstallBlocks(updated));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installs]);

  const patchAirtable = useCallback(async (id: string, fields: Record<string, string | null>) => {
    if (!id) return;
    try {
      await apiRequest("PATCH", `/api/confirmed-installs/${id}`, fields);
    } catch {
      toast({ title: "Airtable save failed", description: "Could not update the field in Airtable.", variant: "destructive" });
    }
  }, [toast]);

  // Group blocks by customer + installationStarts so same-install systems render as one card
  // Must be declared before any conditional return to satisfy Rules of Hooks
  const groups = useMemo(() => {
    const grps: { blocks: InstallBlock[]; indices: number[] }[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const key = `${b.customer}||${b.installationStarts}`;
      const last = grps[grps.length - 1];
      if (last && `${last.blocks[0].customer}||${last.blocks[0].installationStarts}` === key) {
        last.blocks.push(b);
        last.indices.push(i);
      } else {
        grps.push({ blocks: [b], indices: [i] });
      }
    }
    grps.sort((a, b) => {
      const da = a.blocks[0].fseArrival || a.blocks[0].installationStarts || "";
      const db = b.blocks[0].fseArrival || b.blocks[0].installationStarts || "";
      return da.localeCompare(db);
    });
    return grps;
  }, [blocks]);

  const updateBlock = (index: number, patch: Partial<InstallBlock>) => {
    const updated = blocks.map((b, i) => (i === index ? { ...b, ...patch } : b));
    onChange(serializeInstallBlocks(updated));
  };

  // Update all blocks that share the same customer + installationStarts group
  const updateGroup = (indices: number[], patch: Partial<InstallBlock>) => {
    const updated = blocks.map((b, i) => (indices.includes(i) ? { ...b, ...patch } : b));
    onChange(serializeInstallBlocks(updated));
  };

  const deleteBlock = (index: number) => {
    const updated = blocks.filter((_, i) => i !== index);
    onChange(serializeInstallBlocks(updated));
  };

  // Fall back to plain AutocompleteTextarea for old-style free-text data
  if (blocks.length === 0) {
    return (
      <AutocompleteTextarea
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={readOnly ? "" : "Add confirmed install notes..."}
        className={`min-h-[40px] border-0 shadow-none focus-visible:ring-0 font-mono text-sm bg-transparent ${readOnly ? "cursor-default" : ""}`}
        systems={systems}
        users={users}
        channels={channels}
        data-testid={testId}
      />
    );
  }

  return (
    <div className="space-y-0 font-mono text-sm" data-testid={testId}>
      {groups.map((group, gIdx) => {
        const primary = group.blocks[0];
        const primaryIdx = group.indices[0];
        return (
          <div key={gIdx} className="border-b border-border/20 last:border-b-0 py-2">
            {/* Line 1: Customer — #SYS1, #SYS2 … — Install Date (shared across group) */}
            <div className="flex items-center gap-x-1.5 text-foreground font-medium">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 flex-1 min-w-0">
                <span>{primary.customer}</span>
                <span className="text-muted-foreground">—</span>
                {/* System IDs: one per block in group, each with its own delete button */}
                {group.blocks.map((block, bIdx) => {
                  const realIdx = group.indices[bIdx];
                  return (
                    <span key={bIdx} className="inline-flex items-center gap-0.5">
                      {block.csChannel ? (
                        <a
                          href={`https://app.slack.com/client/${SLACK_TEAM_ID}/${block.csChannel}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#FF9100] hover:underline"
                          title={`Open ${block.systemId} channel in Slack`}
                          data-testid={`link-install-sys-${realIdx}`}
                        >
                          #{block.systemId}
                        </a>
                      ) : (
                        <span className="text-[#FF9100]">#{block.systemId}</span>
                      )}
                      {!readOnly && (
                        <button
                          onClick={() => deleteBlock(realIdx)}
                          className="text-muted-foreground/30 hover:text-red-400 transition-colors"
                          title={`Remove ${block.systemId}`}
                          data-testid={`btn-delete-install-${realIdx}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {bIdx < group.blocks.length - 1 && (
                        <span className="text-muted-foreground">,</span>
                      )}
                    </span>
                  );
                })}
                <span className="text-muted-foreground">—</span>
                {!readOnly ? (
                  <input
                    type="date"
                    value={primary.installationStarts?.slice(0, 10) || ""}
                    onChange={(e) => updateGroup(group.indices, { installationStarts: e.target.value || "" })}
                    onBlur={(e) => {
                      for (const b of group.blocks) {
                        const m = installs.find(i => i.systemId === b.systemId);
                        if (m) patchAirtable(m.id, { installationStarts: e.target.value || null });
                      }
                    }}
                    className="bg-transparent border-0 p-0 text-muted-foreground font-normal text-sm font-mono focus:outline-none cursor-pointer"
                    data-testid={`input-install-date-${primaryIdx}`}
                  />
                ) : (
                  <span className="text-muted-foreground font-normal">{fmtInstallDate(primary.installationStarts)}</span>
                )}
              </div>
            </div>

            {/* Line 2: DPLY FSE @name (editable) — FSE Arrival (editable) — shared across group */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5 text-foreground/80">
              <span className="text-muted-foreground text-xs">DPLY FSE</span>
              {!readOnly ? (
                <>
                  <span className="text-blue-400">@</span>
                  <input
                    type="text"
                    value={primary.fseName}
                    onChange={(e) => {
                      const newName = e.target.value;
                      const matchedUser = users.find(u => u.name.toLowerCase() === newName.toLowerCase());
                      updateGroup(group.indices, { fseName: newName, fseSlackId: matchedUser?.slackId || primary.fseSlackId });
                    }}
                    onBlur={(e) => {
                      for (const b of group.blocks) {
                        const m = installs.find(i => i.systemId === b.systemId);
                        if (m) patchAirtable(m.id, { dplyFse: e.target.value });
                      }
                    }}
                    placeholder="TBD"
                    className="bg-transparent border-0 p-0 text-blue-400 text-sm font-mono focus:outline-none placeholder:text-muted-foreground/40 min-w-[60px]"
                    size={Math.max(primary.fseName.length || 3, 3)}
                    data-testid={`input-fse-name-${primaryIdx}`}
                  />
                </>
              ) : primary.fseSlackId ? (
                <a
                  href={`https://app.slack.com/team/${primary.fseSlackId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                  title={`Open ${primary.fseName} in Slack`}
                  data-testid={`link-install-fse-${primaryIdx}`}
                >
                  @{primary.fseName || "TBD"}
                </a>
              ) : (
                <span className="text-blue-400">@{primary.fseName || "TBD"}</span>
              )}
              <span className="text-muted-foreground">—</span>
              {!readOnly ? (
                <input
                  type="date"
                  value={primary.fseArrival?.slice(0, 10) || ""}
                  onChange={(e) => updateGroup(group.indices, { fseArrival: e.target.value || "" })}
                  onBlur={(e) => {
                    for (const b of group.blocks) {
                      const m = installs.find(i => i.systemId === b.systemId);
                      if (m) patchAirtable(m.id, { fseArrival: e.target.value || null });
                    }
                  }}
                  className="bg-transparent border-0 p-0 text-muted-foreground text-xs font-mono focus:outline-none cursor-pointer"
                  data-testid={`input-fse-arrival-${primaryIdx}`}
                />
              ) : (
                <span className="text-muted-foreground text-xs">{fmtInstallDate(primary.fseArrival)}</span>
              )}
            </div>

            {/* Line 3: WO: (editable or read-only) — shared across group */}
            {!readOnly ? (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-muted-foreground/70 shrink-0 select-none">WO:</span>
                <input
                  type="text"
                  value={primary.wo}
                  onChange={(e) => updateGroup(group.indices, { wo: e.target.value })}
                  placeholder="work order number..."
                  className="flex-1 bg-transparent border-0 text-foreground p-0 text-sm font-mono focus:outline-none placeholder:text-muted-foreground/30"
                  data-testid={`input-wo-install-${primaryIdx}`}
                />
              </div>
            ) : primary.wo ? (
              <div className="text-foreground mt-1">WO: {primary.wo}</div>
            ) : null}

            {/* Line 4: // comment (editable or read-only) — shared across group */}
            {!readOnly ? (
              <div className="flex items-start gap-1 mt-0.5">
                <span className="text-muted-foreground/40 shrink-0 select-none">//</span>
                <AutocompleteTextarea
                  value={primary.comment}
                  onChange={(val) => updateGroup(group.indices, { comment: val })}
                  placeholder="add comment..."
                  className="w-full bg-transparent border-0 text-muted-foreground p-0 resize-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 overflow-hidden text-sm font-mono"
                  containerClassName="flex-1 min-w-0"
                  systems={systems}
                  users={users}
                  channels={channels}
                  data-testid={`comment-install-${primaryIdx}`}
                />
              </div>
            ) : primary.comment ? (
              <div className="text-muted-foreground mt-0.5">// {primary.comment}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TicketLinesEditor({
  value,
  onChange,
  allTickets,
  systems,
  users,
  channels,
  readOnly,
  "data-testid": testId,
}: {
  value: string;
  onChange: (val: string) => void;
  allTickets: Ticket[];
  systems: SystemInfo[];
  users: SlackMember[];
  channels: SlackChannel[];
  readOnly?: boolean;
  "data-testid"?: string;
}) {
  const { toast } = useToast();
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);

  const ticketMap = useMemo(() => {
    const map = new Map<string, Ticket>();
    for (const t of allTickets) {
      if (t.ticketNumber) map.set(t.ticketNumber, t);
    }
    return map;
  }, [allTickets]);

  const systemMap = useMemo(() => {
    const map = new Map<string, SystemInfo>();
    for (const s of systems) map.set(s.systemId, s);
    return map;
  }, [systems]);

  const blocks = useMemo(() => parseTicketText(value), [value]);

  const handleBlockChange = useCallback(
    (index: number, patch: Partial<TicketBlock> | Partial<TextBlock>) => {
      const updated = blocks.map((b, i) => (i === index ? { ...b, ...patch } : b));
      onChange(serializeBlocks(updated as ContentBlock[]));
    },
    [blocks, onChange]
  );

  const handleDateChange = useCallback(async (ticketId: number, newDate: string | null) => {
    try {
      await apiRequest("PATCH", `/api/tickets/${ticketId}`, {
        estimatedNextUpdate: newDate || null,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Next update date saved" });
    } catch {
      toast({ title: "Failed to update date", variant: "destructive" });
    }
  }, [toast]);

  const toInputDate = (val: string | Date | null | undefined): string => {
    if (!val) return "";
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const isNewTicket = (ticket: Ticket) => {
    if (!ticket.createdAt) return false;
    const now = new Date();
    const created = new Date(ticket.createdAt);
    return now.getTime() - created.getTime() < 48 * 60 * 60 * 1000;
  };

  const toggleNeedsSupport = async (ticket: Ticket) => {
    try {
      await apiRequest("PATCH", `/api/tickets/${ticket.id}`, { needsSupport: !ticket.needsSupport });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    } catch {
      toast({ title: "Failed to update flag", variant: "destructive" });
    }
  };

  const togglePartsNeeded = async (ticket: Ticket) => {
    try {
      await apiRequest("PATCH", `/api/tickets/${ticket.id}`, { partsNeeded: !ticket.partsNeeded });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    } catch {
      toast({ title: "Failed to update flag", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-0" data-testid={testId}>
      {blocks.map((block, idx) => {
        if (block.type === "text") {
          return (
            <div key={`text-${idx}`}>
              {(!readOnly || block.content.trim()) && (
                <AutocompleteTextarea
                  value={block.content}
                  onChange={(val) => handleBlockChange(idx, { content: val })}
                  readOnly={readOnly}
                  className="w-full resize-none min-h-[24px] bg-transparent border-0 font-mono text-sm text-foreground p-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 overflow-hidden"
                  systems={systems}
                  users={users}
                  channels={channels}
                  data-testid={`text-block-${idx}`}
                />
              )}
            </div>
          );
        }

        const ticket = ticketMap.get(block.ticketNum);
        const sys = ticket?.systemId ? systemMap.get(ticket.systemId) : null;

        return (
          <div key={block.ticketNum} className="border-b border-border/20 last:border-b-0">
            <div
              className="grid gap-x-2 py-1.5 items-center font-mono text-sm"
              style={{ gridTemplateColumns: "130px 140px 110px 90px 1fr" }}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex flex-row gap-0.5 items-center">
                  {ticket && !readOnly ? (
                    <button
                      title={ticket.needsSupport ? "Needs support (click to clear)" : "Mark as needs support"}
                      onClick={() => toggleNeedsSupport(ticket)}
                      data-testid={`flag-${block.ticketNum.replace(/\s/g, "-")}`}
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${ticket.needsSupport ? "bg-red-600 border-red-600 text-white" : "border-white/20 text-white/20 hover:border-red-500 hover:text-red-400"}`}
                    >
                      <Flag className="h-2 w-2" />
                    </button>
                  ) : ticket?.needsSupport ? (
                    <div className="w-3.5 h-3.5 rounded-sm border bg-red-600 border-red-600 text-white flex items-center justify-center">
                      <Flag className="h-2 w-2" />
                    </div>
                  ) : (
                    <div className="w-3.5 h-3.5" />
                  )}
                  {ticket && !readOnly ? (
                    <button
                      title={ticket.partsNeeded ? "Parts needed (click to clear)" : "Mark as parts needed"}
                      onClick={() => togglePartsNeeded(ticket)}
                      data-testid={`parts-${block.ticketNum.replace(/\s/g, "-")}`}
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${ticket.partsNeeded ? "bg-amber-500 border-amber-500 text-white" : "border-white/20 text-white/20 hover:border-amber-400 hover:text-amber-300"}`}
                    >
                      <Package className="h-2 w-2" />
                    </button>
                  ) : ticket?.partsNeeded ? (
                    <div className="w-3.5 h-3.5 rounded-sm border bg-amber-500 border-amber-500 text-white flex items-center justify-center">
                      <Package className="h-2 w-2" />
                    </div>
                  ) : (
                    <div className="w-3.5 h-3.5" />
                  )}
                  {ticket ? (
                    <div
                      className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${isNewTicket(ticket) ? "bg-blue-500 border-blue-500 text-white" : "border-white/20 text-white/20"}`}
                      title={isNewTicket(ticket) ? "New ticket (< 48h)" : ""}
                      data-testid={`new-${block.ticketNum.replace(/\s/g, "-")}`}
                    >
                      <Sparkles className="h-2 w-2" />
                    </div>
                  ) : (
                    <div className="w-3.5 h-3.5" />
                  )}
                </div>
                {ticket?.systemId && sys?.csChannel ? (
                  <a
                    href={`https://app.slack.com/client/${SLACK_TEAM_ID}/${sys.csChannel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#FF9100] hover:underline truncate"
                    title={`${ticket.customerName || ""} — Open in Slack`}
                    data-testid={`link-channel-${ticket.systemId}`}
                  >
                    {ticket.systemId}
                  </a>
                ) : (
                  <span className="text-[#FF9100] truncate">
                    {ticket?.systemId || "N/A"}
                  </span>
                )}
              </div>

              {ticket?.assigneeName ? (
                <a
                  href={`https://slack.com/app/search?team=${SLACK_TEAM_ID}&query=${encodeURIComponent('from:' + ticket.assigneeName)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline truncate"
                  title={`Search ${ticket.assigneeName} in Slack`}
                  data-testid={`link-user-${block.ticketNum.replace(/\s/g, "-")}`}
                >
                  {ticket.assigneeName}
                </a>
              ) : (
                <span className="text-blue-400 truncate">Unassigned</span>
              )}

              {!readOnly && ticket ? (
                <input
                  type="date"
                  className="bg-transparent border border-border/30 rounded px-1 py-0.5 text-xs text-muted-foreground font-mono focus:outline-none focus:border-[#FF9100]/60 cursor-pointer"
                  value={toInputDate(ticket.estimatedNextUpdate)}
                  onChange={(e) => handleDateChange(ticket.id, e.target.value || null)}
                  data-testid={`date-picker-${block.ticketNum.replace(/\s/g, "-")}`}
                />
              ) : (
                <span className="text-muted-foreground truncate">
                  {ticket?.estimatedNextUpdate
                    ? formatShortDate(new Date(ticket.estimatedNextUpdate))
                    : "TBD"}
                </span>
              )}

              {!readOnly && ticket ? (
                <button
                  className="text-foreground hover:text-[#FF9100] hover:underline cursor-pointer text-left transition-colors"
                  onClick={() => setEditingTicket(ticket)}
                  title={`Edit ${block.ticketNum}`}
                  data-testid={`link-edit-${block.ticketNum.replace(/\s/g, "-")}`}
                >
                  {block.ticketNum}
                </button>
              ) : (
                <span className="text-foreground">{block.ticketNum}</span>
              )}

              <span className="text-muted-foreground/70 truncate" title={ticket?.title || ""}>
                {ticket?.title || ""}
              </span>
            </div>

            {!readOnly ? (
              <div className="flex items-start gap-1 pb-1.5 pl-0.5">
                <span className="text-muted-foreground/40 shrink-0 font-mono text-sm">//</span>
                <AutocompleteTextarea
                  value={block.comment}
                  onChange={(val) => handleBlockChange(idx, { comment: val })}
                  placeholder="add comment..."
                  className="w-full bg-transparent border-0 text-sm font-mono text-muted-foreground p-0 resize-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30 overflow-hidden"
                  containerClassName="flex-1 min-w-0"
                  systems={systems}
                  users={users}
                  channels={channels}
                  data-testid={`comment-${block.ticketNum.replace(/\s/g, "-")}`}
                />
              </div>
            ) : block.comment ? (
              <div className="text-sm font-mono text-muted-foreground pb-1.5 pl-0.5 whitespace-pre-wrap break-words overflow-x-hidden">
                // {block.comment}
              </div>
            ) : null}
          </div>
        );
      })}

      <Dialog open={!!editingTicket} onOpenChange={(open) => !open && setEditingTicket(null)}>
        <DialogContent
          className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
          onFocusOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Edit {editingTicket?.ticketNumber || `Ticket #${editingTicket?.id}`}</DialogTitle>
          </DialogHeader>
          {editingTicket && (
            <TicketForm
              ticket={editingTicket}
              onSuccess={() => {
                setEditingTicket(null);
                queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
              }}
              onCancel={() => setEditingTicket(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutocompleteTextarea({
  value,
  onChange,
  placeholder,
  readOnly,
  className,
  containerClassName,
  systems,
  users,
  channels,
  "data-testid": testId,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  containerClassName?: string;
  systems: SystemInfo[];
  users: SlackMember[];
  channels: SlackChannel[];
  "data-testid"?: string;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [triggerStart, setTriggerStart] = useState<number>(-1);
  const [triggerChar, setTriggerChar] = useState<string>("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    autoResize(textareaRef.current);
  }, [value]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let newVal = e.target.value;
    let pos = e.target.selectionStart || 0;

    const charJustTyped = newVal[pos - 1];
    if (charJustTyped === " " || charJustTyped === "\n") {
      const beforeSpace = newVal.substring(0, pos - 1);
      const wordMatch = beforeSpace.match(/(?:^|[\s\n])(\S+)$/);
      if (wordMatch) {
        const word = wordMatch[1];
        const resolved = resolveDateWord(word);
        if (resolved) {
          const wordStart = pos - 1 - word.length;
          newVal = newVal.substring(0, wordStart) + resolved + newVal.substring(pos - 1);
          pos = wordStart + resolved.length + 1;
          e.target.value = newVal;
          e.target.selectionStart = pos;
          e.target.selectionEnd = pos;
        }
      }
    }

    onChange(newVal);

    const before = newVal.substring(0, pos);

    // # trigger: search system IDs and Slack channel names
    const hashMatch = before.match(/#([A-Za-z0-9_-]*)$/);
    if (hashMatch) {
      const query = hashMatch[1].toUpperCase();
      const start = pos - hashMatch[0].length;
      const systemResults: SuggestionItem[] = systems.filter((s) =>
        s.systemId.toUpperCase().includes(query) ||
        s.customerName.toUpperCase().includes(query)
      ).map((s) => ({ type: "system" as const, data: s }));
      const channelResults: SuggestionItem[] = channels.filter((c) =>
        c.name.toUpperCase().includes(query)
      ).map((c) => ({ type: "channel" as const, data: c }));
      const filtered = [...systemResults, ...channelResults].slice(0, 10);

      if (filtered.length > 0) {
        setTriggerStart(start);
        setTriggerChar("#");
        setSuggestions(filtered);
        setShowSuggestions(true);
        setSelectedIdx(0);
        return;
      }
    }

    // @ trigger: search Slack member names
    const atMatch = before.match(/@([A-Za-z][A-Za-z ]{0,25})$/);
    if (atMatch) {
      const query = atMatch[1].trimEnd().toUpperCase();
      if (query.length > 0) {
        const start = pos - atMatch[0].length;
        const filtered: SuggestionItem[] = users.filter((u) =>
          u.name.toUpperCase().includes(query)
        ).slice(0, 8).map((u) => ({ type: "user" as const, data: u }));

        if (filtered.length > 0) {
          setTriggerStart(start);
          setTriggerChar("@");
          setSuggestions(filtered);
          setShowSuggestions(true);
          setSelectedIdx(0);
          return;
        }
      }
    }

    setShowSuggestions(false);
  };

  const insertSuggestion = (item: SuggestionItem) => {
    const before = value.substring(0, triggerStart);
    const afterTrigger = value.substring(triggerStart);
    let insertText: string;
    let pattern: RegExp;

    if (item.type === "system") {
      insertText = "#" + item.data.systemId;
      pattern = /^#[A-Za-z0-9_-]*/;
    } else if (item.type === "channel") {
      insertText = "#" + item.data.name;
      pattern = /^#[A-Za-z0-9_-]*/;
    } else {
      insertText = "@" + item.data.name;
      pattern = /^@[A-Za-z ]*/;
    }

    const afterMatch = afterTrigger.replace(pattern, "");
    const newVal = before + insertText + afterMatch;
    onChange(newVal);
    setShowSuggestions(false);

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = before.length + insertText.length;
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab") {
      if (suggestions[selectedIdx]) {
        e.preventDefault();
        insertSuggestion(suggestions[selectedIdx]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const systemMap = useMemo(() => {
    const map = new Map<string, SystemInfo>();
    for (const s of systems) map.set(s.systemId, s);
    return map;
  }, [systems]);

  const channelMap = useMemo(() => {
    const map = new Map<string, SlackChannel>();
    for (const c of channels) map.set(c.name, c);
    return map;
  }, [channels]);

  const userMap = useMemo(() => {
    const map = new Map<string, SlackMember>();
    for (const u of users) map.set(u.name.toLowerCase(), u);
    return map;
  }, [users]);

  if (readOnly) {
    // Split on #token[CHANID] (new format with embedded ID), #token, and @First Last
    const parts = value.split(/(#[A-Za-z0-9_-]+(?:\[[A-Z0-9]+\])?|@[A-Za-z]+(?:\s[A-Za-z]+)?)/g);
    return (
      <div className={`min-h-[100px] whitespace-pre-wrap font-mono text-sm p-2 break-words overflow-x-hidden ${className || ""}`} data-testid={testId}>
        {parts.map((part, i) => {
          // Match #name or #name[CHANID] — chanId present when bot embedded the ID
          const tokenMatch = part.match(/^#([A-Za-z0-9_-]+)(?:\[([A-Z0-9]+)\])?$/);
          if (tokenMatch) {
            const token = tokenMatch[1];   // channel / system name
            const chanId = tokenMatch[2];  // Slack channel ID (may be undefined for old entries)

            // If we have a direct channel ID, link straight to Slack — no lookup needed
            if (chanId) {
              return (
                <a key={i} href={`https://app.slack.com/client/T019Y3V5LR4/${chanId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-purple-400 hover:underline cursor-pointer font-semibold"
                  title={`#${token} — Open in Slack`}
                  data-testid={`link-channel-${token}`}
                >#{token}</a>
              );
            }

            // Check system IDs first (no dashes)
            const sys = systemMap.get(token);
            if (sys?.csChannel) {
              return (
                <a key={i} href={`https://app.slack.com/client/T019Y3V5LR4/${sys.csChannel}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-[#FF9100] hover:underline cursor-pointer font-semibold"
                  title={`${sys.customerName} — Open in Slack`}
                  data-testid={`link-system-${token}`}
                >{part}</a>
              );
            }
            // Check Slack channel names (fallback for old entries without embedded ID)
            const ch = channelMap.get(token);
            if (ch) {
              return (
                <a key={i} href={`https://app.slack.com/client/T019Y3V5LR4/${ch.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-purple-400 hover:underline cursor-pointer font-semibold"
                  title={`#${ch.name} — Open in Slack`}
                  data-testid={`link-channel-${token}`}
                >{part}</a>
              );
            }
            return <span key={i} className="text-[#FF9100] font-semibold">#{token}</span>;
          }
          const userMatch = part.match(/^@([A-Za-z]+(?:\s[A-Za-z]+)?)$/);
          if (userMatch) {
            const member = userMap.get(userMatch[1].toLowerCase());
            if (member?.slackId) {
              return (
                <a key={i} href={`https://app.slack.com/team/${member.slackId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-blue-400 hover:underline cursor-pointer font-semibold"
                  title={`${member.name} — Open in Slack`}
                  data-testid={`link-user-${userMatch[1].replace(/\s/g, "-")}`}
                >{part}</a>
              );
            }
            return <span key={i} className="text-blue-400 font-semibold">{part}</span>;
          }
          return <span key={i}>{part}</span>;
        })}
        {!value && <span className="text-muted-foreground/50">{placeholder}</span>}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${containerClassName || ""}`}>
      <textarea
        ref={(el) => {
          (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
          autoResize(el);
        }}
        value={value}
        onChange={(e) => { handleInput(e); autoResize(e.target); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        placeholder={placeholder}
        className={`w-full resize-none overflow-hidden ${className || ""}`}
        data-testid={testId}
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 bg-popover border rounded-md shadow-lg mt-1 w-80 max-h-56 overflow-y-auto" data-testid="dropdown-suggestions">
          {suggestions.map((item, i) => (
            <button
              key={
                item.type === "system" ? `sys-${item.data.systemId}` :
                item.type === "channel" ? `ch-${item.data.id}` :
                `user-${item.data.name}`
              }
              type="button"
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent ${i === selectedIdx ? "bg-accent" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(item);
              }}
              data-testid={`suggestion-${item.type === "system" ? item.data.systemId : item.type === "channel" ? item.data.name : item.data.name.replace(/\s/g, "-")}`}
            >
              {item.type === "system" ? (
                <>
                  <span className="font-mono font-medium text-[#FF9100] shrink-0">#{item.data.systemId}</span>
                  <span className="text-xs text-muted-foreground truncate">{item.data.customerName}</span>
                </>
              ) : item.type === "channel" ? (
                <>
                  <span className="font-mono font-medium text-purple-400 truncate">#{item.data.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">Slack channel</span>
                </>
              ) : (
                <span className="font-medium text-blue-400">@{item.data.name}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[date.getDay()]} ${months[date.getMonth()]} ${d}`;
}

function getTodayStr(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DailyReviewPage() {
  const { user, canEditDailyReview, canGenerateDailyReport, canViewDailyReview } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [manuallyClosed, setManuallyClosed] = useState(false);
  const [localSections, setLocalSections] = useState<Record<SectionKey, string>>(EMPTY_SECTIONS);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [newTicketOpen, setNewTicketOpen] = useState(false);
  const [p3Collapsed, setP3Collapsed] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingSaveRef = useRef<{ date: string; sections: Record<SectionKey, string> } | null>(null);
  const syncTriggeredRef = useRef(false);

  useEffect(() => {
    if (user && !canViewDailyReview) {
      setLocation("/");
    }
  }, [user, canViewDailyReview]);

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/tickets/sync"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
    },
  });

  useEffect(() => {
    if (!syncTriggeredRef.current) {
      syncTriggeredRef.current = true;
      syncMutation.mutate();
    }
  }, []);

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<DailyReview[]>({
    queryKey: ["/api/daily-reviews"],
  });

  const { data: allTickets = [], isLoading: ticketsLoading } = useQuery<Ticket[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: slackMembers = [] } = useQuery<Array<{ name: string; id: string }>>({
    queryKey: ["/api/slack/members"],
    staleTime: 10 * 60 * 1000,
  });

  const { data: slackChannels = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/slack/channels"],
    staleTime: 30 * 60 * 1000,
  });

  type ConfirmedInstall = {
    id: string;
    customer: string;
    systemId: string;
    installationStarts: string | null;
    projectManager: string;
    dplyFse: string;
    fseArrival: string | null;
  };

  const { data: confirmedInstallsList = [] } = useQuery<ConfirmedInstall[]>({
    queryKey: ["/api/confirmed-installs"],
    staleTime: 5 * 60 * 1000,
  });

  const openP1P2 = useMemo(() =>
    allTickets.filter((t) => t.status === "open" && isP1orP2(t))
      .sort((a, b) => {
        const aLabel = a.priorityLabel || "";
        const bLabel = b.priorityLabel || "";
        return aLabel.localeCompare(bLabel);
      }),
    [allTickets]
  );

  const openP3 = useMemo(() =>
    allTickets.filter((t) => t.status === "open" && isP3(t))
      .sort((a, b) => {
        const aLabel = a.priorityLabel || "";
        const bLabel = b.priorityLabel || "";
        return aLabel.localeCompare(bLabel);
      }),
    [allTickets]
  );

  const openPartsNeeded = useMemo(() =>
    allTickets.filter((t) => t.status === "open" && t.partsNeeded)
      .sort((a, b) => {
        const aLabel = a.priorityLabel || "";
        const bLabel = b.priorityLabel || "";
        return aLabel.localeCompare(bLabel);
      }),
    [allTickets]
  );

  const uniqueSystems = useMemo(() => {
    const map = new Map<string, SystemInfo>();
    for (const t of allTickets) {
      if (t.systemId && !map.has(t.systemId)) {
        map.set(t.systemId, {
          systemId: t.systemId,
          customerName: t.customerName || "",
          csChannel: t.csChannel || null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.systemId.localeCompare(b.systemId));
  }, [allTickets]);

  // Build SlackMember list from Slack API, falling back to ticket assignee names.
  const uniqueUsers = useMemo<SlackMember[]>(() => {
    if (slackMembers.length > 0) {
      return slackMembers.map((m) => ({ name: m.name, slackId: m.id }));
    }
    const set = new Set<string>();
    for (const t of allTickets) {
      if (t.assigneeName) set.add(t.assigneeName);
    }
    return Array.from(set).sort().map((name) => ({ name, slackId: "" }));
  }, [slackMembers, allTickets]);

  // Slack channel names keyed from the channels API.
  const uniqueChannels = useMemo<SlackChannel[]>(() => {
    return slackChannels.map((c) => ({ id: c.id, name: c.name }));
  }, [slackChannels]);

  const { data: activeReview, isLoading: reviewLoading } = useQuery<DailyReview>({
    queryKey: ["/api/daily-reviews", activeDate],
    enabled: !!activeDate,
  });

  const autoCreatedRef = useRef(false);
  const ticketLinesGeneratedRef = useRef<string | null>(null);

  const previousDayReview = useMemo(() => {
    if (!reviews || reviews.length < 2) return undefined;
    const today = getTodayStr();
    const todayIdx = reviews.findIndex((r) => r.date === today);
    if (todayIdx >= 0 && todayIdx < reviews.length - 1) {
      return reviews[todayIdx + 1];
    }
    if (todayIdx === -1 && reviews.length > 0) {
      return reviews[0];
    }
    return undefined;
  }, [reviews]);

  const { data: prevReviewData } = useQuery<DailyReview>({
    queryKey: ["/api/daily-reviews", previousDayReview?.date],
    enabled: !!previousDayReview?.date,
  });

  // Closed P1/P2 tickets since the previous daily review date
  const closedP1P2SinceLastReview = useMemo(() => {
    const cutoffDate = previousDayReview?.date;
    const cutoff = cutoffDate
      ? new Date(`${cutoffDate}T00:00:00`)
      : new Date(Date.now() - 48 * 60 * 60 * 1000); // fallback: last 48 h

    return allTickets
      .filter((t) => {
        if (t.status !== "closed" || !isP1orP2(t)) return false;
        const closedTs = t.resolvedAt
          ? new Date(t.resolvedAt)
          : t.updatedAt
            ? new Date(t.updatedAt)
            : null;
        return closedTs !== null && closedTs >= cutoff;
      })
      .sort((a, b) => {
        const aTs = a.resolvedAt ?? a.updatedAt ?? "";
        const bTs = b.resolvedAt ?? b.updatedAt ?? "";
        return new Date(bTs).getTime() - new Date(aTs).getTime();
      });
  }, [allTickets, previousDayReview]);

  const closedSinceLabel = previousDayReview
    ? `since ${formatDateLabel(previousDayReview.date)}`
    : undefined;

  useEffect(() => {
    if (reviewsLoading) return;
    const today = getTodayStr();
    const todayReview = reviews.find((r) => r.date === today);

    if (todayReview) {
      if (!activeDate && !manuallyClosed) {
        setActiveDate(today);
      }
    } else if (!autoCreatedRef.current && !createMutation.isPending) {
      autoCreatedRef.current = true;
      const latestDate = reviews.length > 0 ? reviews[0].date : undefined;
      createMutation.mutate({ date: today, copyFromDate: latestDate });
    }
  }, [reviews, reviewsLoading, activeDate, manuallyClosed]);

  useEffect(() => {
    if (activeReview?.sections) {
      setLocalSections(activeReview.sections as unknown as Record<SectionKey, string>);
      setHasUnsavedChanges(false);
    }
  }, [activeReview]);

  useEffect(() => {
    if (!activeReview || !allTickets.length) return;
    const today = getTodayStr();
    const GENERATE_V = "v5";
    if (activeReview.date !== today) return;
    if (ticketLinesGeneratedRef.current === `${today}_${GENERATE_V}`) return;

    const sections = activeReview.sections as unknown as Record<SectionKey, string>;
    const prevSections = prevReviewData?.sections as Record<SectionKey, string> | undefined;

    const openTickets = allTickets.filter((t) => t.status === "open");
    const p1p2Tickets = openTickets.filter(isP1orP2);
    const p3Tickets = openTickets.filter(isP3);

    const newP1P2 = generateTicketLines(p1p2Tickets, sections.p1p2Tickets || "", prevSections?.p1p2Tickets);
    const newP3 = generateTicketLines(p3Tickets, sections.p3Tickets || "", prevSections?.p3Tickets);

    const hasP1P2Changes = newP1P2 !== (sections.p1p2Tickets || "");
    const hasP3Changes = newP3 !== (sections.p3Tickets || "");

    if (hasP1P2Changes || hasP3Changes) {
      const updatedSections = { ...sections };
      if (hasP1P2Changes) updatedSections.p1p2Tickets = newP1P2;
      if (hasP3Changes) updatedSections.p3Tickets = newP3;

      setLocalSections(updatedSections as Record<SectionKey, string>);
      saveMutation.mutate({ date: today, sections: updatedSections as Record<SectionKey, string> });
    }

    ticketLinesGeneratedRef.current = `${today}_${GENERATE_V}`;
  }, [activeReview, allTickets, prevReviewData]);

  const emptyCommentFilledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!activeReview || !allTickets.length) return;
    const reviewDate = activeReview.date;
    if (emptyCommentFilledRef.current === reviewDate) return;
    emptyCommentFilledRef.current = reviewDate;

    const sections = (activeReview.sections || {}) as unknown as Record<SectionKey, string>;
    const ticketSections: SectionKey[] = ["p1p2Tickets", "p3Tickets"];
    const ticketByNumber = new Map(allTickets.map(t => [t.ticketNumber?.replace(/\s+/g, ""), t]));

    const updatedSections = { ...sections };
    let anyChanged = false;

    for (const sectionKey of ticketSections) {
      const text = sections[sectionKey] || "";
      const lines = text.split("\n");
      const newLines: string[] = [];
      let sectionChanged = false;

      for (let i = 0; i < lines.length; i++) {
        newLines.push(lines[i]);
        const match = lines[i].match(/(ISR\s*-\s*\d+)/);
        if (match) {
          const nextLine = lines[i + 1];
          const isEmptyComment = nextLine !== undefined && (nextLine.trim() === "//" || nextLine.trim() === "// ");
          if (isEmptyComment) {
            const normalized = match[1].replace(/\s+/g, "");
            const ticket = ticketByNumber.get(normalized);
            if (ticket) {
              const summary = generateTicketSummary(ticket);
              if (summary !== "// ") {
                newLines.push(summary);
                i++;
                sectionChanged = true;
                continue;
              }
            }
          }
        }
      }

      if (sectionChanged) {
        updatedSections[sectionKey] = newLines.join("\n");
        anyChanged = true;
      }
    }

    if (anyChanged) {
      setLocalSections(updatedSections as Record<SectionKey, string>);
      saveMutationRef.current?.({ date: reviewDate, sections: updatedSections as Record<SectionKey, string> });
    }
  }, [activeReview, allTickets]);

  const saveMutationRef = useRef<((data: { date: string; sections: Record<SectionKey, string> }) => void) | null>(null);
  const slackSubmittingRef = useRef(false);

  const saveMutation = useMutation({
    mutationFn: async (data: { date: string; sections: Record<SectionKey, string> }) => {
      const res = await apiRequest("PATCH", `/api/daily-reviews/${data.date}`, { sections: data.sections });
      return res.json();
    },
    onSuccess: () => {
      setHasUnsavedChanges(false);
      queryClient.invalidateQueries({ queryKey: ["/api/daily-reviews", activeDate] });
    },
    onError: (err: any) => {
      if (err?.isAuthRedirect) return;
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  saveMutationRef.current = (data) => saveMutation.mutate(data);

  const createMutation = useMutation({
    mutationFn: async (data: { date: string; copyFromDate?: string }) => {
      const res = await apiRequest("POST", "/api/daily-reviews", data);
      return res.json();
    },
    onSuccess: (review: DailyReview) => {
      queryClient.invalidateQueries({ queryKey: ["/api/daily-reviews"] });
      setActiveDate(review.date);
      toast({ title: "Daily review created", description: `Review for ${formatDateLabel(review.date)}` });
    },
    onError: (err: any) => {
      if (err.message?.includes("already exists")) {
        toast({ title: "Review already exists", description: "Switching to existing review." });
      } else {
        toast({ title: "Failed to create review", description: err.message, variant: "destructive" });
      }
    },
  });

  const flushPendingSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = undefined;
    }
    if (pendingSaveRef.current) {
      saveMutation.mutate(pendingSaveRef.current);
      pendingSaveRef.current = null;
    }
  }, [saveMutation]);

  const handleSectionChange = useCallback((key: SectionKey, value: string) => {
    setLocalSections((prev) => {
      const updated = { ...prev, [key]: value };
      if (activeDate) {
        pendingSaveRef.current = { date: activeDate, sections: updated };
      }
      return updated;
    });
    setHasUnsavedChanges(true);

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      if (pendingSaveRef.current) {
        saveMutation.mutate(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    }, 2000);
  }, [activeDate, saveMutation]);

  const handleManualSave = () => {
    if (activeDate) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      pendingSaveRef.current = null;
      saveMutation.mutate({ date: activeDate, sections: localSections });
    }
  };

  const slackMutation = useMutation({
    mutationFn: (date: string) => apiRequest("POST", `/api/daily-reviews/${date}/slack`),
    onSuccess: (_data, date) => {
      toast({ title: "Slack update sent successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["/api/daily-reviews", date] });
    },
    onError: (err: any) => {
      let msg = "Failed to send Slack update";
      try {
        const raw = err?.message || "";
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.slice(jsonStart));
          if (parsed.message) msg = parsed.message;
        }
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);

  const regenerateMutation = useMutation({
    mutationFn: async ({ date, keepSections }: { date: string; keepSections: Record<string, string> }) => {
      await apiRequest("POST", `/api/daily-reviews/${date}/save-history`);
      await apiRequest("DELETE", `/api/daily-reviews/${date}`);
      const sections: Record<string, string> = {
        ...keepSections,
        p1p2Tickets: "",
        p3Tickets: "",
        confirmedInstalls: "",  // reset so server re-fetches fresh from Airtable
        delayedInstalls: "",    // reset so delayed calculation is recomputed fresh
        onCallRotation: "",     // reset so server re-fetches fresh from Ops Command
      };
      const res = await apiRequest("POST", "/api/daily-reviews", { date, sections });
      return res.json();
    },
    onSuccess: (review: DailyReview) => {
      autoCreatedRef.current = true;
      emptyCommentFilledRef.current = null;
      ticketLinesGeneratedRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/daily-reviews"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setActiveDate(review.date);
      setRegenConfirmOpen(false);
      toast({ title: "Daily review regenerated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to regenerate", description: err.message, variant: "destructive" });
      setRegenConfirmOpen(false);
    },
  });

  const handleNewTicketSuccess = useCallback(() => {
    setNewTicketOpen(false);
    ticketLinesGeneratedRef.current = null;
    queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
  }, []);

  const handleTabSwitch = (date: string) => {
    flushPendingSave();
    if (activeDate === date) {
      setManuallyClosed(true);
      setActiveDate(null);
    } else {
      setManuallyClosed(false);
      setActiveDate(date);
    }
  };

  const handleCloseReview = () => {
    flushPendingSave();
    setManuallyClosed(true);
    setActiveDate(null);
  };

  const handleCreateToday = () => {
    const today = getTodayStr();
    const latestDate = reviews.length > 0 ? reviews[0].date : undefined;
    createMutation.mutate({ date: today, copyFromDate: latestDate });
  };

  const handleCreateNewDay = () => {
    const today = getTodayStr();
    if (reviews.some((r) => r.date === today)) {
      setActiveDate(today);
      toast({ title: "Already exists", description: "Today's review already exists." });
      return;
    }
    handleCreateToday();
  };

  const todayExists = reviews.some((r) => r.date === getTodayStr());
  const isSlackPosted = !!(activeReview?.slackPostedAt);
  const isReadOnly = !canEditDailyReview || (activeDate !== null && activeDate !== getTodayStr()) || isSlackPosted;
  const isNextPLReadOnly = !canEditDailyReview;

  const ticketStats = useMemo(() => {
    const now = Date.now();
    const ms24h = 24 * 60 * 60 * 1000;
    const ms7d = 7 * ms24h;

    const getPLevel = (t: Ticket): number | null => {
      const m = (t.priorityLabel || "").match(/\bP(\d+)\b/i);
      return m ? parseInt(m[1], 10) : null;
    };

    const openTickets = allTickets.filter(t => t.status === "open");
    const totalOpen = openTickets.length;

    const byPriority: Record<string, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
    openTickets.forEach(t => {
      const lvl = getPLevel(t);
      if (lvl && lvl >= 1 && lvl <= 4) byPriority[`P${lvl}`]++;
    });

    const escalatedCount = openTickets.filter(t =>
      t.escalationLevel && t.escalationLevel !== "Standard" && t.escalationLevel !== "Normal"
    ).length;

    const openedIn24h = allTickets.filter(t => {
      const ts = t.submittedAt || t.createdAt;
      return ts && now - new Date(ts).getTime() <= ms24h;
    }).length;

    const openedIn7d = allTickets.filter(t => {
      const ts = t.submittedAt || t.createdAt;
      return ts && now - new Date(ts).getTime() <= ms7d;
    }).length;

    const closedIn24h = allTickets.filter(t => {
      if (t.status !== "closed") return false;
      const ts = t.resolvedAt || t.updatedAt;
      return ts && now - new Date(ts).getTime() <= ms24h;
    }).length;

    const closedIn7d = allTickets.filter(t => {
      if (t.status !== "closed") return false;
      const ts = t.resolvedAt || t.updatedAt;
      return ts && now - new Date(ts).getTime() <= ms7d;
    }).length;

    return { totalOpen, byPriority, escalatedCount, openedIn24h, openedIn7d, closedIn24h, closedIn7d };
  }, [allTickets]);

  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <FormicMark className="h-7 text-[#FF9100] cursor-pointer" />
            </Link>
            <div className="w-px h-6 bg-white/20"></div>
            <span className="font-semibold text-sm tracking-wide text-white/90 uppercase">Daily Review</span>
          </div>

          <div className="flex items-center gap-3">
            {hasUnsavedChanges && (
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 gap-1.5"
                onClick={handleManualSave}
                disabled={saveMutation.isPending}
                data-testid="button-save-review"
              >
                {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
            )}
            {!hasUnsavedChanges && activeDate && (
              <span className="text-white/40 text-xs flex items-center gap-1">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-white/60 gap-1.5"
              onClick={() => setLocation("/")}
              data-testid="button-back-to-dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {user && (
              <span className="text-white/60 text-sm hidden sm:inline">
                {user.email}
              </span>
            )}
            <Button variant="ghost" size="icon" className="text-white/60" asChild>
              <a href="/api/logout" title="Sign out">
                <LogOut className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 overflow-x-hidden">

        {/* ── Ticket Stats Bar ── */}
        {(() => {
          const snap = activeReview?.snapshotStats;
          const stats = snap ?? (ticketsLoading ? null : ticketStats);
          const isSnap = !!snap;
          return (
            <div className="mb-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Open total + by priority */}
              <div className="sm:col-span-2 rounded-xl border bg-card px-4 py-3 flex items-center gap-4 flex-wrap">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Open Tickets</span>
                    {isSnap && snap.capturedAt && (
                      <span className="text-[9px] text-muted-foreground/60 italic" title={`Snapshot taken ${new Date(snap.capturedAt).toLocaleString()}`}>
                        · snapshot {new Date(snap.capturedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                  {!stats ? (
                    <span className="text-2xl font-bold text-foreground animate-pulse">—</span>
                  ) : (
                    <span className="text-2xl font-bold text-foreground" data-testid="stat-total-open">{stats.totalOpen}</span>
                  )}
                </div>
                <div className="h-8 w-px bg-border hidden sm:block" />
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { label: "P1", color: "bg-red-500/20 text-red-400 border-red-500/30" },
                    { label: "P2", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
                    { label: "P3", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
                    { label: "P4", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
                  ].map(({ label, color }) => (
                    <div key={label} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${color}`} data-testid={`stat-priority-${label.toLowerCase()}`}>
                      <span className="opacity-70">{label}</span>
                      <span>{!stats ? "—" : (stats.byPriority[label] ?? 0)}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold bg-purple-500/20 text-purple-400 border-purple-500/30" data-testid="stat-escalated">
                    <span className="opacity-70">Esc</span>
                    <span>{!stats ? "—" : (stats.escalatedCount ?? 0)}</span>
                  </div>
                </div>
              </div>

              {/* Opened */}
              <div className="rounded-xl border bg-card px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Opened</span>
                <div className="flex items-end gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-xl font-bold text-green-400" data-testid="stat-opened-24h">{!stats ? "—" : stats.openedIn24h}</span>
                    <span className="text-[10px] text-muted-foreground">24h</span>
                  </div>
                  <div className="h-6 w-px bg-border" />
                  <div className="flex flex-col items-center">
                    <span className="text-xl font-bold text-green-300" data-testid="stat-opened-7d">{!stats ? "—" : stats.openedIn7d}</span>
                    <span className="text-[10px] text-muted-foreground">7 days</span>
                  </div>
                </div>
              </div>

              {/* Closed */}
              <div className="rounded-xl border bg-card px-4 py-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-1.5">Closed</span>
                <div className="flex items-end gap-3">
                  <div className="flex flex-col items-center">
                    <span className="text-xl font-bold text-sky-400" data-testid="stat-closed-24h">{!stats ? "—" : stats.closedIn24h}</span>
                    <span className="text-[10px] text-muted-foreground">24h</span>
                  </div>
                  <div className="h-6 w-px bg-border" />
                  <div className="flex flex-col items-center">
                    <span className="text-xl font-bold text-sky-300" data-testid="stat-closed-7d">{!stats ? "—" : stats.closedIn7d}</span>
                    <span className="text-[10px] text-muted-foreground">7 days</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {activeDate && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1 text-muted-foreground hover:text-foreground"
                onClick={handleCloseReview}
                data-testid="button-close-review"
              >
                <X className="h-3.5 w-3.5" />
                Close
              </Button>
            )}
            {reviewsLoading ? (
              <div className="flex gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-9 w-24 bg-muted animate-pulse rounded-md" />
                ))}
              </div>
            ) : (
              reviews.slice(0, 3).map((r) => (
                <Button
                  key={r.date}
                  variant={activeDate === r.date ? "default" : "outline"}
                  size="sm"
                  className={`shrink-0 ${activeDate === r.date ? "bg-[#FF9100] hover:bg-[#FF9100]/90 text-white" : ""}`}
                  onClick={() => handleTabSwitch(r.date)}
                  data-testid={`tab-review-${r.date}`}
                >
                  {formatDateLabel(r.date)}
                </Button>
              ))
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {syncMutation.isPending && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing tickets...
              </div>
            )}
            {createMutation.isPending && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Creating today's review...
              </div>
            )}
            {activeDate && isSlackPosted && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium" data-testid="badge-slack-posted">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sent to Slack
                {activeReview?.slackPostedAt && (
                  <span className="opacity-60 font-normal">
                    · {new Date(activeReview.slackPostedAt).toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
                    {new Date(activeReview.slackPostedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                )}
              </div>
            )}
            {activeDate && canEditDailyReview && (
              <Button
                data-testid="button-update-slack"
                variant="outline"
                size="sm"
                className="text-sm font-medium gap-1.5"
                disabled={slackMutation.isPending || hasUnsavedChanges}
                onClick={() => {
                  if (slackSubmittingRef.current) return;
                  slackSubmittingRef.current = true;
                  flushPendingSave();
                  slackMutation.mutate(activeDate, {
                    onSettled: () => { slackSubmittingRef.current = false; },
                  });
                }}
              >
                {slackMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {isSlackPosted ? "Resend to Slack" : "Update Slack"}
              </Button>
            )}
            {activeDate && canGenerateDailyReport && activeDate === getTodayStr() && (
              <Dialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
                <Button
                  data-testid="button-regenerate-review"
                  variant="outline"
                  size="sm"
                  className="text-sm font-medium gap-1.5"
                  disabled={regenerateMutation.isPending || hasUnsavedChanges}
                  onClick={() => setRegenConfirmOpen(true)}
                >
                  {regenerateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Regenerate
                </Button>
                <DialogContent className="sm:max-w-[420px]" aria-describedby="regen-desc">
                  <DialogHeader>
                    <DialogTitle>Regenerate Daily Review?</DialogTitle>
                  </DialogHeader>
                  <p id="regen-desc" className="text-sm text-muted-foreground">
                    This will save your current comments to ticket history, then delete and rebuild today's review from live ticket data. This may take a moment.
                  </p>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" size="sm" onClick={() => setRegenConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      data-testid="button-confirm-regenerate"
                      size="sm"
                      className="bg-[#FF9100] hover:bg-[#FF9100]/90 text-white"
                      disabled={regenerateMutation.isPending}
                      onClick={() => {
                        flushPendingSave();
                        regenerateMutation.mutate({ date: activeDate!, keepSections: localSections });
                      }}
                    >
                      {regenerateMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                      ) : null}
                      Regenerate
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <Dialog open={newTicketOpen} onOpenChange={setNewTicketOpen}>
              <DialogTrigger asChild>
                <Button
                  data-testid="button-new-ticket-review"
                  className="bg-[#FF9100] hover:bg-[#FF9100]/90 text-white text-sm font-medium"
                  size="sm"
                >
                  <Plus className="h-4 w-4 mr-1.5" strokeWidth={2.5} />
                  New Ticket
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Ticket</DialogTitle>
                </DialogHeader>
                <TicketForm
                  onSuccess={handleNewTicketSuccess}
                  onCancel={() => setNewTicketOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {!activeDate && !reviewsLoading && reviews.length === 0 && (
          <div className="text-center py-16">
            <CalendarPlus className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
            <h2 className="text-lg font-medium text-foreground mb-2">No daily reviews yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              {canEditDailyReview
                ? "Create your first daily standup review to get started."
                : "No reviews have been created yet. Check back later."}
            </p>
            {canEditDailyReview && (
              <Button
                className="gap-2 bg-[#FF9100] hover:bg-[#FF9100]/90 text-white"
                onClick={handleCreateToday}
                disabled={createMutation.isPending}
                data-testid="button-create-first-review"
              >
                <Plus className="h-4 w-4" />
                Create Today's Review
              </Button>
            )}
          </div>
        )}

        {activeDate && (reviewLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {SECTION_CONFIG.map((sec) => {
              const { key, label, color } = sec;
              const link = "link" in sec ? sec.link : undefined;
              const isP3Section = key === "p3Tickets";

              return (
                <div key={key}>
                  {key === "confirmedInstalls" && (() => {
                    const installsToShow = isReadOnly
                      ? (activeReview?.snapshotInstalls ?? null)
                      : (confirmedInstallsList.length > 0 ? confirmedInstallsList : null);
                    return installsToShow && installsToShow.length > 0;
                  })() && (
                    <div className="mb-3 border-l-4 border-green-500 bg-card rounded-lg shadow-sm overflow-hidden">
                      <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between">
                        <h3 className="font-semibold text-sm text-foreground flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-green-500" />
                          Installs with Confirmed Date{isReadOnly && " (at report time)"}
                          <span className="text-xs font-normal text-muted-foreground">({(isReadOnly ? (activeReview?.snapshotInstalls ?? []) : confirmedInstallsList).length})</span>
                        </h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className="border-b bg-muted/20">
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Customer</th>
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">System ID</th>
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Install Starts</th>
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">PM</th>
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">DPLY FSE</th>
                              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">FSE Arrival</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...(isReadOnly ? (activeReview?.snapshotInstalls ?? []) : confirmedInstallsList)].sort((a, b) => {
                              const toMs = (d: string | null | undefined) => {
                                if (!d) return Infinity;
                                const mdy = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
                                if (mdy) return new Date(`${mdy[3]}-${mdy[1].padStart(2,"0")}-${mdy[2].padStart(2,"0")}`).getTime();
                                const t = new Date(d).getTime();
                                return isNaN(t) ? Infinity : t;
                              };
                              return toMs(a.fseArrival) - toMs(b.fseArrival);
                            }).map((install) => (
                              <tr key={install.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                                <td className="px-3 py-1.5 text-foreground font-medium">{install.customer}</td>
                                <td className="px-3 py-1.5 text-[#FF9100]">{install.systemId}</td>
                                <td className="px-3 py-1.5 text-foreground">{install.installationStarts || "—"}</td>
                                <td className="px-3 py-1.5 text-muted-foreground">{install.projectManager}</td>
                                <td className="px-3 py-1.5 text-foreground">{install.dplyFse || "—"}</td>
                                <td className="px-3 py-1.5 text-foreground">{install.fseArrival || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {(() => {
                    const isNextPL = key === "nextParkingLot";
                    const sectionReadOnly = isNextPL ? isNextPLReadOnly : isReadOnly;
                    return (
                      <div className={`border-l-4 ${color} bg-card rounded-lg shadow-sm ${sectionReadOnly ? "opacity-80" : ""}`}>
                        <div className="px-4 py-2.5 border-b bg-muted/30 rounded-t-lg flex items-center justify-between">
                          <h3 className="font-semibold text-sm text-foreground">
                            {link ? (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline hover:text-[#FF9100] transition-colors"
                              >
                                {label}
                              </a>
                            ) : (
                              label
                            )}
                          </h3>
                          <div className="flex items-center gap-2">
                            {sectionReadOnly && <span className="text-xs text-muted-foreground italic">Read only</span>}
                            {isNextPL && isReadOnly && !isNextPLReadOnly && (
                              <span className="text-xs text-blue-400/70 italic">For next day</span>
                            )}
                            {isP3Section && (
                              <button
                                onClick={() => setP3Collapsed((prev) => !prev)}
                                className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
                                title={p3Collapsed ? "Expand P3 section" : "Collapse P3 section"}
                                data-testid="button-toggle-p3"
                              >
                                {p3Collapsed ? (
                                  <ChevronRight className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                        {(!isP3Section || !p3Collapsed) && (
                          <div className="p-3">
                            {(key === "p1p2Tickets" || key === "p3Tickets") ? (
                              <TicketLinesEditor
                                value={localSections[key] || ""}
                                onChange={(val) => handleSectionChange(key, val)}
                                allTickets={allTickets}
                                systems={uniqueSystems}
                                users={uniqueUsers}
                                channels={uniqueChannels}
                                readOnly={sectionReadOnly}
                                data-testid={`textarea-${key}`}
                              />
                            ) : (key === "confirmedInstalls" || key === "delayedInstalls") ? (
                              <InstallLinesEditor
                                value={localSections[key] || ""}
                                onChange={(val) => handleSectionChange(key, val)}
                                readOnly={sectionReadOnly}
                                systems={uniqueSystems}
                                users={uniqueUsers}
                                channels={uniqueChannels}
                                installs={confirmedInstallsList}
                                data-testid={`textarea-${key}`}
                              />
                            ) : (
                              <AutocompleteTextarea
                                value={localSections[key] || ""}
                                onChange={(val) => handleSectionChange(key, val)}
                                placeholder={sectionReadOnly ? "" : `Add ${label.toLowerCase()} notes...`}
                                className={`min-h-[40px] border-0 shadow-none focus-visible:ring-0 font-mono text-sm bg-transparent ${sectionReadOnly ? "cursor-default" : ""}`}
                                readOnly={sectionReadOnly}
                                systems={uniqueSystems}
                                users={uniqueUsers}
                                channels={uniqueChannels}
                                data-testid={`textarea-${key}`}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {key === "p1p2Tickets" && (
                    <div className="mt-3 space-y-3">
                      {isReadOnly ? (
                        activeReview?.snapshotP1P2Tickets ? (
                          <LiveTicketPanel
                            tickets={activeReview.snapshotP1P2Tickets as unknown as Ticket[]}
                            title="Open P1, P2 & Escalated Tickets (at report time)"
                            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                            borderColor="border-red-500"
                          />
                        ) : null
                      ) : (
                        <LiveTicketPanel
                          tickets={openP1P2}
                          title="Open P1, P2 & Escalated Tickets"
                          icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                          borderColor="border-red-500"
                        />
                      )}
                      {!isReadOnly && (
                        <ClosedP1P2Panel
                          tickets={closedP1P2SinceLastReview}
                          sinceLabel={closedSinceLabel}
                        />
                      )}
                    </div>
                  )}
                  {isP3Section && !p3Collapsed && (
                    <div className="mt-3">
                      <LiveTicketPanel
                        tickets={openP3}
                        title="Open P3 Tickets"
                        icon={<AlertCircle className="h-4 w-4 text-yellow-500" />}
                        borderColor="border-yellow-500"
                      />
                    </div>
                  )}
                  {openPartsNeeded.length > 0 && (
                    <div className="mt-3">
                      <LiveTicketPanel
                        tickets={openPartsNeeded}
                        title="Parts Needed"
                        icon={<Package className="h-4 w-4 text-amber-400" />}
                        borderColor="border-amber-500"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </main>
    </div>
  );
}
