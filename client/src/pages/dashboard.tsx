import { useState, useMemo, useEffect, useRef } from "react";
import { Ticket, type IssueBucket, type SolutionBucket, type RoleConfig, type RolePermissions, DEFAULT_ROLE_CONFIG, ROLE_KEYS, BUILTIN_ROLES } from "@shared/schema";
import { useTickets, useSyncTickets } from "@/hooks/use-tickets";
import { TicketTable } from "@/components/ticket-table";
import { MobileTicketList } from "@/components/mobile-ticket-list";
import { AnalyticsDashboard, type GroupMode } from "@/components/analytics-dashboard";
import { DevChangesDialog } from "@/components/dev-changes-dialog";
import { CheckInDialog } from "@/components/check-in-dialog";
import { Button } from "@/components/ui/button";
import { Link, useSearch } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Plus, 
  RefreshCw,
  LogOut,
  Filter,
  Save,
  Bookmark,
  Globe,
  User,
  Trash2,
  ChevronDown,
  BarChart3,
  Loader2,
  ClipboardList,
  Activity,
  X,
  Check,
  CalendarClock,
  Mail,
  MapPin,
  Star,
  Users,
  Smartphone,
  Monitor,
  Shield,
  Sparkles,
  Search,
  Tag,
  ChevronRight,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TicketForm } from "@/components/ticket-form";
import { Skeleton } from "@/components/ui/skeleton";
import { FormicMark } from "@/components/formic-logo";
import { useAuth } from "@/hooks/use-auth";
import { useViews, useCreateView, useUpdateView, useDeleteView, useSetDefaultView } from "@/hooks/use-views";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { EmailComposeDialog } from "@/components/email-compose-dialog";
import { ContactDedupDialog } from "@/components/contact-dedup-dialog";

function AdvancedFilterColumn({
  label,
  options,
  selectedValues,
  onToggle,
  onClear,
  topOptions,
}: {
  label: string;
  options: { value: string; label: string; searchText?: string }[];
  selectedValues: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
  topOptions?: { value: string; label: string }[];
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter(o =>
    (o.searchText ?? o.label).toLowerCase().includes(search.toLowerCase())
  );
  const active = selectedValues.size > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
        {active && (
          <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
            Clear ({selectedValues.size})
          </button>
        )}
      </div>
      {topOptions && topOptions.length > 0 && (
        <div className="flex gap-1 flex-wrap pb-1 border-b border-border/40">
          {topOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onToggle(opt.value)}
              className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                selectedValues.has(opt.value)
                  ? "bg-[#FF9100] text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {options.length > 6 && (
        <Input
          placeholder="Search..."
          className="h-7 text-xs"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}
      <div className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
        {filtered.map(opt => (
          <button
            key={opt.value}
            onClick={() => onToggle(opt.value)}
            className="w-full flex items-center gap-2 px-1.5 py-1 rounded hover:bg-accent text-xs text-left"
          >
            <div className={`h-3.5 w-3.5 rounded border flex-shrink-0 flex items-center justify-center
              ${selectedValues.has(opt.value) ? "bg-primary border-primary" : "border-input"}`}>
              {selectedValues.has(opt.value) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
            </div>
            <span className="truncate">{opt.label}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">No options</p>
        )}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  options,
  selectedValues,
  onToggle,
  onClear,
}: {
  label: string;
  options: { value: string; label: string }[];
  selectedValues: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const active = selectedValues.size > 0;
  const filtered = options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()));

  const displayLabel = active
    ? selectedValues.size === 1
      ? (options.find(o => o.value === [...selectedValues][0])?.label ?? [...selectedValues][0].replace(/__unassigned__/, "Unassigned"))
      : `${label} (${selectedValues.size})`
    : label;

  return (
    <Popover onOpenChange={(open) => { if (!open) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button
          data-testid={`filter-pill-${label.toLowerCase()}`}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors
            ${active
              ? "bg-[#FF9100]/10 border-[#FF9100]/40 text-[#FF9100]"
              : "bg-transparent border-white/15 text-white/70 hover:border-white/30 hover:text-white/90"}`}
        >
          <span className="whitespace-nowrap">{displayLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-68 p-3" align="start">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Filter by {label}</p>
          {active && (
            <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        <Input
          placeholder="Search..."
          className="h-8 text-sm mb-2"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {filtered.map(opt => (
            <button
              key={opt.value}
              onClick={() => onToggle(opt.value)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-sm text-left"
            >
              <div className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center
                ${selectedValues.has(opt.value) ? "bg-primary border-primary" : "border-input"}`}>
                {selectedValues.has(opt.value) && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
              <span className="truncate">{opt.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-2">No options</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function Dashboard({ autoOpenCheckIn = false }: { autoOpenCheckIn?: boolean } = {}) {
  const { data: tickets, isLoading, error } = useTickets();
  const syncMutation = useSyncTickets();
  const mountSyncDoneRef = useRef(false);

  const [lastSyncLabel, setLastSyncLabel] = useState<string>("");
  const computeSyncLabel = () => {
    const lastSync = parseInt(localStorage.getItem("lastAutoSync") || "0", 10);
    if (!lastSync) return "";
    const diffMs = Date.now() - lastSync;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };
  useEffect(() => {
    setLastSyncLabel(computeSyncLabel());
    const interval = setInterval(() => setLastSyncLabel(computeSyncLabel()), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (syncMutation.isSuccess) setLastSyncLabel("just now");
  }, [syncMutation.isSuccess]);
  const search = useSearch();
  const [dashboardEditingTicket, setDashboardEditingTicket] = useState<Ticket | null>(null);
  const [mobileView, setMobileView] = useState<boolean>(() => {
    try { return localStorage.getItem("isr-mobile-view") === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem("isr-mobile-view", mobileView ? "true" : "false"); } catch {}
  }, [mobileView]);

  useEffect(() => {
    const params = new URLSearchParams(search);

    // Handle ?issueBucket= and ?solutionBucket= from Insights page clicks
    const issueBucketParam = params.get("issueBucket");
    const solutionBucketParam = params.get("solutionBucket");
    if (issueBucketParam || solutionBucketParam) {
      // Clear ALL other filters first so only the bucket filter + closed status apply
      setPriorityFilter(new Set());
      setAssigneeFilter(new Set());
      setCustomerFilter(new Set());
      setEscalationLevelFilter(new Set());
      setSystemIdFilter(new Set());
      setEscalationSourceFilter(new Set());
      setRegionFilter(new Set());
      setCommsDirectionFilter(new Set());
      setNextUpdateFilter(null);
      setDateFilterDays(null);
      setFilterNoNextUpdate(false);
      setSubmittedFrom("");
      setSubmittedTo("");
      setNextUpdateFrom("");
      setNextUpdateTo("");
      setIsrSearch("");
      setTitleSearch("");
      setColFilters({ customer: [], priority: [], assignee: [] });
      setIssueBucketFilter(issueBucketParam ? new Set([Number(issueBucketParam)]) : new Set());
      setSolutionBucketFilter(solutionBucketParam ? new Set([Number(solutionBucketParam)]) : new Set());
      setStatusFilter(new Set(["closed"]));
      const clean = new URLSearchParams(search);
      clean.delete("issueBucket");
      clean.delete("solutionBucket");
      const newSearch = clean.toString();
      window.history.replaceState({}, "", newSearch ? `/?${newSearch}` : "/");
      return;
    }

    if (!tickets) return;
    const ticketId = params.get("ticket");
    if (ticketId) {
      const found = tickets.find(t => String(t.id) === ticketId);
      if (found) {
        setDashboardEditingTicket(found);
        // Remove the ?ticket= param immediately so closing the dialog
        // doesn't re-open it on the next render cycle.
        const clean = new URLSearchParams(search);
        clean.delete("ticket");
        const newSearch = clean.toString();
        window.history.replaceState({}, "", newSearch ? `/?${newSearch}` : "/");
      }
    }
  }, [tickets, search]);

  useEffect(() => {
    if (!mountSyncDoneRef.current) {
      mountSyncDoneRef.current = true;
      const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
      const lastSync = parseInt(localStorage.getItem("lastAutoSync") || "0", 10);
      if (Date.now() - lastSync > SYNC_COOLDOWN_MS) {
        localStorage.setItem("lastAutoSync", String(Date.now()));
        syncMutation.mutate();
      }
    }
  }, []);

  const { user, isAdmin, canViewDailyReview } = useAuth();
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<"users" | "configure">("users");

  const { data: adminUsers = [] } = useQuery<Array<{ userId: string; email: string; name: string; role: string }>>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin && adminOpen,
  });

  const { data: roleConfigs = [] } = useQuery<RoleConfig[]>({
    queryKey: ["/api/admin/role-config"],
    enabled: isAdmin && adminOpen,
  });

  // Local editable state for role configure tab
  const [roleEdits, setRoleEdits] = useState<Record<string, { displayName: string; permissions: RolePermissions; hierarchyOrder: number }>>({});

  // Seed edits whenever role configs are fetched
  useEffect(() => {
    if (roleConfigs.length === 0) return;
    const seed: typeof roleEdits = {};
    roleConfigs.forEach((rc, idx) => {
      seed[rc.role] = {
        displayName: rc.displayName,
        permissions: { ...rc.permissions },
        hierarchyOrder: rc.hierarchyOrder ?? idx,
      };
    });
    // Fill any built-in role not yet in DB
    ROLE_KEYS.forEach((key, idx) => {
      if (!seed[key]) {
        seed[key] = {
          displayName: DEFAULT_ROLE_CONFIG[key].displayName,
          permissions: { ...DEFAULT_ROLE_CONFIG[key].permissions },
          hierarchyOrder: DEFAULT_ROLE_CONFIG[key].hierarchyOrder,
        };
      }
    });
    setRoleEdits(seed);
  }, [roleConfigs]);

  const updateRoleConfigMutation = useMutation({
    mutationFn: ({ role, displayName, permissions, hierarchyOrder }: { role: string; displayName: string; permissions: RolePermissions; hierarchyOrder?: number }) =>
      apiRequest("PATCH", `/api/admin/role-config/${role}`, { displayName, permissions, hierarchyOrder }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-config"] });
    },
  });

  const createRoleConfigMutation = useMutation({
    mutationFn: ({ role, displayName, permissions, hierarchyOrder }: { role: string; displayName: string; permissions: RolePermissions; hierarchyOrder: number }) =>
      apiRequest("POST", `/api/admin/role-config`, { role, displayName, permissions, hierarchyOrder }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-config"] });
    },
  });

  const deleteRoleConfigMutation = useMutation({
    mutationFn: ({ role }: { role: string }) =>
      apiRequest("DELETE", `/api/admin/role-config/${role}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/role-config"] });
    },
  });

  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  const setRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });
  const { data: savedViews } = useViews();
  const createViewMutation = useCreateView();
  const updateViewMutation = useUpdateView();
  const deleteViewMutation = useDeleteView();
  const setDefaultViewMutation = useSetDefaultView();
  const { toast } = useToast();

  const { data: bucketsData } = useQuery<{ issueBuckets: IssueBucket[]; solutionBuckets: SolutionBucket[] }>({
    queryKey: ["/api/buckets"],
    staleTime: 60_000,
  });

  const defaultViewAppliedRef = useRef(false);
  const fromInsightsRef = useRef(
    !!(new URLSearchParams(window.location.search).get("issueBucket") ||
       new URLSearchParams(window.location.search).get("solutionBucket"))
  );
  useEffect(() => {
    if (defaultViewAppliedRef.current) return;
    if (fromInsightsRef.current) return; // came from Insights — don't overwrite bucket filter
    if (!user || !savedViews) return;
    const defaultViewId = (user as any).defaultViewId;
    if (!defaultViewId) return;
    const view = savedViews.find(v => v.id === defaultViewId);
    if (!view) return;
    defaultViewAppliedRef.current = true;
    applyView(view);
  }, [user, savedViews]);
  const [createOpen, setCreateOpen] = useState(() =>
    new URLSearchParams(window.location.search).get("new") === "true"
  );
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [newViewGlobal, setNewViewGlobal] = useState(false);
  const [activeViewId, setActiveViewId] = useState<number | string | null>(null);
  const [tableFilteredCount, setTableFilteredCount] = useState<number | null>(null);
  const [tableKey, setTableKey] = useState(0);
  const [colFilters, setColFilters] = useState({ customer: [] as string[], priority: [] as string[], assignee: [] as string[] });
  const resetColumnFilters = () => { setColFilters({ customer: [], priority: [], assignee: [] }); setTableKey(k => k + 1); };

  const defaultStatuses = new Set(["open"]);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(defaultStatuses));
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set());
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set());
  const [customerFilter, setCustomerFilter] = useState<Set<string>>(new Set());
  const [isrSearch, setIsrSearch] = useState("");
  const [dateFilterDays, setDateFilterDays] = useState<number | null>(null);
  const [nextUpdateFilter, setNextUpdateFilter] = useState<"overdue" | "today" | "soon" | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!advancedOpen) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (filterToggleRef.current?.contains(target)) return; // let the toggle button handle itself
      if (filterPanelRef.current && !filterPanelRef.current.contains(target)) {
        setAdvancedOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [advancedOpen]);
  const [systemIdFilter, setSystemIdFilter] = useState<Set<string>>(new Set());
  const [escalationSourceFilter, setEscalationSourceFilter] = useState<Set<string>>(new Set());
  const [regionFilter, setRegionFilter] = useState<Set<string>>(new Set());
  const [commsDirectionFilter, setCommsDirectionFilter] = useState<Set<string>>(new Set());
  const [titleSearch, setTitleSearch] = useState("");
  const [submittedFrom, setSubmittedFrom] = useState("");
  const [submittedTo, setSubmittedTo] = useState("");
  const [nextUpdateFrom, setNextUpdateFrom] = useState("");
  const [nextUpdateTo, setNextUpdateTo] = useState("");
  const [filterNoNextUpdate, setFilterNoNextUpdate] = useState(false);
  const [smartSearchQuery, setSmartSearchQuery] = useState("");
  const [smartSearchLoading, setSmartSearchLoading] = useState(false);
  const [aiFilterExplanation, setAiFilterExplanation] = useState<string | null>(null);
  const [lastAiResult, setLastAiResult] = useState<{ query: string; filters: any } | null>(null);
  const zeroResultLoggedRef = useRef(false);
  const [escalationLevelFilter, setEscalationLevelFilter] = useState<Set<string>>(new Set());
  const [issueBucketFilter, setIssueBucketFilter] = useState<Set<number>>(new Set());
  const [solutionBucketFilter, setSolutionBucketFilter] = useState<Set<number>>(new Set());
  const [bucketsOpen, setBucketsOpen] = useState(false);

  const shortenPriority = (label: string): string => {
    const parts = label.split(":");
    if (parts.length >= 2) {
      return parts.slice(0, 2).map(s => s.trim()).join(": ");
    }
    return label;
  };

  function getPriorityRank(priorityLabel: string | null): number {
    if (!priorityLabel) return 99;
    const match = priorityLabel.match(/P(\d+)/i);
    if (!match) return 99;
    const level = parseInt(match[1]);
    const subMatch = priorityLabel.match(/P\d+-(\d+)/i);
    const sub = subMatch ? parseInt(subMatch[1]) : 0;
    return level * 10 + sub;
  }

  const statusOptions = [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
  ];

  const priorityOptions = useMemo(() => {
    if (!tickets) return [];
    const labels = new Set<string>();
    tickets.forEach(t => { if (t.priorityLabel) labels.add(t.priorityLabel); });
    return Array.from(labels).sort((a, b) => {
      const aPrefix = a.match(/^([^:]+):/)?.[1].trim() ?? "";
      const bPrefix = b.match(/^([^:]+):/)?.[1].trim() ?? "";
      const aIsFO = aPrefix === "FO";
      const bIsFO = bPrefix === "FO";
      if (aIsFO && !bIsFO) return -1;
      if (!aIsFO && bIsFO) return 1;
      const aPLevel = parseInt(a.match(/P(\d+)/i)?.[1] ?? "99");
      const bPLevel = parseInt(b.match(/P(\d+)/i)?.[1] ?? "99");
      if (aPLevel !== bPLevel) return aPLevel - bPLevel;
      return a.localeCompare(b);
    }).map(p => ({ value: p, label: p }));
  }, [tickets]);

  const assigneeOptions = useMemo(() => {
    if (!tickets) return [];
    const names = new Set<string>();
    tickets.forEach(t => {
      if (t.assigneeName) names.add(t.assigneeName);
    });
    return [
      { value: "__unassigned__", label: "Unassigned" },
      ...Array.from(names).sort().map(n => ({ value: n, label: n })),
    ];
  }, [tickets]);

  const customerOptions = useMemo(() => {
    if (!tickets) return [];
    const names = new Set<string>();
    tickets.forEach(t => {
      if (t.customerName) names.add(t.customerName);
    });
    return Array.from(names).sort().map(n => ({ value: n, label: n }));
  }, [tickets]);

  const systemIdOptions = useMemo(() => {
    if (!tickets) return [];
    const ids = new Set<string>();
    tickets.forEach(t => { if (t.systemId) ids.add(t.systemId); });
    return Array.from(ids).sort().map(v => ({ value: v, label: v }));
  }, [tickets]);

  const escalationSourceOptions = useMemo(() => {
    if (!tickets) return [];
    const srcs = new Set<string>();
    tickets.forEach(t => { if (t.escalationSource) srcs.add(t.escalationSource); });
    return Array.from(srcs).sort().map(v => ({ value: v, label: v }));
  }, [tickets]);

  const regionOptions = useMemo(() => {
    if (!tickets) return [];
    const regions = new Set<string>();
    tickets.forEach(t => { if (t.region) regions.add(t.region); });
    return Array.from(regions).sort().map(v => ({ value: v, label: v }));
  }, [tickets]);

  const commsDirectionOptions = useMemo(() => {
    if (!tickets) return [];
    const dirs = new Set<string>();
    tickets.forEach(t => { if (t.commsDirection) dirs.add(t.commsDirection); });
    return Array.from(dirs).sort().map(v => ({ value: v, label: v }));
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    if (!tickets) return [];
    const result = tickets.filter(t => {
      // When a text search is active, bypass all view/panel filters and search globally
      if (isrSearch.trim()) {
        const search = isrSearch.trim().toLowerCase();
        const ticketNum = (t.ticketNumber || "").toLowerCase();
        // Only extract digits for numeric-looking searches (pure number or ISR-#### format)
        // Avoid "all p1 and p2 tickets" → "12" matching ISR-12xx
        const looksLikeTicketNumber = /^(isr[\s-]*)?\d+$/i.test(search.trim());
        if (looksLikeTicketNumber) {
          const numOnly = search.replace(/[^0-9]/g, "");
          if (numOnly && ticketNum.includes(numOnly)) return true;
        }
        if (ticketNum.includes(search)) return true;
        if ((t.customerName || "").toLowerCase().includes(search)) return true;
        if ((t.systemId || "").toLowerCase().includes(search)) return true;
        if ((t.title || "").toLowerCase().includes(search)) return true;
        if ((t.assigneeName || "").toLowerCase().includes(search)) return true;
        if ((t.tags ?? []).some((tag: string) => tag.toLowerCase().includes(search))) return true;
        return false;
      }

      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;

      // Priority and escalation level use OR logic when both are set simultaneously
      // (e.g. "P1, P2, or any escalated" shows tickets matching EITHER condition)
      if (priorityFilter.size > 0 || escalationLevelFilter.size > 0) {
        const shortLabel = t.priorityLabel ? shortenPriority(t.priorityLabel) : "";
        const pLevelNum = t.priorityLabel?.match(/\bP(\d+)\b/i)?.[1];
        const priorityMatch = priorityFilter.size === 0 || [...priorityFilter].some(f => {
          if (/^P\d+$/i.test(f)) return pLevelNum === f.replace(/^P/i, "");
          if (t.priorityLabel === f) return true;
          if (shortLabel === f) return true;
          // Prefix match: "AT" matches "AT: P1: Down", "FO" matches "FO: P2: ..." etc.
          if (/^[A-Z]{1,4}$/i.test(f) && t.priorityLabel &&
              t.priorityLabel.toUpperCase().startsWith(f.toUpperCase() + ":")) return true;
          return false;
        });
        const escalationMatch = escalationLevelFilter.size === 0 ||
          escalationLevelFilter.has(t.escalationLevel || "Standard");

        if (priorityFilter.size > 0 && escalationLevelFilter.size > 0) {
          // Both filters active → OR logic: show ticket if it matches either
          if (!priorityMatch && !escalationMatch) return false;
        } else {
          // Only one filter active → AND logic (must satisfy the active filter)
          if (!priorityMatch || !escalationMatch) return false;
        }
      }

      if (assigneeFilter.size > 0) {
        if (assigneeFilter.has("__unassigned__") && !t.assigneeName) return true;
        const tNameNorm = (t.assigneeName || "").toLowerCase().trim();
        const filterHasUnassigned = assigneeFilter.has("__unassigned__");
        const assigneeMatches = tNameNorm && [...assigneeFilter].some(f => f.toLowerCase().trim() === tNameNorm);
        if (!tNameNorm) {
          if (!filterHasUnassigned) return false;
        } else if (!assigneeMatches) {
          return false;
        }
      }

      if (customerFilter.size > 0) {
        if (!t.customerName || !customerFilter.has(t.customerName)) return false;
      }

      if (dateFilterDays !== null) {
        if (t.status === "open") {
          // Always include open tickets
        } else {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - dateFilterDays);
          // Use resolvedAt for closed tickets (no updatedAt fallback — syncs refresh updatedAt constantly)
          const ticketDate = t.resolvedAt;
          if (!ticketDate || new Date(ticketDate) < cutoff) return false;
        }
      }

      if (nextUpdateFilter !== null) {
        if (!t.estimatedNextUpdate) return false;
        const updateDate = new Date(t.estimatedNextUpdate);
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
        const soonEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (nextUpdateFilter === "overdue" && updateDate >= todayStart) return false;
        if (nextUpdateFilter === "today" && (updateDate < todayStart || updateDate > todayEnd)) return false;
        if (nextUpdateFilter === "soon" && updateDate > soonEnd) return false;
      }

      if (systemIdFilter.size > 0 && !systemIdFilter.has(t.systemId || "")) return false;
      if (escalationSourceFilter.size > 0 && !escalationSourceFilter.has(t.escalationSource || "")) return false;
      if (regionFilter.size > 0 && !regionFilter.has(t.region || "")) return false;
      if (commsDirectionFilter.size > 0 && !commsDirectionFilter.has(t.commsDirection || "")) return false;

      if (titleSearch.trim()) {
        if (!(t.title || "").toLowerCase().includes(titleSearch.trim().toLowerCase())) return false;
      }

      if (submittedFrom) {
        const from = new Date(submittedFrom);
        const ticketDate = t.submittedAt ? new Date(t.submittedAt) : null;
        if (!ticketDate || ticketDate < from) return false;
      }
      if (submittedTo) {
        const to = new Date(submittedTo);
        to.setHours(23, 59, 59, 999);
        const ticketDate = t.submittedAt ? new Date(t.submittedAt) : null;
        if (!ticketDate || ticketDate > to) return false;
      }

      if (filterNoNextUpdate && t.estimatedNextUpdate) return false;

      if (issueBucketFilter.size > 0 && !issueBucketFilter.has(t.issueBucketId ?? -1)) return false;
      if (solutionBucketFilter.size > 0 && !solutionBucketFilter.has(t.solutionBucketId ?? -1)) return false;

      if (nextUpdateFrom) {
        const from = new Date(nextUpdateFrom);
        const updateDate = t.estimatedNextUpdate ? new Date(t.estimatedNextUpdate) : null;
        if (!updateDate || updateDate < from) return false;
      }
      if (nextUpdateTo) {
        const to = new Date(nextUpdateTo);
        to.setHours(23, 59, 59, 999);
        const updateDate = t.estimatedNextUpdate ? new Date(t.estimatedNextUpdate) : null;
        if (!updateDate || updateDate > to) return false;
      }

      return true;
    }).sort((a, b) => {
      const priorityDiff = getPriorityRank(a.priorityLabel) - getPriorityRank(b.priorityLabel);
      if (priorityDiff !== 0) return priorityDiff;
      const aTime = new Date(a.submittedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.submittedAt || b.createdAt || 0).getTime();
      return aTime - bTime;
    });
    return result;
  }, [tickets, statusFilter, priorityFilter, assigneeFilter, customerFilter, isrSearch, dateFilterDays, nextUpdateFilter, systemIdFilter, escalationSourceFilter, escalationLevelFilter, regionFilter, commsDirectionFilter, titleSearch, submittedFrom, submittedTo, nextUpdateFrom, nextUpdateTo, filterNoNextUpdate, issueBucketFilter, solutionBucketFilter]);

  // Detect zero-result AI searches and log them for self-correction
  useEffect(() => {
    if (smartSearchLoading) return;
    if (!aiFilterExplanation || !lastAiResult) return;
    if (filteredTickets.length > 0) {
      zeroResultLoggedRef.current = false; // reset when results appear
      return;
    }
    if (zeroResultLoggedRef.current) return;
    zeroResultLoggedRef.current = true;
    const timer = setTimeout(() => {
      fetch("/api/ai/smart-search/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          query: lastAiResult.query,
          aiFilters: lastAiResult.filters,
          explanation: aiFilterExplanation,
        }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [filteredTickets.length, aiFilterExplanation, lastAiResult, smartSearchLoading]);

  const hasActiveFilters = statusFilter.size !== defaultStatuses.size ||
    ![...statusFilter].every(s => defaultStatuses.has(s)) ||
    priorityFilter.size > 0 ||
    assigneeFilter.size > 0 ||
    customerFilter.size > 0 ||
    colFilters.customer.length > 0 ||
    colFilters.priority.length > 0 ||
    colFilters.assignee.length > 0 ||
    isrSearch.trim() !== "" ||
    dateFilterDays !== null ||
    nextUpdateFilter !== null ||
    systemIdFilter.size > 0 ||
    escalationSourceFilter.size > 0 ||
    escalationLevelFilter.size > 0 ||
    regionFilter.size > 0 ||
    commsDirectionFilter.size > 0 ||
    titleSearch.trim() !== "" ||
    submittedFrom !== "" ||
    submittedTo !== "" ||
    nextUpdateFrom !== "" ||
    nextUpdateTo !== "" ||
    filterNoNextUpdate ||
    issueBucketFilter.size > 0 ||
    solutionBucketFilter.size > 0;

  const resetAllAdvancedFilters = () => {
    setTitleSearch("");
    setSystemIdFilter(new Set());
    setEscalationSourceFilter(new Set());
    setEscalationLevelFilter(new Set());
    setRegionFilter(new Set());
    setCommsDirectionFilter(new Set());
    setNextUpdateFilter(null);
    setSubmittedFrom("");
    setSubmittedTo("");
    setNextUpdateFrom("");
    setNextUpdateTo("");
    setFilterNoNextUpdate(false);
    setDateFilterDays(null);
    setIsrSearch("");
    setSmartSearchQuery("");
    setAiFilterExplanation(null);
    setIssueBucketFilter(new Set());
    setSolutionBucketFilter(new Set());
  };

  const applyView = (view: { filters: Record<string, any>; id?: number | string }) => {
    const f = view.filters;
    setStatusFilter(f.status?.length ? new Set(f.status) : new Set());
    setPriorityFilter(f.priority?.length ? new Set(f.priority) : new Set());
    setAssigneeFilter(f.assignee?.length ? new Set(f.assignee) : new Set());
    setCustomerFilter(f.customer?.length ? new Set(f.customer) : new Set());
    // Restore advanced filters (reset any not present in the saved view)
    setRegionFilter(f.region?.length ? new Set(f.region) : new Set());
    setSystemIdFilter(f.systemId?.length ? new Set(f.systemId) : new Set());
    setEscalationSourceFilter(f.escalationSource?.length ? new Set(f.escalationSource) : new Set());
    setEscalationLevelFilter(f.escalationLevel?.length ? new Set(f.escalationLevel) : new Set());
    setCommsDirectionFilter(f.commsDirection?.length ? new Set(f.commsDirection) : new Set());
    setTitleSearch(f.titleSearch ?? "");
    setSubmittedFrom(f.submittedFrom ?? "");
    setSubmittedTo(f.submittedTo ?? "");
    setNextUpdateFrom(f.nextUpdateFrom ?? "");
    setNextUpdateTo(f.nextUpdateTo ?? "");
    setFilterNoNextUpdate(f.filterNoNextUpdate ?? false);
    setNextUpdateFilter(f.nextUpdateFilter ?? null);
    setIsrSearch(f.isrSearch ?? "");
    setDateFilterDays(f.dateFilterDays ?? null);
    setActiveViewId(view.id ?? null);
    setTableFilteredCount(null);
    const newColFilters = {
      customer: f.colCustomer ?? [],
      priority: f.colPriority ?? [],
      assignee: f.colAssignee ?? [],
    };
    setColFilters(newColFilters);
    setTableKey(k => k + 1);
  };

  const handleSmartSearch = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setIsrSearch("");
      setAiFilterExplanation(null);
      return;
    }
    const wordCount = trimmed.split(/\s+/).length;
    // Bypass simple-search fast-path if query mentions filterable attributes
    const hasFilterableTerms = /\b(p[1-4]|priority|escalat|assign|overdue|closed|open|region|customer|urgent|critical|high|low)\b/i.test(trimmed);
    if (wordCount <= 4 && !hasFilterableTerms) {
      setIsrSearch(trimmed);
      setAiFilterExplanation(null);
      return;
    }
    setSmartSearchLoading(true);
    try {
      const currentUserName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "";
      const response = await fetch("/api/ai/smart-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          query: trimmed,
          currentUserName,
          availableAssignees: assigneeOptions.filter(o => o.value !== "__unassigned__").map(o => o.value),
          availableCustomers: customerOptions.map(o => o.value),
          availablePriorities: priorityOptions.map(o => o.value),
          availableRegions: regionOptions.map(o => o.value),
          availableSystemIds: systemIdOptions.map(o => o.value),
        }),
      });
      if (!response.ok) throw new Error("AI search failed");
      const result = await response.json();
      if (result.type === "simple") {
        setIsrSearch(result.isrSearch || trimmed);
        setAiFilterExplanation(null);
      } else if (result.type === "filters" && result.filters) {
        const f = result.filters;
        setStatusFilter(f.status?.length ? new Set(f.status) : new Set(defaultStatuses));
        setPriorityFilter(f.priority?.length ? new Set(f.priority) : new Set());
        setAssigneeFilter(f.assignee?.length ? new Set(f.assignee) : new Set());
        setCustomerFilter(f.customer?.length ? new Set(f.customer) : new Set());
        setRegionFilter(f.region?.length ? new Set(f.region) : new Set());
        setSystemIdFilter(f.systemId?.length ? new Set(f.systemId) : new Set());
        setEscalationLevelFilter(f.escalationLevel?.length ? new Set(f.escalationLevel) : new Set());
        // Only apply titleSearch if explicitly set by AI (guard against leaking "escalated" etc)
        setTitleSearch(typeof f.titleSearch === "string" && f.titleSearch.trim().length > 0 && !["escalated", "open", "closed"].includes(f.titleSearch.trim().toLowerCase()) ? f.titleSearch.trim() : "");
        setIsrSearch(typeof f.isrSearch === "string" ? f.isrSearch : "");
        setDateFilterDays(typeof f.dateFilterDays === "number" ? f.dateFilterDays : null);
        setSubmittedFrom(typeof f.submittedFrom === "string" ? f.submittedFrom : "");
        setSubmittedTo(typeof f.submittedTo === "string" ? f.submittedTo : "");
        setActiveViewId(null);
        setTableFilteredCount(null);
        resetColumnFilters();
        setLastAiResult({ query: trimmed, filters: f });
        zeroResultLoggedRef.current = false;
        setAiFilterExplanation(result.explanation || null);
      }
    } catch {
      setIsrSearch(trimmed);
      toast({ title: "Smart search unavailable", description: "Falling back to text search.", variant: "destructive" });
    } finally {
      setSmartSearchLoading(false);
    }
  };

  const [emailListOpen, setEmailListOpen] = useState(false);
  const [emailListDraft, setEmailListDraft] = useState({ subject: "", body: "", html: "" });
  const [devChangesOpen, setDevChangesOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(autoOpenCheckIn);
  const [dedupOpen, setDedupOpen] = useState(false);

  const hoursOpenLabel = (t: (typeof filteredTickets)[number]): string => {
    const start = t.submittedAt || t.createdAt;
    if (!start) return "—";
    const startDate = new Date(start);
    const endDate = (t.status === "closed" && (t.resolvedAt || t.updatedAt))
      ? new Date(t.resolvedAt || t.updatedAt!)
      : new Date();
    const hours = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60));
    if (hours < 1) return "<1h";
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const rem = hours % 24;
      return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
    }
    return `${hours}h`;
  };

  const handleEmailList = () => {
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const count = filteredTickets.length;
    const subject = `ISR Ticket Report – ${count} Ticket${count !== 1 ? "s" : ""} – ${date}`;
    const slackWorkspace = "T019Y3V5LR4";

    const fmtDate = (d: Date | string | null | undefined) =>
      d ? new Date(d as string).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

    const plainRows = filteredTickets.map(t => [
      (t.ticketNumber || `#${t.id}`).padEnd(14),
      (t.title || "").slice(0, 50).padEnd(52),
      (t.customerName || "—").slice(0, 30).padEnd(32),
      (t.systemId || "—").padEnd(18),
      shortenPriority(t.priorityLabel || "").slice(0, 22).padEnd(24),
      fmtDate(t.submittedAt).padEnd(14),
      hoursOpenLabel(t).padEnd(8),
      (t.assigneeName || "—"),
    ].join("")).join("\n");

    const plainBody = [
      `ISR Ticket Report`,
      `Generated: ${date}`,
      `Total: ${count} ticket${count !== 1 ? "s" : ""}`,
      ``,
      `${"ISR #".padEnd(14)}${"Title".padEnd(52)}${"Customer".padEnd(32)}${"System ID".padEnd(18)}${"Priority".padEnd(24)}${"Submitted".padEnd(14)}${"Age".padEnd(8)}Assignee`,
      `${"-".repeat(174)}`,
      plainRows,
    ].join("\n");

    const th = `style="background:#163439;color:#fff;padding:6px 10px;text-align:left;white-space:nowrap;border:1px solid #2a4a50;font-family:Arial,sans-serif;font-size:12px;"`;
    const td = `style="padding:5px 10px;white-space:nowrap;border:1px solid #e5e7eb;vertical-align:middle;font-family:Arial,sans-serif;font-size:12px;"`;
    const linkStyle = `style="color:#FF9100;text-decoration:none;font-weight:600;"`;

    const htmlRows = filteredTickets.map((t, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f9fafb";
      const isrLink = `<a href="${window.location.origin}/?ticket=${t.id}" ${linkStyle}>${t.ticketNumber || `#${t.id}`}</a>`;
      const systemIdCell = (t.systemId && t.csChannel)
        ? `<a href="https://app.slack.com/client/${slackWorkspace}/${t.csChannel.replace(/^#/, "")}" ${linkStyle}>${t.systemId}</a>`
        : (t.systemId || "—");
      const priorityColor = t.priority === "high" ? "#dc2626" : t.priority === "low" ? "#6b7280" : "#111827";
      return `<tr style="background:${bg};">
        <td ${td}>${isrLink}</td>
        <td ${td}>${(t.title || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>
        <td ${td}>${(t.customerName || "—").replace(/&amp;/g, "&")}</td>
        <td ${td}>${systemIdCell}</td>
        <td ${td} style="padding:5px 10px;white-space:nowrap;border:1px solid #e5e7eb;vertical-align:middle;font-family:Arial,sans-serif;font-size:12px;color:${priorityColor};">${shortenPriority(t.priorityLabel || "")}</td>
        <td ${td}>${fmtDate(t.submittedAt)}</td>
        <td ${td} style="padding:5px 10px;white-space:nowrap;border:1px solid #e5e7eb;vertical-align:middle;font-family:Arial,sans-serif;font-size:12px;text-align:right;">${hoursOpenLabel(t)}</td>
        <td ${td}>${t.assigneeName || "—"}</td>
      </tr>`;
    }).join("\n");

    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:16px;">
<p style="margin:0 0 2px;font-size:16px;font-weight:bold;">ISR Ticket Report</p>
<p style="margin:0 0 2px;color:#6b7280;font-size:12px;">Generated: ${date}</p>
<p style="margin:0 0 16px;color:#6b7280;font-size:12px;">Total: ${count} ticket${count !== 1 ? "s" : ""}</p>
<table style="border-collapse:collapse;">
  <thead><tr>
    <th ${th}>ISR #</th>
    <th ${th}>Title</th>
    <th ${th}>Customer</th>
    <th ${th}>System ID</th>
    <th ${th}>Priority</th>
    <th ${th}>Submitted</th>
    <th ${th}>Age</th>
    <th ${th}>Assignee</th>
  </tr></thead>
  <tbody>
    ${htmlRows}
  </tbody>
</table>
</body></html>`;

    setEmailListDraft({ subject, body: plainBody, html });
    setEmailListOpen(true);
  };

  const clearFiltersToDefault = () => {
    setStatusFilter(new Set(defaultStatuses));
    setPriorityFilter(new Set());
    setAssigneeFilter(new Set());
    setCustomerFilter(new Set());
    resetAllAdvancedFilters();
    setActiveViewId(null);
    setTableFilteredCount(null);
    resetColumnFilters();
    setLastAiResult(null);
    setAiFilterExplanation(null);
    setSmartSearchQuery("");
    setIsrSearch("");
  };

  const buildCurrentFilters = (): Record<string, any> => {
    const filters: Record<string, any> = {};
    if (statusFilter.size > 0) filters.status = [...statusFilter];
    if (priorityFilter.size > 0) filters.priority = [...priorityFilter];
    if (assigneeFilter.size > 0) filters.assignee = [...assigneeFilter];
    if (customerFilter.size > 0) filters.customer = [...customerFilter];
    if (colFilters.customer.length > 0) filters.colCustomer = colFilters.customer;
    if (colFilters.priority.length > 0) filters.colPriority = colFilters.priority;
    if (colFilters.assignee.length > 0) filters.colAssignee = colFilters.assignee;
    if (regionFilter.size > 0) filters.region = [...regionFilter];
    if (systemIdFilter.size > 0) filters.systemId = [...systemIdFilter];
    if (escalationLevelFilter.size > 0) filters.escalationLevel = [...escalationLevelFilter];
    if (escalationSourceFilter.size > 0) filters.escalationSource = [...escalationSourceFilter];
    if (commsDirectionFilter.size > 0) filters.commsDirection = [...commsDirectionFilter];
    if (titleSearch.trim()) filters.titleSearch = titleSearch.trim();
    if (submittedFrom) filters.submittedFrom = submittedFrom;
    if (submittedTo) filters.submittedTo = submittedTo;
    if (nextUpdateFrom) filters.nextUpdateFrom = nextUpdateFrom;
    if (nextUpdateTo) filters.nextUpdateTo = nextUpdateTo;
    if (filterNoNextUpdate) filters.filterNoNextUpdate = true;
    if (nextUpdateFilter) filters.nextUpdateFilter = nextUpdateFilter;
    if (isrSearch.trim()) filters.isrSearch = isrSearch.trim();
    if (dateFilterDays !== null) filters.dateFilterDays = dateFilterDays;
    return filters;
  };

  const handleSaveView = () => {
    if (!newViewName.trim()) return;
    const name = newViewName.trim();
    const isGlobal = newViewGlobal;
    const filters = buildCurrentFilters();

    // Close dialog immediately to avoid Radix focus-return conflicts with async callbacks
    setSaveViewOpen(false);
    setNewViewName("");
    setNewViewGlobal(false);

    createViewMutation.mutate(
      { name, isGlobal, filters },
      {
        onSuccess: () => {
          toast({ title: "View saved", description: `"${name}" has been saved.` });
        },
        onError: () => {
          toast({ title: "Failed to save view", description: "Please try again.", variant: "destructive" });
        },
      }
    );
  };

  const handleResaveView = () => {
    if (!activeViewId) return;
    const activeView = savedViews?.find(v => v.id === activeViewId);
    if (!activeView) return;
    const filters = buildCurrentFilters();
    updateViewMutation.mutate(
      { id: activeViewId, data: { filters } },
      {
        onSuccess: () => {
          toast({ title: "View updated", description: `"${activeView.name}" filters have been updated.` });
        },
        onError: () => {
          toast({ title: "Failed to update view", description: "Please try again.", variant: "destructive" });
        },
      }
    );
  };

  const handleDeleteView = (id: number, name: string) => {
    deleteViewMutation.mutate(id, {
      onSuccess: () => {
        toast({ title: "View deleted", description: `"${name}" has been removed.` });
        if (activeViewId === id) setActiveViewId(null);
      },
    });
  };

  const handleAnalyticsFilter = (group: string, groupMode: GroupMode) => {
    setStatusFilter(new Set());
    setAssigneeFilter(new Set());
    setCustomerFilter(new Set());
    setIsrSearch("");
    setActiveViewId(null);
    setNextUpdateFilter(null);
    setDateFilterDays(7);

    if (groupMode === "team") {
      const matchingPriorities = (priorityOptions || [])
        .filter(p => {
          if (group === "Other") {
            const prefix = p.value.match(/^([A-Z]{2}):/);
            return !prefix;
          }
          return p.value.startsWith(`${group}:`);
        })
        .map(p => p.value);
      setPriorityFilter(new Set(matchingPriorities));
    } else if (groupMode === "priority") {
      setPriorityFilter(new Set([group]));
    } else if (groupMode === "fs") {
      const matchingPriorities = (priorityOptions || [])
        .filter(p => {
          if (!p.value.startsWith("FO:")) return false;
          const pLevel = p.value.match(/P\d+(?:-\d+)?/i);
          const extracted = pLevel ? pLevel[0] : "Other";
          return extracted === group;
        })
        .map(p => p.value);
      setPriorityFilter(new Set(matchingPriorities));
    }

    setAnalyticsOpen(false);
  };

  const handleAnalyticsAssigneeFilter = (fullName: string) => {
    setStatusFilter(new Set(["open"]));
    setPriorityFilter(new Set());
    setAssigneeFilter(new Set([fullName]));
    setCustomerFilter(new Set());
    setIsrSearch("");
    setActiveViewId(null);
    setDateFilterDays(null);
    setAnalyticsOpen(false);
  };

  const personalViews = savedViews?.filter(v => !v.isGlobal) ?? [];
  const globalViews = savedViews?.filter(v => v.isGlobal) ?? [];
  const activeView = savedViews?.find(v => v.id === activeViewId);

  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <FormicMark className="h-7 text-[#FF9100] cursor-pointer" />
            </Link>
            <div className="w-px h-6 bg-white/20"></div>
            <span className="font-semibold text-sm tracking-wide text-white/90 uppercase">ISR Tracker</span>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className={`gap-1.5 text-sm transition-colors ${mobileView ? "text-[#FF9100] hover:text-[#FF9100]/80" : "text-white/70 hover:text-white"}`}
              data-testid="button-mobile-view-toggle"
              onClick={() => setMobileView(v => !v)}
              title={mobileView ? "Switch to desktop view" : "Switch to mobile view"}
            >
              {mobileView ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
              <span className="hidden sm:inline">{mobileView ? "Desktop" : "Mobile"}</span>
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white gap-1.5 text-sm"
                data-testid="button-dedup-contacts"
                onClick={() => setDedupOpen(true)}
                title="Find and remove duplicate contacts"
              >
                <Users className="h-4 w-4" />
                <span className="hidden sm:inline">Dedup Contacts</span>
              </Button>
            )}
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white gap-1.5 text-sm"
                data-testid="button-admin-panel"
                onClick={() => setAdminOpen(true)}
                title="Admin: Manage user roles"
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            )}
            <Link href="/closed-tickets">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white gap-1.5 text-sm"
                data-testid="button-closed-tickets"
              >
                <BarChart3 className="h-4 w-4" />
                <span className="hidden sm:inline">Insights</span>
              </Button>
            </Link>
            {canViewDailyReview && (
              <Link href="/daily-review">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white gap-1.5 text-sm"
                  data-testid="button-daily-review"
                >
                  <ClipboardList className="h-4 w-4" />
                  <span className="hidden sm:inline">Daily Review</span>
                </Button>
              </Link>
            )}
            {user && (
              <span data-testid="text-user-email" className="text-white/60 text-sm hidden sm:inline">
                {user.email}
              </span>
            )}
            <Button variant="ghost" size="icon" className="text-white/60" asChild>
              <a href="/api/logout" data-testid="button-logout" title="Sign out">
                <LogOut className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Service Requests
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Track and manage internal service requests.
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <Button 
              data-testid="button-sync"
              variant="outline" 
              className="shadow-sm text-sm font-medium"
              onClick={() => {
                localStorage.setItem("lastAutoSync", String(Date.now()));
                setLastSyncLabel("just now");
                syncMutation.mutate();
              }}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending
                ? 'Syncing...'
                : <><span className="hidden sm:inline">Sync Sources</span><span className="sm:hidden">Sync</span>{lastSyncLabel && <span className="ml-1.5 text-xs font-normal opacity-60 hidden sm:inline">· {lastSyncLabel}</span>}</>
              }
            </Button>

            <Button
              data-testid="button-check-in"
              variant="outline"
              className="shadow-sm text-sm font-medium"
              onClick={() => setCheckInOpen(true)}
            >
              <MapPin className="h-4 w-4 mr-1.5" />
              Check In
            </Button>

            <Dialog open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-analytics" variant="outline" className="shadow-sm text-sm font-medium">
                  <BarChart3 className="h-4 w-4 mr-1.5" />
                  Dashboard
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Analytics Dashboard</DialogTitle>
                </DialogHeader>
                {tickets && <AnalyticsDashboard tickets={tickets} onFilterByGroup={handleAnalyticsFilter} onFilterByAssignee={handleAnalyticsAssigneeFilter} />}
              </DialogContent>
            </Dialog>

            <Button 
              variant="outline" 
              className="shadow-sm text-sm font-medium"
              data-testid="button-triage"
              asChild
            >
              <a 
                href="https://grafana.formic.co/d/afc8cor5nigowc/triage-wip?orgId=1&var-Facility=CAAP%20Co&var-SYS=CAAPCO_SYS1&var-FLX=All&var-ANT=CAAPCO_SYS1_ANT1&var-CAM=CAAPCO_SYS1_CAM2&var-FLX_st_id=61ed74c7-0770-423a-9be3-cf7c2fe9026c&var-SEVERITY=All&var-CAM_st_id=b5bbe597-0a90-459d-b010-d3d8ed9471d0&var-CAM_st_id1=59bd6e2b-b905-4484-ab28-359f10a40037&var-CAM_LINK=https:%2F%2Fd3p2ab1mzlrarw.cloudfront.net%2Fstream.m3u8%3Ftoken%3Dfdfd7cc82f00fc596497299987de2720413a32919f9853cbb63bf33726a9f7b1de59194bb0ec111f7d7e506148e704597ab4ab4f29d430413adccfdfa1008ce5&var-CAM_LINK_1=https:%2F%2Fd3p2ab1mzlrarw.cloudfront.net%2Fstream.m3u8%3Ftoken%3Dfdfd7cc82f00fc596497299987de27205e1326be4e5fd4ebde22b1696ed0e256d0866a6100a8331be2f6d4eb141ccddc6869a848ac6250e38d15b60c0a1b9c6b"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5"
              >
                <Activity className="h-4 w-4" />
                Triage
              </a>
            </Button>

            <Dialog
              open={createOpen}
              onOpenChange={(open) => {
                if (!open && isFormDirty) {
                  setConfirmCloseOpen(true);
                } else {
                  if (!open) setIsFormDirty(false);
                  setCreateOpen(open);
                }
              }}
            >
              <DialogTrigger asChild>
                <Button data-testid="button-new-ticket" className="bg-[#FF9100] text-white shadow-sm text-sm font-medium">
                  <Plus className="h-4 w-4 mr-1.5" strokeWidth={2.5} />
                  New Ticket
                </Button>
              </DialogTrigger>
              <DialogContent
                className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto overscroll-y-contain"
                onInteractOutside={(e) => {
                  if (isFormDirty) {
                    e.preventDefault();
                    setConfirmCloseOpen(true);
                  }
                }}
                onEscapeKeyDown={(e) => {
                  if (isFormDirty) {
                    e.preventDefault();
                    setConfirmCloseOpen(true);
                  }
                }}
              >
                <DialogHeader>
                  <DialogTitle>Create New Ticket</DialogTitle>
                </DialogHeader>
                <TicketForm 
                  onSuccess={() => { setIsFormDirty(false); setCreateOpen(false); }} 
                  onCancel={() => {
                    if (isFormDirty) {
                      setConfirmCloseOpen(true);
                    } else {
                      setCreateOpen(false);
                    }
                  }}
                  onDirtyChange={setIsFormDirty}
                />
              </DialogContent>
            </Dialog>

            <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Discard changes?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You have unsaved changes. If you close now, your work will be lost.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep editing</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                      setConfirmCloseOpen(false);
                      setIsFormDirty(false);
                      setCreateOpen(false);
                    }}
                  >
                    Discard
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mb-4 flex items-center gap-2 flex-wrap rounded-xl bg-card border px-3 py-2">
          {/* Filters toggle button */}
          <button
            ref={filterToggleRef}
            data-testid="button-toggle-advanced-filters"
            onClick={() => setAdvancedOpen(o => !o)}
            className={`flex items-center gap-1.5 text-sm mr-1 px-2 py-1 rounded-lg transition-colors
              ${advancedOpen ? "bg-white/10 text-white/80" : "text-white/50 hover:text-white/70 hover:bg-white/5"}`}
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="font-medium">Filters</span>
            <ChevronDown className={`h-3 w-3 opacity-60 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          </button>

          {/* Views dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="dropdown-views"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors
                  ${activeViewId
                    ? "bg-[#FF9100]/10 border-[#FF9100]/40 text-[#FF9100]"
                    : "bg-transparent border-white/15 text-white/70 hover:border-white/30 hover:text-white/90"}`}
              >
                <Bookmark className="h-3.5 w-3.5 opacity-70" />
                <span>{activeView ? activeView.name : "Views"}</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {globalViews.length > 0 && (
                <>
                  <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" /> Global
                  </DropdownMenuLabel>
                  {globalViews.map(v => (
                    <DropdownMenuItem
                      key={v.id}
                      className="flex items-center justify-between group"
                      onSelect={() => applyView(v)}
                    >
                      <span className={activeViewId === v.id ? "font-semibold text-primary" : ""}>{v.name}</span>
                      <span className="flex items-center gap-1 ml-2">
                        <button
                          title={(user as any)?.defaultViewId === v.id ? "Remove default" : "Set as default"}
                          onClick={e => { e.stopPropagation(); setDefaultViewMutation.mutate((user as any)?.defaultViewId === v.id ? null : v.id); }}
                          className={(user as any)?.defaultViewId === v.id ? "text-yellow-400" : "opacity-0 group-hover:opacity-60 text-muted-foreground hover:text-yellow-400"}
                          data-testid={`button-default-view-${v.id}`}
                        >
                          <Star className="h-3.5 w-3.5" fill={(user as any)?.defaultViewId === v.id ? "currentColor" : "none"} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteView(v.id, v.name); }}
                          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                          data-testid={`button-delete-view-${v.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {personalViews.length > 0 && (
                <>
                  {globalViews.length > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" /> Personal
                  </DropdownMenuLabel>
                  {personalViews.map(v => (
                    <DropdownMenuItem
                      key={v.id}
                      className="flex items-center justify-between group"
                      onSelect={() => applyView(v)}
                    >
                      <span className={activeViewId === v.id ? "font-semibold text-primary" : ""}>{v.name}</span>
                      <span className="flex items-center gap-1 ml-2">
                        <button
                          title={(user as any)?.defaultViewId === v.id ? "Remove default" : "Set as default"}
                          onClick={e => { e.stopPropagation(); setDefaultViewMutation.mutate((user as any)?.defaultViewId === v.id ? null : v.id); }}
                          className={(user as any)?.defaultViewId === v.id ? "text-yellow-400" : "opacity-0 group-hover:opacity-60 text-muted-foreground hover:text-yellow-400"}
                          data-testid={`button-default-view-${v.id}`}
                        >
                          <Star className="h-3.5 w-3.5" fill={(user as any)?.defaultViewId === v.id ? "currentColor" : "none"} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteView(v.id, v.name); }}
                          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                          data-testid={`button-delete-view-${v.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {(!globalViews.length && !personalViews.length && !user) && (
                <DropdownMenuItem disabled>No saved views</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {activeViewId && savedViews?.find(v => v.id === activeViewId)?.userId === (user as any)?.id && (
                <DropdownMenuItem onSelect={handleResaveView} disabled={updateViewMutation.isPending}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" />
                  Resave "{savedViews?.find(v => v.id === activeViewId)?.name}"
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setTimeout(() => setSaveViewOpen(true), 0)}>
                <Save className="h-3.5 w-3.5 mr-2" />
                Save current view…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Estimated Next Update — 3 toggle buttons */}
          <div className="flex items-center gap-1 ml-1">
            <CalendarClock className="h-3.5 w-3.5 text-white/30 flex-shrink-0" />
            <button
              data-testid="filter-next-update-overdue"
              onClick={() => setNextUpdateFilter(nextUpdateFilter === "overdue" ? null : "overdue")}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                nextUpdateFilter === "overdue"
                  ? "bg-destructive/15 border-destructive/40 text-red-400"
                  : "border-white/15 text-white/60 hover:border-white/30 hover:text-white/90"
              }`}
            >
              Overdue
            </button>
            <button
              data-testid="filter-next-update-soon"
              onClick={() => setNextUpdateFilter(nextUpdateFilter === "soon" ? null : "soon")}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                nextUpdateFilter === "soon"
                  ? "bg-[#FF9100]/10 border-[#FF9100]/40 text-[#FF9100]"
                  : "border-white/15 text-white/60 hover:border-white/30 hover:text-white/90"
              }`}
            >
              Due Soon
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Smart Search */}
          <div className="flex flex-col gap-1">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-white/35 pointer-events-none" />
              <Input
                data-testid="input-isr-search"
                placeholder="Smart search… (Enter to search)"
                className="h-8 w-64 pl-8 pr-7 text-sm bg-white/5 border-white/15 text-white placeholder:text-white/30 focus:border-white/30"
                value={smartSearchQuery}
                onChange={e => {
                  const val = e.target.value;
                  setSmartSearchQuery(val);
                  const wordCount = val.trim().split(/\s+/).filter(Boolean).length;
                  if (wordCount <= 5) {
                    setIsrSearch(val.trim());
                    setAiFilterExplanation(null);
                  }
                  if (!val.trim()) {
                    setIsrSearch("");
                    setAiFilterExplanation(null);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSmartSearch(smartSearchQuery);
                  }
                }}
              />
              {smartSearchLoading ? (
                <Loader2 className="absolute right-2 h-3.5 w-3.5 text-orange-400 animate-spin" />
              ) : smartSearchQuery ? (
                <button
                  onClick={() => {
                    setSmartSearchQuery("");
                    setIsrSearch("");
                    setAiFilterExplanation(null);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
            {aiFilterExplanation && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-400/30 text-orange-300 text-xs w-fit max-w-64">
                <Sparkles className="h-3 w-3 shrink-0" />
                <span className="truncate">{aiFilterExplanation}</span>
                <button
                  onClick={() => {
                    setAiFilterExplanation(null);
                    clearFiltersToDefault();
                  }}
                  className="ml-0.5 text-orange-300/60 hover:text-orange-200 shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Clear all */}
          {hasActiveFilters && (
            <button
              data-testid="button-clear-filters"
              onClick={clearFiltersToDefault}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-white/15 text-white/50 hover:text-white/90 hover:border-white/30 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}

          {/* Ticket count */}
          <span className="text-sm text-white/40 whitespace-nowrap pl-1">
            {(tableFilteredCount ?? filteredTickets.length)} {(tableFilteredCount ?? filteredTickets.length) === 1 ? "ticket" : "tickets"}
          </span>

          {/* Email list button */}
          <button
            data-testid="button-email-list"
            onClick={handleEmailList}
            title="Email this ticket list"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-white/50 hover:text-white/90 hover:bg-white/8 border border-white/10 hover:border-white/25 transition-colors whitespace-nowrap"
          >
            <Mail className="h-3.5 w-3.5" />
            Email list
          </button>
        </div>

        {/* Advanced filter panel */}
        {advancedOpen && (
          <div ref={filterPanelRef} className="mb-4 rounded-xl bg-card border p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
              <button
                data-testid="button-close-advanced-filters"
                onClick={() => setAdvancedOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                aria-label="Close filters"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">

              {/* ── Row 1: multi-select columns ── */}

              {/* Priority */}
              <AdvancedFilterColumn
                label="Priority"
                options={priorityOptions}
                selectedValues={priorityFilter}
                onToggle={v => { const n = new Set(priorityFilter); n.has(v) ? n.delete(v) : n.add(v); setPriorityFilter(n); setActiveViewId(null); }}
                onClear={() => { setPriorityFilter(new Set()); setActiveViewId(null); }}
                topOptions={[
                  { value: "P1", label: "P1" },
                  { value: "P2", label: "P2" },
                  { value: "P3", label: "P3" },
                  { value: "P4", label: "P4" },
                ]}
              />

              {/* Assignee */}
              <AdvancedFilterColumn
                label="Assignee"
                options={assigneeOptions}
                selectedValues={assigneeFilter}
                onToggle={v => { const n = new Set(assigneeFilter); n.has(v) ? n.delete(v) : n.add(v); setAssigneeFilter(n); setActiveViewId(null); }}
                onClear={() => { setAssigneeFilter(new Set()); setActiveViewId(null); }}
              />

              {/* Customer */}
              <AdvancedFilterColumn
                label="Customer"
                options={customerOptions}
                selectedValues={customerFilter}
                onToggle={v => { const n = new Set(customerFilter); n.has(v) ? n.delete(v) : n.add(v); setCustomerFilter(n); setActiveViewId(null); }}
                onClear={() => { setCustomerFilter(new Set()); setActiveViewId(null); }}
              />

              {/* System ID */}
              <AdvancedFilterColumn
                label="System ID"
                options={systemIdOptions}
                selectedValues={systemIdFilter}
                onToggle={v => { const n = new Set(systemIdFilter); n.has(v) ? n.delete(v) : n.add(v); setSystemIdFilter(n); }}
                onClear={() => setSystemIdFilter(new Set())}
              />

              {/* Escalation Level + Source stacked */}
              <div className="space-y-4">
                <AdvancedFilterColumn
                  label="Escalation Level"
                  options={[
                    { value: "Elevated", label: "Elevated" },
                    { value: "High", label: "High" },
                    { value: "Critical", label: "Critical" },
                    { value: "Standard", label: "Standard" },
                  ]}
                  selectedValues={escalationLevelFilter}
                  onToggle={v => { const n = new Set(escalationLevelFilter); n.has(v) ? n.delete(v) : n.add(v); setEscalationLevelFilter(n); }}
                  onClear={() => setEscalationLevelFilter(new Set())}
                />
                <AdvancedFilterColumn
                  label="Escalation Source"
                  options={escalationSourceOptions}
                  selectedValues={escalationSourceFilter}
                  onToggle={v => { const n = new Set(escalationSourceFilter); n.has(v) ? n.delete(v) : n.add(v); setEscalationSourceFilter(n); }}
                  onClear={() => setEscalationSourceFilter(new Set())}
                />
              </div>

              {/* ── Row 2: smaller / text / date filters ── */}

              {/* Region */}
              <AdvancedFilterColumn
                label="Region"
                options={regionOptions}
                selectedValues={regionFilter}
                onToggle={v => { const n = new Set(regionFilter); n.has(v) ? n.delete(v) : n.add(v); setRegionFilter(n); setActiveViewId(null); }}
                onClear={() => { setRegionFilter(new Set()); setActiveViewId(null); }}
              />

              {/* Direction + Status stacked */}
              <div className="space-y-4">
                <AdvancedFilterColumn
                  label="Direction"
                  options={commsDirectionOptions}
                  selectedValues={commsDirectionFilter}
                  onToggle={v => { const n = new Set(commsDirectionFilter); n.has(v) ? n.delete(v) : n.add(v); setCommsDirectionFilter(n); }}
                  onClear={() => setCommsDirectionFilter(new Set())}
                />
                <AdvancedFilterColumn
                  label="Status"
                  options={statusOptions}
                  selectedValues={statusFilter}
                  onToggle={v => { const n = new Set(statusFilter); n.has(v) ? n.delete(v) : n.add(v); setStatusFilter(n); setActiveViewId(null); }}
                  onClear={() => { setStatusFilter(new Set()); setActiveViewId(null); }}
                />
              </div>

              {/* Title search */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Title</p>
                <Input
                  placeholder="Search title..."
                  className="h-8 text-sm"
                  value={titleSearch}
                  onChange={e => setTitleSearch(e.target.value)}
                />
                {titleSearch && (
                  <button onClick={() => setTitleSearch("")} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear
                  </button>
                )}
              </div>

              {/* Submitted Date */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Submitted Date</p>
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={submittedFrom}
                  onChange={e => setSubmittedFrom(e.target.value)}
                />
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={submittedTo}
                  onChange={e => setSubmittedTo(e.target.value)}
                />
                {(submittedFrom || submittedTo) && (
                  <button onClick={() => { setSubmittedFrom(""); setSubmittedTo(""); }} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear
                  </button>
                )}
              </div>

              {/* Est. Next Update */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Est. Next Update</p>
                  <button
                    data-testid="toggle-filter-no-next-update"
                    onClick={() => setFilterNoNextUpdate(v => !v)}
                    title="Show only tickets with no estimated next update"
                    className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors
                      ${filterNoNextUpdate ? "bg-destructive border-destructive" : "border-input hover:border-muted-foreground"}`}
                  >
                    {filterNoNextUpdate && <X className="h-2.5 w-2.5 text-white" />}
                  </button>
                </div>
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={nextUpdateFrom}
                  onChange={e => setNextUpdateFrom(e.target.value)}
                />
                <Input
                  type="date"
                  className="h-8 text-sm"
                  value={nextUpdateTo}
                  onChange={e => setNextUpdateTo(e.target.value)}
                />
                {(nextUpdateFrom || nextUpdateTo) && (
                  <button onClick={() => { setNextUpdateFrom(""); setNextUpdateTo(""); }} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear
                  </button>
                )}
              </div>

            </div>
            {priorityFilter.size > 0 && escalationLevelFilter.size > 0 && (
              <p className="mt-3 text-xs text-amber-400/70 italic">
                Priority + Escalation Level use OR logic — tickets matching <em>either</em> condition will appear.
              </p>
            )}
          </div>
        )}

        {/* Bucket Classification Panel */}
        {bucketsData && (bucketsData.issueBuckets.length > 0 || bucketsData.solutionBuckets.length > 0) && (
          <div className="mb-4">
            <button
              data-testid="button-toggle-buckets"
              onClick={() => setBucketsOpen(o => !o)}
              className="flex items-center gap-2 text-xs text-white/50 hover:text-white/80 transition-colors mb-2"
            >
              <Tag className="h-3.5 w-3.5" />
              <span className="font-medium">Problem Classifications</span>
              <ChevronRight className={`h-3 w-3 transition-transform ${bucketsOpen ? "rotate-90" : ""}`} />
              {(issueBucketFilter.size > 0 || solutionBucketFilter.size > 0) && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#FF9100]/20 text-[#FF9100] text-[10px] font-semibold ml-1">
                  {issueBucketFilter.size + solutionBucketFilter.size} active
                </span>
              )}
            </button>
            {bucketsOpen && (
              <div className="rounded-xl border border-border/50 bg-card/80 p-4 animate-in fade-in slide-in-from-top-2 duration-150 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filter by Classification</span>
                  {(issueBucketFilter.size > 0 || solutionBucketFilter.size > 0) && (
                    <button
                      onClick={() => { setIssueBucketFilter(new Set()); setSolutionBucketFilter(new Set()); }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Issue Buckets */}
                  {bucketsData.issueBuckets.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Issue Types</p>
                      <div className="space-y-1">
                        {bucketsData.issueBuckets.map(b => {
                          const ticketCount = (tickets ?? []).filter(t => t.issueBucketId === b.id).length;
                          const isActive = issueBucketFilter.has(b.id);
                          const maxCount = Math.max(...bucketsData.issueBuckets.map(x => (tickets ?? []).filter(t => t.issueBucketId === x.id).length), 1);
                          return (
                            <button
                              key={b.id}
                              data-testid={`bucket-issue-${b.id}`}
                              onClick={() => {
                                setIssueBucketFilter(prev => {
                                  const next = new Set(prev);
                                  next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                                  return next;
                                });
                                setStatusFilter(new Set(["open", "closed"]));
                              }}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                                isActive
                                  ? "bg-[#FF9100]/15 border border-[#FF9100]/40 text-[#FF9100]"
                                  : "hover:bg-muted/60 text-foreground/80 border border-transparent"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <span className="font-medium truncate block">{b.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${isActive ? "bg-[#FF9100]" : "bg-primary/40"}`}
                                    style={{ width: `${ticketCount === 0 ? 0 : Math.max(8, (ticketCount / maxCount) * 100)}%` }}
                                  />
                                </div>
                                <span className={`text-[10px] font-semibold w-5 text-right ${isActive ? "text-[#FF9100]" : "text-muted-foreground"}`}>
                                  {ticketCount}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Solution Buckets */}
                  {bucketsData.solutionBuckets.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Solution Types</p>
                      <div className="space-y-1">
                        {bucketsData.solutionBuckets.map(b => {
                          const ticketCount = (tickets ?? []).filter(t => t.solutionBucketId === b.id).length;
                          const isActive = solutionBucketFilter.has(b.id);
                          const maxCount = Math.max(...bucketsData.solutionBuckets.map(x => (tickets ?? []).filter(t => t.solutionBucketId === x.id).length), 1);
                          return (
                            <button
                              key={b.id}
                              data-testid={`bucket-solution-${b.id}`}
                              onClick={() => {
                                setSolutionBucketFilter(prev => {
                                  const next = new Set(prev);
                                  next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                                  return next;
                                });
                                setStatusFilter(new Set(["open", "closed"]));
                              }}
                              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                                isActive
                                  ? "bg-blue-500/15 border border-blue-500/40 text-blue-400"
                                  : "hover:bg-muted/60 text-foreground/80 border border-transparent"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <span className="font-medium truncate block">{b.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${isActive ? "bg-blue-400" : "bg-primary/40"}`}
                                    style={{ width: `${ticketCount === 0 ? 0 : Math.max(8, (ticketCount / maxCount) * 100)}%` }}
                                  />
                                </div>
                                <span className={`text-[10px] font-semibold w-5 text-right ${isActive ? "text-blue-400" : "text-muted-foreground"}`}>
                                  {ticketCount}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
          {error ? (
            <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-center">
              Failed to load tickets: {(error as Error).message}
            </div>
          ) : isLoading ? (
            <div className="rounded-xl border bg-card p-4 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : mobileView ? (
            <>
              <MobileTicketList
                tickets={filteredTickets}
                onEdit={(ticket) => setDashboardEditingTicket(ticket)}
              />
              {/* Keep TicketTable mounted (hidden) so its edit dialog is available */}
              <div className="hidden">
                <TicketTable
                  key={tableKey}
                  tickets={filteredTickets}
                  editingTicket={dashboardEditingTicket}
                  onEditingChange={setDashboardEditingTicket}
                  onFilteredCountChange={setTableFilteredCount}
                  initialColumnFilters={colFilters}
                  onColumnFiltersChange={setColFilters}
                />
              </div>
            </>
          ) : (
            <TicketTable
              key={tableKey}
              tickets={filteredTickets}
              editingTicket={dashboardEditingTicket}
              onEditingChange={setDashboardEditingTicket}
              onFilteredCountChange={setTableFilteredCount}
              initialColumnFilters={colFilters}
              onColumnFiltersChange={setColFilters}
            />
          )}
        </div>

      </main>

      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="view-name">View Name</Label>
              <Input
                id="view-name"
                data-testid="input-view-name"
                placeholder="e.g., My Open P1s"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveView()}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="view-global" className="text-sm font-medium">Global View</Label>
                <p className="text-xs text-muted-foreground">
                  Visible to all team members
                </p>
              </div>
              <Switch
                id="view-global"
                data-testid="switch-view-global"
                checked={newViewGlobal}
                onCheckedChange={setNewViewGlobal}
              />
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground text-sm mb-1.5">Current Filters:</p>
              {statusFilter.size > 0 && (
                <p>Status: {[...statusFilter].join(", ")}</p>
              )}
              {priorityFilter.size > 0 && (
                <p>Priority: {[...priorityFilter].join(", ")}</p>
              )}
              {assigneeFilter.size > 0 && (
                <p>Assignee: {[...assigneeFilter].map(a => a === "__unassigned__" ? "Unassigned" : a).join(", ")}</p>
              )}
              {customerFilter.size > 0 && (
                <p>Customer: {[...customerFilter].join(", ")}</p>
              )}
              {regionFilter.size > 0 && (
                <p>Region: {[...regionFilter].join(", ")}</p>
              )}
              {systemIdFilter.size > 0 && (
                <p>System ID: {[...systemIdFilter].join(", ")}</p>
              )}
              {escalationLevelFilter.size > 0 && (
                <p>Escalation Level: {[...escalationLevelFilter].join(", ")}</p>
              )}
              {escalationSourceFilter.size > 0 && (
                <p>Escalation Source: {[...escalationSourceFilter].join(", ")}</p>
              )}
              {commsDirectionFilter.size > 0 && (
                <p>Direction: {[...commsDirectionFilter].join(", ")}</p>
              )}
              {titleSearch.trim() && (
                <p>Title search: "{titleSearch.trim()}"</p>
              )}
              {isrSearch.trim() && (
                <p>ISR #: "{isrSearch.trim()}"</p>
              )}
              {nextUpdateFilter && (
                <p>Next update: {nextUpdateFilter}</p>
              )}
              {dateFilterDays !== null && (
                <p>Submitted within: {dateFilterDays} days</p>
              )}
              {(submittedFrom || submittedTo) && (
                <p>Submitted: {submittedFrom || "any"} → {submittedTo || "any"}</p>
              )}
              {(nextUpdateFrom || nextUpdateTo) && (
                <p>Next update date: {nextUpdateFrom || "any"} → {nextUpdateTo || "any"}</p>
              )}
              {filterNoNextUpdate && (
                <p>No next update set</p>
              )}
              {colFilters.customer.length > 0 && (
                <p>Col Customer: {colFilters.customer.join(", ")}</p>
              )}
              {colFilters.priority.length > 0 && (
                <p>Col Priority: {colFilters.priority.join(", ")}</p>
              )}
              {colFilters.assignee.length > 0 && (
                <p>Col Assignee: {colFilters.assignee.join(", ")}</p>
              )}
              {!hasActiveFilters && <p>No active filters (default view)</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setSaveViewOpen(false); setNewViewName(""); setNewViewGlobal(false); }}
              >
                Cancel
              </Button>
              <Button
                data-testid="button-confirm-save-view"
                className="bg-[#FF9100] text-white"
                onClick={handleSaveView}
                disabled={!newViewName.trim()}
              >
                Save View
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <EmailComposeDialog
        open={emailListOpen}
        onOpenChange={setEmailListOpen}
        defaultTo={user?.email ?? ""}
        defaultSubject={emailListDraft.subject}
        defaultBody={emailListDraft.body}
        htmlBody={emailListDraft.html}
      />

      <DevChangesDialog open={devChangesOpen} onOpenChange={setDevChangesOpen} />
      <CheckInDialog open={checkInOpen} onOpenChange={setCheckInOpen} />
      <ContactDedupDialog open={dedupOpen} onOpenChange={setDedupOpen} />

      <Dialog open={adminOpen} onOpenChange={(o) => { setAdminOpen(o); if (!o) setAdminTab("users"); }}>
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-[#FF9100]" />
              User Role Management
            </DialogTitle>
          </DialogHeader>

          {/* Tab strip */}
          <div className="flex gap-1 border-b pb-0 -mb-px">
            {(["users", "configure"] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setAdminTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${adminTab === tab ? "border-[#FF9100] text-[#FF9100]" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {tab === "users" ? "Users" : "Configure Roles"}
              </button>
            ))}
          </div>

          {/* ── Users tab ── */}
          {adminTab === "users" && (
            <div className="mt-2 space-y-1">
              <p className="text-xs text-muted-foreground mb-4">
                Assign roles to control what each user can do. Only <span className="font-medium">@formic.co</span> employees are shown. Changes take effect on their next page load.
              </p>
              {adminUsers.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Users className="h-8 w-8 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No employees found yet</p>
                  <p className="text-xs mt-1 max-w-xs mx-auto">Formic employees will appear here after they sign in for the first time.</p>
                </div>
              ) : (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">User</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminUsers.map((u) => {
                        const displayName = (key: string) =>
                          roleConfigs.find(c => c.role === key)?.displayName ?? DEFAULT_ROLE_CONFIG[key as keyof typeof DEFAULT_ROLE_CONFIG]?.displayName ?? key;
                        return (
                          <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/20">
                            <td className="px-3 py-2.5">
                              <div className="font-medium truncate max-w-[280px]">{u.name || u.email}</div>
                              {u.name && <div className="text-xs text-muted-foreground truncate max-w-[280px]">{u.email}</div>}
                            </td>
                            <td className="px-3 py-2.5">
                              <Select
                                value={u.role}
                                onValueChange={(role) => setRoleMutation.mutate({ userId: u.userId, role })}
                                disabled={u.email === user?.email}
                              >
                                <SelectTrigger className="h-7 text-xs w-36" data-testid={`select-role-${u.userId}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">{displayName("admin")}</SelectItem>
                                  <SelectItem value="manager">{displayName("manager")}</SelectItem>
                                  <SelectItem value="agent">{displayName("agent")}</SelectItem>
                                  <SelectItem value="requester">{displayName("requester")}</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Configure Roles tab ── */}
          {adminTab === "configure" && (() => {
            const PERM_LABELS: { key: keyof RolePermissions; label: string; description: string }[] = [
              { key: "canCloseTickets",         label: "Close & Reopen Tickets",    description: "Can mark tickets as closed or reopen them" },
              { key: "canEditDailyReview",      label: "Edit Daily Review",         description: "Can add/edit install lines in the Daily Review" },
              { key: "canGenerateDailyReport",  label: "Generate Daily Report",     description: "Can generate or regenerate the daily report" },
              { key: "canSuperEscalate",        label: "Escalate to High",          description: "Can escalate tickets to the High level" },
              { key: "canCriticalEscalate",     label: "Escalate to Critical",      description: "Can escalate tickets to the Critical level" },
            ];

            // Build ordered list from roleEdits, sorted by hierarchyOrder
            const orderedKeys = Object.keys(roleEdits).sort((a, b) => (roleEdits[a]?.hierarchyOrder ?? 99) - (roleEdits[b]?.hierarchyOrder ?? 99));

            const moveRole = async (key: string, direction: -1 | 1) => {
              const idx = orderedKeys.indexOf(key);
              const swapIdx = idx + direction;
              if (swapIdx < 0 || swapIdx >= orderedKeys.length) return;
              const swapKey = orderedKeys[swapIdx];
              const myOrder = roleEdits[key].hierarchyOrder;
              const swapOrder = roleEdits[swapKey].hierarchyOrder;
              // Swap hierarchyOrders in local state
              setRoleEdits(prev => ({
                ...prev,
                [key]:     { ...prev[key],     hierarchyOrder: swapOrder },
                [swapKey]: { ...prev[swapKey], hierarchyOrder: myOrder   },
              }));
              // Persist both
              const keyEdit = roleEdits[key];
              const swapEdit = roleEdits[swapKey];
              await Promise.all([
                updateRoleConfigMutation.mutateAsync({ role: key,     displayName: keyEdit.displayName,   permissions: keyEdit.permissions,   hierarchyOrder: swapOrder }),
                updateRoleConfigMutation.mutateAsync({ role: swapKey, displayName: swapEdit.displayName, permissions: swapEdit.permissions, hierarchyOrder: myOrder   }),
              ]);
            };

            return (
              <div className="mt-2 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-muted-foreground flex-1">
                    Rename role labels, toggle permissions, and set hierarchy order. Admin is always full access. Use ↑↓ to reorder hierarchy.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs shrink-0 gap-1"
                    data-testid="button-add-role"
                    onClick={() => { setNewRoleName(""); setAddRoleOpen(true); }}
                  >
                    + Add Role
                  </Button>
                </div>

                {/* Add Role inline form */}
                {addRoleOpen && (
                  <div className="rounded-md border border-[#FF9100]/40 bg-[#FF9100]/5 p-4 space-y-3">
                    <p className="text-xs font-medium">New Custom Role</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoFocus
                        value={newRoleName}
                        onChange={e => setNewRoleName(e.target.value)}
                        placeholder="Role display name (e.g. Supervisor)"
                        className="text-sm bg-transparent border-b border-border/50 focus:border-[#FF9100] outline-none flex-1 py-0.5"
                        data-testid="input-new-role-name"
                        onKeyDown={async e => {
                          if (e.key === "Enter" && newRoleName.trim()) {
                            const slug = newRoleName.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
                            const maxOrder = Math.max(...Object.values(roleEdits).map(r => r.hierarchyOrder ?? 0), 0) + 1;
                            const newPerms: RolePermissions = { canCloseTickets: false, canEditDailyReview: false, canGenerateDailyReport: false, canSuperEscalate: false, canCriticalEscalate: false };
                            await createRoleConfigMutation.mutateAsync({ role: slug, displayName: newRoleName.trim(), permissions: newPerms, hierarchyOrder: maxOrder });
                            setAddRoleOpen(false);
                            toast({ title: "Role created", description: `"${newRoleName.trim()}" added. Configure its permissions below.` });
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs bg-[#FF9100] hover:bg-[#FF9100]/90 text-white"
                        data-testid="button-confirm-add-role"
                        disabled={!newRoleName.trim() || createRoleConfigMutation.isPending}
                        onClick={async () => {
                          const slug = newRoleName.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
                          const maxOrder = Math.max(...Object.values(roleEdits).map(r => r.hierarchyOrder ?? 0), 0) + 1;
                          const newPerms: RolePermissions = { canCloseTickets: false, canEditDailyReview: false, canGenerateDailyReport: false, canSuperEscalate: false, canCriticalEscalate: false };
                          await createRoleConfigMutation.mutateAsync({ role: slug, displayName: newRoleName.trim(), permissions: newPerms, hierarchyOrder: maxOrder });
                          setAddRoleOpen(false);
                          toast({ title: "Role created", description: `"${newRoleName.trim()}" added. Configure its permissions below.` });
                        }}
                      >
                        Create
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddRoleOpen(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {orderedKeys.map((key, idx) => {
                  const edit = roleEdits[key];
                  if (!edit) return null;
                  const isAdminRole = key === "admin";
                  const isBuiltin = BUILTIN_ROLES.has(key);
                  const isFirst = idx === 0;
                  const isLast = idx === orderedKeys.length - 1;

                  return (
                    <div key={key} className={`rounded-md border p-4 space-y-3 ${isAdminRole ? "opacity-60" : ""}`}>
                      <div className="flex items-center gap-2">
                        {/* Hierarchy arrows */}
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={isFirst || updateRoleConfigMutation.isPending}
                            onClick={() => moveRole(key, -1)}
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed"
                            data-testid={`button-move-up-${key}`}
                            title="Move up in hierarchy"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 2L11 9H1L6 2z"/></svg>
                          </button>
                          <button
                            type="button"
                            disabled={isLast || updateRoleConfigMutation.isPending}
                            onClick={() => moveRole(key, 1)}
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-20 disabled:cursor-not-allowed"
                            data-testid={`button-move-down-${key}`}
                            title="Move down in hierarchy"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L1 3H11L6 10z"/></svg>
                          </button>
                        </div>

                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider w-16 shrink-0 truncate">{key}</span>
                          {isAdminRole ? (
                            <span className="text-sm font-semibold">{edit.displayName}</span>
                          ) : (
                            <input
                              type="text"
                              value={edit.displayName}
                              onChange={e => setRoleEdits(prev => ({ ...prev, [key]: { ...prev[key], displayName: e.target.value } }))}
                              className="text-sm font-semibold bg-transparent border-b border-border/50 focus:border-[#FF9100] outline-none flex-1 min-w-0 py-0.5"
                              data-testid={`input-role-name-${key}`}
                              placeholder="Role display name"
                            />
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isAdminRole && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              data-testid={`button-save-role-${key}`}
                              disabled={updateRoleConfigMutation.isPending}
                              onClick={async () => {
                                await updateRoleConfigMutation.mutateAsync({ role: key, displayName: edit.displayName, permissions: edit.permissions, hierarchyOrder: edit.hierarchyOrder });
                                toast({ title: "Role updated", description: `${edit.displayName} saved.` });
                              }}
                            >
                              Save
                            </Button>
                          )}
                          {!isBuiltin && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              data-testid={`button-delete-role-${key}`}
                              disabled={deleteRoleConfigMutation.isPending}
                              onClick={async () => {
                                if (!confirm(`Delete the "${edit.displayName}" role? Users currently assigned this role will keep their assignment but may lose access.`)) return;
                                await deleteRoleConfigMutation.mutateAsync({ role: key });
                                toast({ title: "Role deleted", description: `"${edit.displayName}" has been removed.` });
                              }}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 pl-[3.5rem]">
                        {PERM_LABELS.map(({ key: pKey, label, description }) => {
                          const checked = isAdminRole ? true : (edit.permissions[pKey] ?? false);
                          return (
                            <label key={pKey} className={`flex items-start gap-2.5 ${isAdminRole ? "cursor-default" : "cursor-pointer"}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isAdminRole}
                                onChange={e => {
                                  if (isAdminRole) return;
                                  setRoleEdits(prev => ({
                                    ...prev,
                                    [key]: { ...prev[key], permissions: { ...prev[key].permissions, [pKey]: e.target.checked } },
                                  }));
                                }}
                                className="mt-0.5 accent-[#FF9100]"
                                data-testid={`checkbox-${key}-${pKey}`}
                              />
                              <span className="text-xs leading-snug">
                                <span className="font-medium">{label}</span>
                                <span className="text-muted-foreground ml-1">— {description}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-end">
        <button
          onClick={() => setDevChangesOpen(true)}
          className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          data-testid="button-dev-changes"
        >
          Dev Changes
        </button>
      </div>

    </div>
  );
}

