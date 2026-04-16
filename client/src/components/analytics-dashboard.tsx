import { useMemo, useRef, useState } from "react";
import type { Ticket } from "@shared/schema";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Server, Upload, X, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type GroupMode = "team" | "priority" | "fs";

// A palette of visually distinct colors for use when multiple groups
// can share the same priority level (e.g. AT: P1, FO: P1, PD: P1).
const DISTINCT_PALETTE = [
  "#FF9100", // orange (Formic)
  "#00BCD4", // cyan
  "#EC4899", // pink
  "#4CAF50", // green
  "#8B5CF6", // violet
  "#F44336", // red
  "#2196F3", // blue
  "#F59E0B", // amber
  "#14B8A6", // teal
  "#A855F7", // purple
  "#84CC16", // lime
  "#EF4444", // rose
];

function buildGroupColorMap(groups: string[]): Record<string, string> {
  const sorted = [...groups].sort();
  const map: Record<string, string> = {};
  sorted.forEach((g, i) => {
    map[g] = DISTINCT_PALETTE[i % DISTINCT_PALETTE.length];
  });
  return map;
}

function shortenPriority(label: string): string {
  const parts = label.split(":");
  if (parts.length >= 2) {
    return parts.slice(0, 2).map(s => s.trim()).join(": ");
  }
  return label;
}

function extractPLevel(label: string): string {
  const match = label.match(/P\d+(?:-\d+)?/i);
  return match ? match[0] : "Other";
}

function extractTeam(priorityLabel: string | null): string {
  if (!priorityLabel) return "Other";
  const match = priorityLabel.match(/^([A-Z]{2}):/);
  return match ? match[1] : "Other";
}

function getPriorityRank(label: string): number {
  const match = label.match(/P(\d+)/i);
  if (!match) return 99;
  const level = parseInt(match[1]);
  const subMatch = label.match(/P\d+-(\d+)/i);
  const sub = subMatch ? parseInt(subMatch[1]) : 0;
  return level * 10 + sub;
}

function getGroup(ticket: Ticket, groupBy: GroupMode): string {
  if (groupBy === "team") return extractTeam(ticket.priorityLabel);
  if (groupBy === "fs") return ticket.priorityLabel ? extractPLevel(ticket.priorityLabel) : "Other";
  return ticket.priorityLabel ? shortenPriority(ticket.priorityLabel) : "Other";
}

function filterToHighestPriorityPerTeam(ticketList: Ticket[]): Ticket[] {
  const teamHighest = new Map<string, string>();
  for (const t of ticketList) {
    const team = extractTeam(t.priorityLabel);
    const short = t.priorityLabel ? shortenPriority(t.priorityLabel) : "Other";
    const existing = teamHighest.get(team);
    if (!existing || getPriorityRank(short) < getPriorityRank(existing)) {
      teamHighest.set(team, short);
    }
  }
  return ticketList.filter((t) => {
    const team = extractTeam(t.priorityLabel);
    const short = t.priorityLabel ? shortenPriority(t.priorityLabel) : "Other";
    return teamHighest.get(team) === short;
  });
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeek(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toDate(val: Date | string | null | undefined): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val as string);
  return isNaN(d.getTime()) ? null : d;
}

function getTicketClosedAt(ticket: Ticket): Date | null {
  if (ticket.status !== "closed") return null;
  return toDate(ticket.resolvedAt) ?? toDate(ticket.updatedAt);
}

/**
 * Calculate how many hours a ticket was open as measured within a given week.
 *
 * Overlap logic:
 *   - A ticket is "in" a week if: openedAt < weekEnd AND (closedAt is null OR closedAt >= weekStart)
 *   - effective_end:
 *       - if the ticket closed during the week → use closedAt
 *       - otherwise → use min(weekEnd, now)  (still open or closed after the week)
 *   - open_age_hours = effective_end − openedAt
 */
function getTicketOpenAgeInWeek(ticket: Ticket, weekStart: Date, weekEnd: Date, now: Date): number | null {
  const openedAt = toDate(ticket.submittedAt || ticket.createdAt);
  if (!openedAt) return null;

  // Must have opened before the week ended
  if (openedAt >= weekEnd) return null;

  const closedAt = getTicketClosedAt(ticket);

  // Must not have closed before the week started
  if (closedAt !== null && closedAt < weekStart) return null;

  // effective_end: use closedAt if it falls within the week; otherwise cap at min(weekEnd, now)
  let effectiveEnd: Date;
  if (closedAt !== null && closedAt >= weekStart && closedAt <= weekEnd) {
    effectiveEnd = closedAt; // closed inside this week
  } else {
    effectiveEnd = weekEnd > now ? now : weekEnd; // min(weekEnd, now)
  }

  return (effectiveEnd.getTime() - openedAt.getTime()) / (1000 * 60 * 60);
}

function getTicketStart(ticket: Ticket): Date | null {
  const start = ticket.submittedAt || ticket.createdAt;
  return start ? new Date(start) : null;
}

function prepareTickets(allTickets: Ticket[], groupBy: GroupMode, cutoffDate: Date): Ticket[] {
  let filtered = allTickets.filter((t) => {
    if (t.status === "open") return true;
    const d = getTicketStart(t);
    return d && d >= cutoffDate;
  });

  if (groupBy === "fs") {
    filtered = filtered.filter((t) => extractTeam(t.priorityLabel) === "FO");
  }

  if (groupBy === "priority") {
    filtered = filterToHighestPriorityPerTeam(filtered);
  }

  return filtered;
}


// Priority colors matching the daily review / mobile ticket list color scheme:
// P1 = red-500, P2 = orange-400, P3 = amber-400, P4 = blue-400
const P_LEVEL_COLORS: Record<string, string> = {
  P1: "#ef4444", // red-500
  P2: "#fb923c", // orange-400
  P3: "#fbbf24", // amber-400
  P4: "#60a5fa", // blue-400
  Other: "#9BA19E",
};

// ── User analytics ────────────────────────────────────────────────────────────
function UserAnalyticsSection({ tickets = [], now, onFilterByAssignee }: { tickets: Ticket[]; now: Date; onFilterByAssignee?: (fullName: string) => void }) {
  const chartData = useMemo(() => {
    const byAssignee: Record<string, number[]> = {};

    for (const t of tickets) {
      if (t.status !== "open") continue;
      const assignee = t.assigneeName?.trim();
      if (!assignee) continue;
      const openedAt = toDate(t.submittedAt || t.createdAt);
      if (!openedAt) continue;
      const ageDays = (now.getTime() - openedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (!byAssignee[assignee]) byAssignee[assignee] = [];
      byAssignee[assignee].push(ageDays);
    }

    return Object.entries(byAssignee)
      .map(([name, ages]) => ({
        name: name.split(" ")[0],
        fullName: name,
        avg_days: ages.reduce((a, b) => a + b, 0) / ages.length,
        tickets: ages.length,
      }))
      .sort((a, b) => b.avg_days - a.avg_days);
  }, [tickets, now]);

  const colorMap = useMemo(() => buildGroupColorMap(chartData.map(r => r.fullName)), [chartData]);

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-[#FF9100]" />
          Avg Days Tickets Open · By Assignee
        </CardTitle>
        <p className="text-xs text-muted-foreground">Open tickets only · avg age per ticket · all time{onFilterByAssignee ? " · click bar to filter" : ""}</p>
      </CardHeader>
      <CardContent className="px-2 pb-4">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">No open tickets</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 36)}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 5, right: 40, left: 60, bottom: 5 }}
              style={onFilterByAssignee ? { cursor: "pointer" } : undefined}
              onClick={(data: any) => {
                const fullName = data?.activePayload?.[0]?.payload?.fullName;
                if (fullName && onFilterByAssignee) onFilterByAssignee(fullName);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickFormatter={(v: number) => `${v}d`}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} tickLine={false} axisLine={false} width={55} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12, color: "hsl(var(--foreground))" }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                itemStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(value: number, _name: string, props: any) => [`${value.toFixed(1)}d avg age (${props.payload.tickets} open tickets)`, props.payload.fullName]}
              />
              <Bar dataKey="avg_days" radius={[0, 4, 4, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.fullName} fill={colorMap[entry.fullName] ?? "#9BA19E"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

type AssetsVisitedData = {
  count: number;
  totalActive: number;
  visited: Array<{ sysId: string; assetName: string | null; assetId: number | null }>;
  unvisited: Array<{ sysId: string; assetName: string | null; assetId: number | null; hasScheduled: boolean }>;
  unvisitedNoSchedule: Array<{ sysId: string; assetName: string | null; assetId: number | null; hasScheduled: boolean }>;
  noMxAsset: Array<{ sysId: string }>;
  noPMScheduled: Array<{ sysId: string; assetName: string }>;
  periodDays: number | null;
  source?: "csv";
  rowCount?: number;
};

function parseMaintainXCsv(text: string): Array<{ status: string; asset: string; dueDate: string }> {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const statusIdx = header.findIndex(h => h.trim().toLowerCase() === "status");
  const assetIdx = header.findIndex(h => h.trim().toLowerCase() === "asset");
  const dueDateIdx = header.findIndex(h => h.trim().toLowerCase() === "due date");
  if (statusIdx === -1 || assetIdx === -1) return [];
  const rows: Array<{ status: string; asset: string; dueDate: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    rows.push({
      status: cols[statusIdx] ?? "",
      asset: cols[assetIdx] ?? "",
      dueDate: dueDateIdx >= 0 ? (cols[dueDateIdx] ?? "") : "",
    });
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result;
}

function AssetsVisitedTracker() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const LS_DATA_KEY = "mx-csv-data";
  const LS_META_KEY = "mx-csv-meta";

  function loadFromStorage(): { data: AssetsVisitedData; fileName: string; loadedAt: string } | null {
    try {
      const raw = localStorage.getItem(LS_DATA_KEY);
      const meta = localStorage.getItem(LS_META_KEY);
      if (!raw || !meta) return null;
      return { data: JSON.parse(raw), ...JSON.parse(meta) };
    } catch { return null; }
  }

  const stored = loadFromStorage();
  const [csvData, setCsvData] = useState<AssetsVisitedData | null>(stored?.data ?? null);
  const [csvFileName, setCsvFileName] = useState<string | null>(stored?.fileName ?? null);
  const [csvLoadedAt, setCsvLoadedAt] = useState<string | null>(stored?.loadedAt ?? null);
  const [isUploading, setIsUploading] = useState(false);

  const { data: apiData, isLoading, isFetching, error, refetch } = useQuery<AssetsVisitedData>({
    queryKey: ["/api/maintainx/assets-visited"],
    staleTime: 1000 * 60 * 15,
    refetchOnWindowFocus: false,
  });

  const data = csvData ?? apiData;

  async function handleCsvFile(file: File) {
    setIsUploading(true);
    try {
      const text = await file.text();
      const rows = parseMaintainXCsv(text);
      if (rows.length === 0) {
        toast({ title: "CSV parse error", description: "No rows found. Make sure Status and Asset columns exist.", variant: "destructive" });
        return;
      }
      const result = await apiRequest("POST", "/api/maintainx/assets-visited-csv", { rows });
      const json: AssetsVisitedData = await result.json();
      const loadedAt = new Date().toLocaleString();
      setCsvData(json);
      setCsvFileName(file.name);
      setCsvLoadedAt(loadedAt);
      try {
        localStorage.setItem(LS_DATA_KEY, JSON.stringify(json));
        localStorage.setItem(LS_META_KEY, JSON.stringify({ fileName: file.name, loadedAt }));
      } catch { /* storage full — continue without persistence */ }
      toast({ title: "CSV loaded", description: `${rows.length} rows processed from ${file.name}` });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }

  function clearCsv() {
    setCsvData(null);
    setCsvFileName(null);
    setCsvLoadedAt(null);
    localStorage.removeItem(LS_DATA_KEY);
    localStorage.removeItem(LS_META_KEY);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const sourceLabel = csvData
    ? `CSV · ${csvData.rowCount ?? "?"} rows · ${csvFileName ?? "upload"}${csvLoadedAt ? ` · loaded ${csvLoadedAt}` : ""}`
    : "MaintainX · Last 100 days · 6 - Billing systems";

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        data-testid="input-csv-upload"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground font-medium">{sourceLabel}</p>
        <div className="flex items-center gap-2">
          {csvData && (
            <button
              data-testid="button-clear-csv"
              onClick={clearCsv}
              title="Clear CSV — revert to live MaintainX data"
              className="text-muted-foreground/40 hover:text-red-400 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            data-testid="button-upload-csv"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            title="Upload MaintainX CSV export"
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:cursor-not-allowed"
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          </button>
          {!csvData && (
            <button
              data-testid="button-refresh-maintainx"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh MaintainX data"
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:cursor-not-allowed"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </div>
      <Card className="border-[#FF9100]/20">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-[#FF9100]/10 flex items-center justify-center">
              <Server className="h-5 w-5 text-[#FF9100]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-muted-foreground">
                {csvData ? "Systems Visited (from CSV)" : "Systems Visited (last 100 days)"}
              </p>
              {isLoading ? (
                <div className="flex items-center gap-2 mt-1">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading from MaintainX + Airtable FJD...</span>
                </div>
              ) : error ? (
                <p className="text-sm text-red-500">Failed to load</p>
              ) : (
                <p data-testid="text-assets-visited-count" className="text-2xl font-bold">
                  {data?.count ?? 0}
                  {data?.totalActive ? (
                    <span className="text-sm font-normal text-muted-foreground"> / {data.totalActive} active</span>
                  ) : null}
                  {data?.totalActive ? (
                    <span className="ml-2 text-base font-semibold text-[#FF9100]">
                      {Math.round((data.count / data.totalActive) * 100)}%
                    </span>
                  ) : null}
                </p>
              )}
            </div>
          </div>

          {/* Row 1: visited / not visited — side by side */}
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {data?.visited && data.visited.length > 0 && (
              <details className="min-w-0">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                  ✓ {data.visited.length} visited
                </summary>
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {data.visited.map((a) => (
                    <li key={a.sysId} className="text-xs pl-2 border-l-2 border-green-500/40">
                      <span className="font-mono text-foreground">{a.sysId}</span>
                      {a.assetName && <span className="text-muted-foreground ml-2">· {a.assetName}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {data?.unvisited && data.unvisited.length > 0 && (
              <details className="min-w-0">
                <summary className="text-xs text-red-400 cursor-pointer hover:text-red-300 transition-colors select-none">
                  ✗ {data.unvisited.length} not visited
                </summary>
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {data.unvisited.map((a) => (
                    <li key={a.sysId} className="text-xs pl-2 border-l-2 border-red-500/40">
                      <span className="font-mono text-foreground">{a.sysId}</span>
                      {a.assetName && <span className="text-muted-foreground ml-2">· {a.assetName}</span>}
                      {!a.assetName && !csvData && <span className="text-muted-foreground/50 ml-2">· not found in MaintainX</span>}
                      {a.hasScheduled && <span className="text-yellow-500/80 ml-1">· visit scheduled</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/40 pt-2">
            {data?.noMxAsset && data.noMxAsset.length > 0 && (
              <details className="min-w-0">
                <summary className="text-xs text-purple-400 cursor-pointer hover:text-purple-300 transition-colors select-none">
                  ✗ {data.noMxAsset.length} {csvData ? "no WOs in CSV" : "no MX asset"}
                </summary>
                <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {data.noMxAsset.map((a) => (
                    <li key={a.sysId} className="text-xs pl-2 border-l-2 border-purple-500/40">
                      <span className="font-mono text-foreground">{a.sysId}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface AnalyticsDashboardProps {
  tickets: Ticket[];
  onFilterByGroup?: (group: string, groupMode: GroupMode) => void;
  onFilterByAssignee?: (fullName: string) => void;
}

export function AnalyticsDashboard({ tickets, onFilterByGroup, onFilterByAssignee }: AnalyticsDashboardProps) {
  const groupBy: GroupMode = "fs";

  const now = useMemo(() => new Date(), []);

  const chartData = useMemo(() => {
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const relevantTickets = prepareTickets(tickets, groupBy, ninetyDaysAgo);

    if (relevantTickets.length === 0) {
      return { data: [], groups: [], hasData: false };
    }

    const weeks: Date[] = [];
    const weekStart = getWeekStart(ninetyDaysAgo);
    const endWeek = getWeekStart(now); // start of the current (incomplete) week
    let current = new Date(weekStart);
    // Stop before the current week — its numbers are incomplete mid-week
    while (current < endWeek) {
      weeks.push(new Date(current));
      current.setDate(current.getDate() + 7);
    }

    const allGroups = new Set<string>();
    relevantTickets.forEach((t) => allGroups.add(getGroup(t, groupBy)));
    // Only show P1–P4; exclude "Other" and any unrecognised labels
    const VALID_P_LEVELS = new Set(["P1", "P2", "P3", "P4"]);
    const groups = new Set([...allGroups].filter(g => VALID_P_LEVELS.has(g)));

    const data = weeks.map((week) => {
      const weekEnd = new Date(week);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const point: Record<string, any> = {
        week: formatWeek(week),
        weekDate: week.toISOString(),
      };

      let hasAnyData = false;
      groups.forEach((group) => {
        // --- OVERLAP INCLUSION RULE ---
        // Include a ticket in this week's bucket if it was open at ANY point during the week:
        //   openedAt < weekEnd  AND  (closedAt is null OR closedAt >= weekStart)
        // Then measure open age using effective_end = closedAt (if within week) else min(weekEnd, now)
        const durations = relevantTickets
          .filter((t) => getGroup(t, groupBy) === group)
          .map((t) => getTicketOpenAgeInWeek(t, week, weekEnd, now))
          .filter((d): d is number => d !== null);

        if (durations.length === 0) {
          point[group] = null;
          point[`${group}_count`] = 0;
        } else {
          hasAnyData = true;
          const avgHours = durations.reduce((a, b) => a + b, 0) / durations.length;
          // Store in days for readability
          point[group] = Math.round((avgHours / 24) * 10) / 10;
          point[`${group}_count`] = durations.length;
        }
      });

      return hasAnyData ? point : null;
    }).filter((p): p is Record<string, any> => p !== null);

    return { data, groups: Array.from(groups).sort(), hasData: true };
  }, [tickets, groupBy, now]);

  const { data: priorityStats7d = [] } = useQuery<{
    priority_label: string;
    avg_hours: string;
    avg_days: string;
    ticket_count: number;
    open_count: number;
  }[]>({
    queryKey: ["/api/analytics/priority-stats-7d"],
    staleTime: 30 * 1000,
  });

  // Aggregate full priority labels (e.g. "FO: P1: Down") into P-level buckets
  // using a weighted average over ticket_count.
  const statData = useMemo(() => {
    const VALID_P = new Set(["P1", "P2", "P3", "P4"]);
    const buckets: Record<string, { sumWeighted: number; sumCount: number; openCount: number }> = {};

    for (const r of priorityStats7d) {
      const match = r.priority_label.match(/P(\d+)/i);
      if (!match) continue;
      const pLevel = `P${match[1]}`;
      if (!VALID_P.has(pLevel)) continue;
      const avgD = parseFloat(r.avg_days);
      const cnt = Number(r.ticket_count);
      const open = Number(r.open_count);
      if (!buckets[pLevel]) buckets[pLevel] = { sumWeighted: 0, sumCount: 0, openCount: 0 };
      buckets[pLevel].sumWeighted += avgD * cnt;
      buckets[pLevel].sumCount += cnt;
      buckets[pLevel].openCount += open;
    }

    return ["P1", "P2", "P3", "P4"]
      .filter((p) => buckets[p]?.sumCount > 0)
      .map((p) => ({
        group: p,
        avg: buckets[p].sumWeighted / buckets[p].sumCount,
        count: buckets[p].sumCount,
        openCount: buckets[p].openCount,
      }));
  }, [priorityStats7d]);

  // Always FO priority mode — use the same P-level color scheme as the daily review
  const getColor = (group: string) => P_LEVEL_COLORS[group] ?? "#9BA19E";

  return (
    <div className="space-y-4" data-testid="analytics-dashboard">
      <div>
        <p className="text-sm text-muted-foreground">
          Avg open age of FO tickets present each week · by priority · last 90 days
        </p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">
          Days open · P1–P4 only · includes every FO ticket open at any point during each week
        </p>
      </div>

      <div className="h-[400px] w-full">
        {!chartData.hasData ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No ticket data available for the last 90 days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData.data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                tickFormatter={(v: number) => `${v}d`}
                label={{
                  value: "Avg Days Open",
                  angle: -90,
                  position: "insideLeft",
                  style: { fontSize: 12, fill: "hsl(var(--muted-foreground))" },
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: 13,
                  color: "hsl(var(--foreground))",
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                itemStyle={{ color: "hsl(var(--muted-foreground))" }}
                formatter={(value: number, name: string, props: any) => {
                  if (value === null || value === undefined) return ["—", name];
                  const count = props?.payload?.[`${name}_count`];
                  const countStr = count != null ? ` · ${count} ticket${count !== 1 ? "s" : ""}` : "";
                  return [`${value.toFixed(1)}d avg open age${countStr}`, name];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {chartData.groups.map((group) => (
                <Line
                  key={group}
                  type="monotone"
                  dataKey={group}
                  stroke={getColor(group)}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <UserAnalyticsSection tickets={tickets} now={now} onFilterByAssignee={onFilterByAssignee} />

      <AssetsVisitedTracker />

      {statData.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground font-medium">Open + closed last 7 days</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {statData.map(({ group, count, avg, openCount }) => {
              const closedCount = count - openCount;
              return (
              <Card
                key={group}
                data-testid={`stat-card-${group}`}
                className={onFilterByGroup ? "cursor-pointer transition-shadow hover:shadow-md hover:border-[#FF9100]/40" : ""}
                onClick={() => onFilterByGroup?.(group, groupBy)}
              >
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: getColor(group) }}
                    />
                    <span className="text-sm font-medium">{group}</span>
                  </div>
                  <div className="text-lg font-semibold">
                    {avg.toFixed(1)}d
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {openCount} open{closedCount > 0 ? ` · ${closedCount} closed` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground/70">avg time at priority</div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
