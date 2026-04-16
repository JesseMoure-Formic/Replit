import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { FormicMark } from "@/components/formic-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Ticket, RegionGroup } from "@shared/schema";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
} from "recharts";
import {
  LogOut,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Tag,
  Users,
  TrendingDown,
  AlertCircle,
  Sparkles,
  GitMerge,
  RefreshCcw,
  Trash2,
  MapPin,
  Settings2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

const RANGE_OPTIONS = [
  { label: "7 Days", days: 7 },
  { label: "30 Days", days: 30 },
  { label: "90 Days", days: 90 },
  { label: "All", days: 0 },
];

const ORANGE = "#FF9100";
const MINT = "#4CAF50";
const TEAL = "#00BCD4";
const VIOLET = "#8B5CF6";

const BAR_COLORS = [
  "#FF9100", "#00BCD4", "#4CAF50", "#8B5CF6", "#EC4899",
  "#F59E0B", "#14B8A6", "#A855F7", "#84CC16", "#2196F3",
];

function BucketBarChart({
  data,
  colors,
  onBarClick,
}: {
  data: { id: number; name: string; count: number }[];
  colors: string[];
  onBarClick: (d: { id: number; name: string }) => void;
}) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex flex-col gap-3 w-full">
      {data.map((d, i) => {
        const pct = (d.count / max) * 100;
        const color = colors[i % colors.length];
        return (
          <div
            key={d.id}
            className="w-full cursor-pointer group"
            onClick={() => onBarClick(d)}
            title={`${d.name}: ${d.count} tickets`}
          >
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <span className="text-xs text-white/75 leading-snug font-medium group-hover:text-white transition-colors">
                {d.name}
              </span>
              <span className="text-xs font-semibold shrink-0" style={{ color }}>
                {d.count}
              </span>
            </div>
            <div className="w-full h-4 rounded-sm bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-sm transition-all duration-300"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / 86400000);
}

function getWeekLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatCard({
  icon,
  label,
  value,
  sub,
  color = "text-[#FF9100]",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 flex items-start gap-3">
      <div className={`mt-0.5 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-white/50 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function ClosedTicketsPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [rangeDays, setRangeDays] = useState(90);


  const handleIssueBucketClick = (data: { id: number; name: string }) => {
    navigate(`/?issueBucket=${data.id}`);
  };

  const handleSolutionBucketClick = (data: { id: number; name: string }) => {
    navigate(`/?solutionBucket=${data.id}`);
  };
  const [classifyResult, setClassifyResult] = useState<{
    processed: number;
    errors: number;
    newIssueBuckets: number;
    newSolutionBuckets: number;
    total: number;
  } | null>(null);

  const bulkClassifyMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/bucketize-all"),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setClassifyResult(data);
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/buckets"] });
      toast({
        title: "Classification complete",
        description: `${data.processed} tickets classified, ${data.newIssueBuckets + data.newSolutionBuckets} new buckets created.`,
      });
    },
    onError: () => {
      toast({ title: "Classification failed", variant: "destructive" });
    },
  });

  const condenseMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/condense-buckets"),
    onSuccess: async (res: any) => {
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/buckets"] });
      toast({
        title: "Buckets condensed",
        description: `${data.issueMerged} issue merges · ${data.solutionMerged} solution merges`,
      });
    },
    onError: () => {
      toast({ title: "Condense failed", variant: "destructive" });
    },
  });

  const reassessMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/reassess-buckets"),
    onSuccess: async (res: any) => {
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/buckets"] });
      toast({
        title: "Reassessment complete",
        description: `${data.processed} of ${data.total} tickets reassigned${data.errors > 0 ? ` · ${data.errors} errors` : ""}`,
      });
    },
    onError: () => {
      toast({ title: "Reassessment failed", variant: "destructive" });
    },
  });

  const makeClearMutation = (type: "issue" | "solution") => ({
    mutationFn: () => apiRequest("DELETE", `/api/admin/buckets/${type}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/buckets"] });
      toast({ title: `All ${type} types cleared` });
    },
    onError: () => {
      toast({ title: `Clear failed`, variant: "destructive" as const });
    },
  });
  const clearIssueMutation = useMutation(makeClearMutation("issue"));
  const clearSolutionMutation = useMutation(makeClearMutation("solution"));

  const { data: tickets = [] } = useQuery<Ticket[]>({ queryKey: ["/api/tickets"] });
  const { data: bucketsData } = useQuery<{
    issueBuckets: { id: number; name: string; count: number }[];
    solutionBuckets: { id: number; name: string; count: number }[];
  }>({ queryKey: ["/api/buckets"] });
  const { data: createdByPerson = [] } = useQuery<{ name: string; count7d: number; count30d: number; countAll: number }[]>({
    queryKey: ["/api/analytics/created-by-person"],
    staleTime: 60_000,
  });
  const { data: byRegion = [] } = useQuery<{ region: string; ticketCount: number; avgHoursClosed: number | null; openCount: number; closedCount: number }[]>({
    queryKey: ["/api/analytics/by-region", rangeDays],
    queryFn: () => fetch(`/api/analytics/by-region?days=${rangeDays}`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  // Region config (admin only)
  const isRegionAdmin = user?.email === "jmoure@formic.co";
  const [regionConfigOpen, setRegionConfigOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<RegionGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupRegions, setGroupRegions] = useState<string[]>([]);

  const { data: regionGroupsData = [], refetch: refetchGroups } = useQuery<RegionGroup[]>({
    queryKey: ["/api/region-groups"],
    staleTime: 30_000,
    enabled: isRegionAdmin,
  });
  const { data: rawRegions = [] } = useQuery<string[]>({
    queryKey: ["/api/analytics/raw-regions"],
    staleTime: 60_000,
    enabled: regionConfigOpen && isRegionAdmin,
  });

  const createGroupMut = useMutation({
    mutationFn: (body: { displayName: string; regions: string[] }) =>
      apiRequest("POST", "/api/region-groups", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/region-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/by-region"] });
      setEditingGroup(null); setGroupName(""); setGroupRegions([]);
    },
  });
  const updateGroupMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { displayName: string; regions: string[] } }) =>
      apiRequest("PUT", `/api/region-groups/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/region-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/by-region"] });
      setEditingGroup(null); setGroupName(""); setGroupRegions([]);
    },
  });
  const deleteGroupMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/region-groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/region-groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/by-region"] });
    },
  });

  function startEdit(g: RegionGroup) {
    setEditingGroup(g);
    setGroupName(g.displayName);
    setGroupRegions(g.regions);
  }
  function startNew() {
    setEditingGroup(null);
    setGroupName("");
    setGroupRegions([]);
  }
  function saveGroup() {
    if (!groupName.trim() || groupRegions.length === 0) return;
    if (editingGroup) {
      updateGroupMut.mutate({ id: editingGroup.id, body: { displayName: groupName.trim(), regions: groupRegions } });
    } else {
      createGroupMut.mutate({ displayName: groupName.trim(), regions: groupRegions });
    }
  }
  function toggleRegion(r: string) {
    setGroupRegions(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  const cutoff = useMemo(() => {
    if (!rangeDays) return null;
    const d = new Date();
    d.setDate(d.getDate() - rangeDays);
    return d;
  }, [rangeDays]);

  const closed = useMemo(() => {
    return tickets.filter(t => {
      if (t.status !== "closed") return false;
      if (!cutoff) return true;
      const resolved = toDate(t.resolvedAt);
      return resolved ? resolved >= cutoff : true;
    });
  }, [tickets, cutoff]);

  const closedIdToIssueBucket = useMemo(() => {
    const m: Record<number, number> = {};
    closed.forEach(t => { if (t.issueBucketId) m[t.issueBucketId] = (m[t.issueBucketId] ?? 0) + 1; });
    return m;
  }, [closed]);

  const closedIdToSolutionBucket = useMemo(() => {
    const m: Record<number, number> = {};
    closed.forEach(t => { if (t.solutionBucketId) m[t.solutionBucketId] = (m[t.solutionBucketId] ?? 0) + 1; });
    return m;
  }, [closed]);

  const totalClosed = closed.length;

  const resolutionTimes = useMemo(() => {
    return closed
      .map(t => {
        const s = toDate(t.submittedAt ?? t.createdAt);
        const r = toDate(t.resolvedAt);
        if (!s || !r) return null;
        return daysBetween(s, r);
      })
      .filter((n): n is number => n !== null);
  }, [closed]);

  const avgDays =
    resolutionTimes.length > 0
      ? (resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length).toFixed(1)
      : "—";

  const medianDays = useMemo(() => {
    if (!resolutionTimes.length) return "—";
    const sorted = [...resolutionTimes].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const m =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    return m.toFixed(1);
  }, [resolutionTimes]);

  const pctClassified = useMemo(() => {
    if (!totalClosed) return "—";
    const n = closed.filter(t => t.issueBucketId || t.solutionBucketId).length;
    return Math.round((n / totalClosed) * 100) + "%";
  }, [closed, totalClosed]);

  const issueCounts = useMemo(() => {
    return (bucketsData?.issueBuckets ?? [])
      .map(b => ({ id: b.id, name: b.name, count: closedIdToIssueBucket[b.id] ?? 0 }))
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [bucketsData, closedIdToIssueBucket]);

  const solutionCounts = useMemo(() => {
    return (bucketsData?.solutionBuckets ?? [])
      .map(b => ({ id: b.id, name: b.name, count: closedIdToSolutionBucket[b.id] ?? 0 }))
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [bucketsData, closedIdToSolutionBucket]);

  const assigneeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    closed.forEach(t => {
      const name = t.assigneeName ?? "Unassigned";
      counts[name] = (counts[name] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [closed]);

  const weeklyTrend = useMemo(() => {
    if (!closed.length) return [];
    const closedBins: Record<string, number> = {};
    const openedBins: Record<string, number> = {};

    // Count closed per week (by resolvedAt)
    const sortedClosed = [...closed]
      .map(t => toDate(t.resolvedAt))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());
    if (!sortedClosed.length) return [];
    sortedClosed.forEach(d => {
      const weekStart = new Date(d);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const key = getWeekLabel(weekStart);
      closedBins[key] = (closedBins[key] ?? 0) + 1;
    });

    // Count opened per week (by submittedAt/createdAt), same date range
    tickets.forEach(t => {
      const d = toDate(t.submittedAt ?? t.createdAt);
      if (!d) return;
      if (cutoff && d < cutoff) return;
      const weekStart = new Date(d);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const key = getWeekLabel(weekStart);
      openedBins[key] = (openedBins[key] ?? 0) + 1;
    });

    // Merge all weeks
    const allWeeks = new Set([...Object.keys(closedBins), ...Object.keys(openedBins)]);
    return [...allWeeks]
      .sort()
      .map(week => ({ week, closed: closedBins[week] ?? 0, opened: openedBins[week] ?? 0 }));
  }, [closed, tickets, cutoff]);


  return (
    <div className="min-h-screen bg-[#091557] text-white">
      {/* Header */}
      <header className="glass-header sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <FormicMark className="h-7 text-[#FF9100] cursor-pointer" />
            </Link>
            <div className="w-px h-6 bg-white/20" />
            <span className="font-semibold text-sm tracking-wide text-white/90 uppercase">
              Closed Ticket Insights
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-white/70 hover:text-white gap-1.5 text-sm">
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Back to Tracker</span>
              </Button>
            </Link>
            {user && (
              <span className="text-white/60 text-sm hidden sm:inline">{user.email}</span>
            )}
            <Button variant="ghost" size="icon" className="text-white/60" asChild>
              <a href="/api/logout" title="Sign out">
                <LogOut className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Sticky title + range bar */}
        <div className="sticky top-16 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-[#091557] pb-3 pt-4 border-b border-white/8 shadow-[0_4px_24px_rgba(9,21,87,0.9)]">
          {/* Row 1: title + range pills */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-white">Closed Ticket Summary</h1>
              <p className="text-sm text-white/50 mt-0.5">Resolution data, issue types, and solution patterns</p>
            </div>
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
              {RANGE_OPTIONS.map(({ label, days }) => (
                <button
                  key={label}
                  data-testid={`range-${label}`}
                  onClick={() => setRangeDays(days)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    rangeDays === days ? "bg-[#FF9100] text-white" : "text-white/50 hover:text-white/80"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Row 2: admin buttons (admin only) */}
          {isAdmin && (
          <div className="flex items-center gap-3 flex-wrap mt-3">
            {/* Bulk classify button — admin only */}
            {isAdmin && (
              <>
                <button
                  data-testid="button-bulk-classify"
                  disabled={bulkClassifyMutation.isPending}
                  onClick={() => {
                    setClassifyResult(null);
                    bulkClassifyMutation.mutate();
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    bg-[#FF9100]/10 border-[#FF9100]/30 text-[#FF9100] hover:bg-[#FF9100]/20
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkClassifyMutation.isPending ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-[#FF9100]/40 border-t-[#FF9100] rounded-full animate-spin" />
                      Classifying…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      AI Classify All
                    </>
                  )}
                </button>

                {/* Result badge */}
                {classifyResult && !bulkClassifyMutation.isPending && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-green-500/30 bg-green-500/10 text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {classifyResult.processed} classified · {classifyResult.newIssueBuckets + classifyResult.newSolutionBuckets} new buckets
                    {classifyResult.errors > 0 && ` · ${classifyResult.errors} errors`}
                  </div>
                )}

                {/* Condense buckets button */}
                <button
                  data-testid="button-condense-buckets"
                  disabled={condenseMutation.isPending || bulkClassifyMutation.isPending || reassessMutation.isPending}
                  onClick={() => condenseMutation.mutate()}
                  title="Merge similar buckets if either type exceeds 10"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {condenseMutation.isPending ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-purple-400/40 border-t-purple-400 rounded-full animate-spin" />
                      Condensing…
                    </>
                  ) : (
                    <>
                      <GitMerge className="h-3.5 w-3.5" />
                      Condense Buckets
                    </>
                  )}
                </button>

                {/* Reassess all tickets button */}
                <button
                  data-testid="button-reassess-buckets"
                  disabled={reassessMutation.isPending || bulkClassifyMutation.isPending || condenseMutation.isPending}
                  onClick={() => reassessMutation.mutate()}
                  title="Re-run AI classification on all closed tickets using the current bucket list"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    bg-sky-500/10 border-sky-500/30 text-sky-400 hover:bg-sky-500/20
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reassessMutation.isPending ? (
                    <>
                      <div className="h-3.5 w-3.5 border-2 border-sky-400/40 border-t-sky-400 rounded-full animate-spin" />
                      Reassessing…
                    </>
                  ) : (
                    <>
                      <RefreshCcw className="h-3.5 w-3.5" />
                      Reassess All
                    </>
                  )}
                </button>

                <div className="w-px h-6 bg-white/10 mx-1 self-center" />

                {/* Clear issue types */}
                <button
                  data-testid="button-clear-issue-types"
                  disabled={clearIssueMutation.isPending || bulkClassifyMutation.isPending || reassessMutation.isPending}
                  onClick={() => {
                    if (window.confirm("Delete ALL issue types and clear every ticket's issue assignment? This cannot be undone.")) {
                      clearIssueMutation.mutate();
                    }
                  }}
                  title="Delete all issue buckets and clear ticket assignments"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {clearIssueMutation.isPending ? (
                    <div className="h-3.5 w-3.5 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Clear Issue Types
                </button>

                {/* Clear solution types */}
                <button
                  data-testid="button-clear-solution-types"
                  disabled={clearSolutionMutation.isPending || bulkClassifyMutation.isPending || reassessMutation.isPending}
                  onClick={() => {
                    if (window.confirm("Delete ALL solution types and clear every ticket's solution assignment? This cannot be undone.")) {
                      clearSolutionMutation.mutate();
                    }
                  }}
                  title="Delete all solution buckets and clear ticket assignments"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                    bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {clearSolutionMutation.isPending ? (
                    <div className="h-3.5 w-3.5 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Clear Solution Types
                </button>
              </>
            )}

            {/* Loading hint */}
            {(bulkClassifyMutation.isPending || reassessMutation.isPending) && (
              <span className="text-xs text-white/40">This may take several minutes…</span>
            )}

          </div>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Tickets Closed"
            value={totalClosed}
            sub={rangeDays ? `last ${rangeDays} days` : "all time"}
            color="text-[#FF9100]"
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label="Avg Days to Close"
            value={avgDays}
            sub="mean resolution time"
            color="text-[#00BCD4]"
          />
          <StatCard
            icon={<TrendingDown className="h-5 w-5" />}
            label="Median Days to Close"
            value={medianDays}
            sub="50th percentile"
            color="text-[#4CAF50]"
          />
          <StatCard
            icon={<Tag className="h-5 w-5" />}
            label="Classified"
            value={pctClassified}
            sub="have issue or solution type"
            color="text-[#8B5CF6]"
          />
        </div>

        {/* Weekly trend */}
        {weeklyTrend.length > 1 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-4">Tickets Opened vs Closed Per Week</h2>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={weeklyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="week"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f1a3e",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.5)", paddingTop: 8 }}
                  formatter={(value) => value === "closed" ? "Closed" : "Opened"}
                />
                <Line
                  type="monotone"
                  dataKey="closed"
                  stroke={ORANGE}
                  strokeWidth={2}
                  dot={{ r: 3, fill: ORANGE }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="opened"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={{ r: 3, fill: "#38bdf8" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Issue & Solution types side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Issue Types */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-1">Issue Types</h2>
            <p className="text-xs text-white/40 mb-4">What went wrong</p>
            {issueCounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-white/30">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">No classifications yet</p>
                <p className="text-xs">Close tickets and set issue types to populate this chart</p>
              </div>
            ) : (
              <BucketBarChart
                data={issueCounts}
                colors={BAR_COLORS}
                onBarClick={handleIssueBucketClick}
              />
            )}
          </div>

          {/* Solution Types */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-1">Solution Types</h2>
            <p className="text-xs text-white/40 mb-4">How it was resolved</p>
            {solutionCounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-white/30">
                <AlertCircle className="h-8 w-8" />
                <p className="text-sm">No classifications yet</p>
                <p className="text-xs">Close tickets and set solution types to populate this chart</p>
              </div>
            ) : (
              <BucketBarChart
                data={solutionCounts}
                colors={BAR_COLORS.slice(3).concat(BAR_COLORS.slice(0, 3))}
                onBarClick={handleSolutionBucketClick}
              />
            )}
          </div>
        </div>

        {/* Closed by Assignee */}
        {assigneeCounts.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-1">Closed by Assignee</h2>
            <p className="text-xs text-white/40 mb-4">Tickets resolved per person</p>
            <ResponsiveContainer width="100%" height={Math.max(160, assigneeCounts.length * 36)}>
              <BarChart
                data={assigneeCounts}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 8, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={120}
                  tick={{ fill: "rgba(255,255,255,0.70)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#0f1a3e",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [v, "tickets"]}
                />
                <Bar dataKey="count" fill={TEAL} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}


        {/* Created by Person */}
        {createdByPerson.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-sm font-semibold text-white/80 mb-1">Tickets Created by Person</h2>
            <p className="text-xs text-white/40 mb-4">Number of tickets submitted per ISR team member</p>
            <div>
              {(["active"] as const).map(() => {
                const key = rangeDays === 7 ? "count7d" : rangeDays === 30 ? "count30d" : "countAll";
                const period = key;
                const label = rangeDays === 7 ? "Last 7 Days" : rangeDays === 30 ? "Last 30 Days" : rangeDays === 90 ? "Last 90 Days (All Time)" : "All Time";
                const sorted = [...createdByPerson]
                  .filter(r => r[key] > 0)
                  .sort((a, b) => b[key] - a[key]);
                const TOP = 9;
                const top = sorted.slice(0, TOP);
                const otherSum = sorted.slice(TOP).reduce((s, d) => s + d[key], 0);
                const rows: { name: string; value: number; isOther?: boolean }[] = [
                  ...top.map(d => ({ name: d.name, value: d[key] })),
                  ...(otherSum > 0 ? [{ name: "Other", value: otherSum, isOther: true }] : []),
                ];
                const max = rows.length ? Math.max(...rows.map(d => d.value), 1) : 1;
                return (
                  <div key={period}>
                    <p className="text-xs font-semibold text-white/50 uppercase tracking-wide mb-3">{label}</p>
                    {rows.length === 0 ? (
                      <p className="text-xs text-white/30 italic">No data</p>
                    ) : (
                      <div className="space-y-2.5">
                        {rows.map((d, i) => (
                          <div key={d.name}>
                            <div className="flex items-center justify-between mb-1 gap-2">
                              <span className={`text-xs font-medium truncate ${d.isOther ? "text-white/40 italic" : "text-white/70"}`}>{d.name}</span>
                              <span className="text-xs font-bold shrink-0" style={{ color: d.isOther ? "rgba(255,255,255,0.3)" : BAR_COLORS[i % BAR_COLORS.length] }}>{d.value}</span>
                            </div>
                            <div className="w-full bg-white/8 rounded-full h-2">
                              <div
                                className="h-2 rounded-full transition-all duration-500"
                                style={{ width: `${(d.value / max) * 100}%`, background: d.isOther ? "rgba(255,255,255,0.15)" : BAR_COLORS[i % BAR_COLORS.length] }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {totalClosed === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-white/30">
            <CheckCircle2 className="h-12 w-12" />
            <p className="text-lg font-medium">No closed tickets in this range</p>
            <p className="text-sm">Try a wider date range or close some tickets first</p>
          </div>
        )}

        {/* ── Tickets by Region ── */}
        {byRegion.length > 0 && (
          <div className="rounded-xl p-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-orange-400" />
                <h2 className="text-base font-semibold text-white">Tickets by Region</h2>
              </div>
              {isRegionAdmin && (
                <button
                  onClick={() => { setRegionConfigOpen(true); startNew(); }}
                  className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors px-2 py-1 rounded hover:bg-white/8"
                  title="Configure region groups"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Configure
                </button>
              )}
            </div>
            <p className="text-xs text-white/40 mb-5">All-time ticket count and average close time per region</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-white/40 uppercase tracking-wide border-b border-white/8">
                    <th className="pb-2 pr-4">Region</th>
                    <th className="pb-2 pr-4 text-right">Total</th>
                    <th className="pb-2 pr-4 text-right">Open</th>
                    <th className="pb-2 pr-4 text-right">Closed</th>
                    <th className="pb-2 text-right">Avg. Close Time</th>
                  </tr>
                </thead>
                <tbody>
                  {byRegion.map((row, i) => {
                    const code = row.region.includes("-") ? row.region.split("-").slice(1).join("-") : row.region;
                    const avgDisplay = (() => {
                      if (row.avgHoursClosed === null) return "—";
                      if (row.avgHoursClosed < 24) return `${row.avgHoursClosed}h`;
                      return `${(row.avgHoursClosed / 24).toFixed(1)}d`;
                    })();
                    const pct = byRegion[0].ticketCount > 0 ? (row.ticketCount / byRegion[0].ticketCount) * 100 : 0;
                    return (
                      <tr key={row.region} className="border-b border-white/5 last:border-0">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium">{code}</span>
                            <span className="text-white/30 text-xs">{row.region.split("-")[0]}</span>
                          </div>
                          <div className="mt-1.5 w-full max-w-[200px] h-1.5 bg-white/8 rounded-full overflow-hidden">
                            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right font-bold text-white">{row.ticketCount}</td>
                        <td className="py-3 pr-4 text-right text-emerald-400">{row.openCount}</td>
                        <td className="py-3 pr-4 text-right text-white/50">{row.closedCount}</td>
                        <td className="py-3 text-right">
                          <span className="font-semibold" style={{ color: BAR_COLORS[i % BAR_COLORS.length] }}>{avgDisplay}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── Region Config Dialog (admin only) ── */}
      <Dialog open={regionConfigOpen} onOpenChange={open => { setRegionConfigOpen(open); if (!open) { setEditingGroup(null); setGroupName(""); setGroupRegions([]); } }}>
        <DialogContent className="max-w-lg" style={{ background: "#0e1a3a", border: "1px solid rgba(255,255,255,0.12)", color: "white" }}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-orange-400" />
              Configure Region Groups
            </DialogTitle>
          </DialogHeader>

          {/* Existing groups */}
          {regionGroupsData.length > 0 && (
            <div className="space-y-2 mb-4">
              <p className="text-xs text-white/40 uppercase tracking-wide font-semibold">Existing Groups</p>
              {regionGroupsData.map(g => (
                <div key={g.id} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.06)" }}>
                  <div>
                    <p className="text-sm font-semibold text-white">{g.displayName}</p>
                    <p className="text-xs text-white/40 mt-0.5">{g.regions.join(", ")}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => startEdit(g)} className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteGroupMut.mutate(g.id)} className="p-1.5 rounded hover:bg-red-500/20 text-white/50 hover:text-red-400 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add / Edit form */}
          <div className="rounded-lg p-4 space-y-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <p className="text-xs text-white/40 uppercase tracking-wide font-semibold">
              {editingGroup ? "Edit Group" : "New Group"}
            </p>
            <div>
              <label className="text-xs text-white/60 mb-1.5 block">Display Name</label>
              <Input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="e.g. Chicago Metro"
                style={{ background: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.15)", color: "white" }}
                className="text-sm placeholder:text-white/30"
              />
            </div>
            <div>
              <label className="text-xs text-white/60 mb-2 block">Include Regions</label>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 max-h-52 overflow-y-auto">
                {rawRegions.map(r => {
                  const code = r.includes("-") ? r.split("-").slice(1).join("-") : r;
                  return (
                    <label key={r} className="flex items-center gap-2 cursor-pointer group">
                      <Checkbox
                        checked={groupRegions.includes(r)}
                        onCheckedChange={() => toggleRegion(r)}
                        className="border-white/30 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                      />
                      <span className="text-sm text-white/70 group-hover:text-white transition-colors">
                        {code} <span className="text-white/30 text-xs">{r.split("-")[0]}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                onClick={saveGroup}
                disabled={!groupName.trim() || groupRegions.length === 0 || createGroupMut.isPending || updateGroupMut.isPending}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {editingGroup ? "Save Changes" : "Add Group"}
              </Button>
              {editingGroup && (
                <Button variant="ghost" onClick={() => { setEditingGroup(null); setGroupName(""); setGroupRegions([]); }} className="text-white/50 hover:text-white text-sm">
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
