import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertTicketSchema, type InsertTicket, type Ticket, type IssueBucket, type SolutionBucket } from "@shared/schema";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/rich-text-editor";
import { MentionTextarea } from "@/components/mention-textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/searchable-select";
import { useCreateTicket, useUpdateTicket, useDeleteTicket } from "@/hooks/use-tickets";
import { Building2, CalendarIcon, Cpu, UserCircle, Mail, Phone, ExternalLink, Clock, Plus, ArrowLeft, Trash2, Bell, Check, Sparkles, RefreshCw, Loader2, Paperclip, Upload, X as XIcon, Info, Tag, Package } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SiSlack } from "react-icons/si";
import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { EmailComposeDialog } from "./email-compose-dialog";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface NotifySelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

function NotifySelect({ options, selected, onChange }: NotifySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter(s => s !== name) : [...selected, name]);
  };

  const label = selected.length === 0
    ? "Notify..."
    : selected.length === 1
    ? selected[0]
    : `${selected.length} people`;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        data-testid="button-notify-select"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm bg-muted/50 border rounded-md transition-colors ${
          selected.length > 0
            ? "border-orange-500/40 text-orange-300"
            : "border-input text-muted-foreground hover:border-white/30"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          <Bell className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        {selected.length > 0 && (
          <span className="shrink-0 text-xs bg-orange-500/20 text-orange-300 px-1.5 py-0.5 rounded-full">
            {selected.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search people..."
              className="w-full text-sm bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.map(name => (
              <div
                key={name}
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); toggle(name); }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer"
              >
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${selected.includes(name) ? "bg-orange-500 border-orange-500" : "border-input"}`}>
                  {selected.includes(name) && <Check className="h-2.5 w-2.5 text-white" />}
                </div>
                {name}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No results</div>
            )}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-border p-2">
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); onChange([]); setOpen(false); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Priority History Breakdown ──────────────────────────────────────────────
interface PriorityHistoryRow {
  id: number;
  ticket_id: number;
  priority_label: string | null;
  started_at: string;
  ended_at: string | null;
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const hrs = Math.round(hours % 24);
  return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
}

function PriorityHistoryBreakdown({ ticketId }: { ticketId: number }) {
  const { data: rows = [], isLoading } = useQuery<PriorityHistoryRow[]>({
    queryKey: ["/api/tickets", ticketId, "priority-history"],
    queryFn: () => fetch(`/api/tickets/${ticketId}/priority-history`, { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
      <Loader2 className="h-3 w-3 animate-spin" /> Loading priority history…
    </div>
  );
  if (rows.length === 0) return null;

  const now = new Date();
  let totalHours = 0;
  const segments = rows.map(r => {
    const start = new Date(r.started_at);
    const end = r.ended_at ? new Date(r.ended_at) : now;
    const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
    totalHours += hours;
    return { label: r.priority_label ?? "—", hours, start, end: r.ended_at ? end : null };
  });

  return (
    <div className="space-y-2 pt-1">
      <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3 w-3" />
        Time at Each Priority
      </h4>
      <div className="rounded-md border border-border/60 overflow-hidden">
        {segments.map((s, i) => {
          const pct = totalHours > 0 ? (s.hours / totalHours) * 100 : 0;
          return (
            <div key={i} className="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-border/30 last:border-0">
              <span className="text-muted-foreground w-[120px] shrink-0 truncate">{s.label}</span>
              <div className="flex-1 bg-muted/40 rounded-full h-1.5 min-w-[60px]">
                <div
                  className="h-1.5 rounded-full bg-[#FF9100]/70"
                  style={{ width: `${Math.max(pct, 2)}%` }}
                />
              </div>
              <span className="text-muted-foreground font-mono w-[52px] text-right shrink-0">
                {formatDuration(s.hours)}
              </span>
            </div>
          );
        })}
        <div className="flex items-center gap-3 px-3 py-1.5 text-xs bg-muted/20 font-medium">
          <span className="w-[120px] shrink-0">Total open time</span>
          <div className="flex-1" />
          <span className="font-mono w-[52px] text-right shrink-0">{formatDuration(totalHours)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── AI Assist Panel ─────────────────────────────────────────────────────────
interface AiAssistPanelProps {
  open: boolean;
  onClose: () => void;
  mode: "description" | "next-steps";
  context?: { ticketTitle?: string; customerName?: string; systemId?: string; assigneeName?: string };
  onAccept: (text: string) => void;
  initialText?: string;
}

function AiAssistPanel({ open, onClose, mode, context, onAccept, initialText }: AiAssistPanelProps) {
  const [rawText, setRawText] = useState("");
  const [result, setResult] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setRawText(initialText || "");
      setResult("");
      setError("");
    }
  }, [open]);

  async function generate() {
    if (!rawText.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/ai/polish-text", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText, mode, context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "AI request failed");
      setResult(data.result);
    } catch (err: any) {
      setError(err.message || "Failed to generate");
      toast({ title: "AI generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  const label = mode === "description" ? "Description" : "Next Steps / Updates";
  const placeholder = mode === "description"
    ? "e.g. The robot keeps erroring on axis 3. Kuka support said it needs remastering. Customer is down, Nick is handling it."
    : "e.g. Nick will remote in tomorrow morning and Charlson will be onsite Friday to do the remastering.";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-400" />
            AI Assist — {label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Describe in plain English</label>
            <Textarea
              data-testid="input-ai-assist-raw"
              placeholder={placeholder}
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              className="resize-none h-28 bg-muted/50 text-sm"
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
            />
            <p className="text-[11px] text-muted-foreground">Names and channels you mention will be kept as-is. Press ⌘↵ to generate.</p>
          </div>

          <Button
            data-testid="button-ai-generate"
            type="button"
            onClick={generate}
            disabled={!rawText.trim() || generating}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</> : <><Sparkles className="h-4 w-4 mr-2" />Generate</>}
          </Button>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {result && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">Result — edit if needed</label>
              <Textarea
                data-testid="input-ai-assist-result"
                value={result}
                onChange={e => setResult(e.target.value)}
                className="resize-none h-32 bg-muted/30 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  data-testid="button-ai-regenerate"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generate}
                  disabled={generating}
                  className="flex-1"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
                  Regenerate
                </Button>
                <Button
                  data-testid="button-ai-accept"
                  type="button"
                  size="sm"
                  onClick={() => { onAccept(result); onClose(); }}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Accept
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Close-Ticket AI Assist Panel ────────────────────────────────────────────
interface CloseTicketAiPanelProps {
  open: boolean;
  onClose: () => void;
  context?: { ticketTitle?: string; customerName?: string; description?: string };
  onAccept: (determination: string, solution: string) => void;
}

function CloseTicketAiPanel({ open, onClose, context, onAccept }: CloseTicketAiPanelProps) {
  const [rawText, setRawText] = useState("");
  const [determination, setDetermination] = useState("");
  const [solution, setSolution] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (!open) { setRawText(""); setDetermination(""); setSolution(""); setError(""); }
  }, [open]);

  async function generate() {
    if (!rawText.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/ai/close-assist", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText, context }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "AI request failed");
      setDetermination(data.determination ?? "");
      setSolution(data.solution ?? "");
    } catch (err: any) {
      setError(err.message || "Failed to generate");
      toast({ title: "AI generation failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  const hasResult = determination || solution;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-orange-400" />
            AI Assist — Close Ticket
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Describe in plain English how the issue was resolved</label>
            <Textarea
              data-testid="input-close-ai-raw"
              placeholder="e.g. Turned out the encoder lost calibration after a firmware update. We re-ran the Kuka remastering procedure and everything checked out."
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              className="resize-none h-28 bg-muted/50 text-sm"
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
            />
            <p className="text-[11px] text-muted-foreground">Press ⌘↵ to generate.</p>
          </div>

          <Button
            data-testid="button-close-ai-generate"
            type="button"
            onClick={generate}
            disabled={!rawText.trim() || generating}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating…</> : <><Sparkles className="h-4 w-4 mr-2" />Generate</>}
          </Button>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {hasResult && (
            <div className="space-y-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Final determination — edit if needed</label>
                <Textarea
                  data-testid="input-close-ai-determination"
                  value={determination}
                  onChange={e => setDetermination(e.target.value)}
                  className="resize-none h-20 bg-muted/30 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Final solution — edit if needed</label>
                <Textarea
                  data-testid="input-close-ai-solution"
                  value={solution}
                  onChange={e => setSolution(e.target.value)}
                  className="resize-none h-20 bg-muted/30 text-sm"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  data-testid="button-close-ai-regenerate"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generate}
                  disabled={generating}
                  className="flex-1"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generating ? "animate-spin" : ""}`} />
                  Regenerate
                </Button>
                <Button
                  data-testid="button-close-ai-accept"
                  type="button"
                  size="sm"
                  onClick={() => { onAccept(determination, solution); onClose(); }}
                  disabled={!determination.trim() || !solution.trim()}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Accept Both
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TicketFormProps {
  ticket?: Ticket;
  onSuccess?: () => void;
  onCancel?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

interface CustomerContact {
  name: string;
  email: string | null;
  phone: string | null;
}

interface TicketOptions {
  customers: string[];
  systemIds: string[];
  customerSystemIds: Record<string, string[]>;
  systemMeta: Record<string, { alias?: string; region?: string; vendor?: string }>;
  assignees: string[];
  priorityLabels: string[];
  regions: string[];
  customerContacts: Record<string, CustomerContact[]>;
}

function shortenPriority(label: string): string {
  const parts = label.split(":");
  if (parts.length >= 2) {
    return parts.slice(0, 2).map(s => s.trim()).join(": ");
  }
  return label;
}

const COMMS_DIRECTIONS = ["Inbound", "Outbound"];
const ESCALATION_SOURCES = ["Phone Call", "Phone Call (Personal)", "Email", "Email (Personal)", "Slack", "In Person", "Monitoring Alert", "Other"];

const INTERNAL_ONLY_CUSTOMER = "Internal Only";

const createTicketSchema = insertTicketSchema.extend({
  customerName: z.string().min(1, "Customer is required"),
  systemId: z.string().optional(),
  description: z.string().min(1, "Description is required"),
  priority: z.string().min(1, "Priority is required"),
  priorityLabel: z.string().min(1, "Priority label is required"),
  commsDirection: z.string().min(1, "Comms direction is required"),
  escalationSource: z.string().min(1, "Escalation source is required"),
  estimatedNextUpdate: z.any().refine((val) => val instanceof Date || (typeof val === "string" && !isNaN(Date.parse(val))), "Estimated next update is required"),
}).refine(
  (data) => data.customerName === INTERNAL_ONLY_CUSTOMER || !!data.systemId,
  { message: "System ID is required", path: ["systemId"] }
);

function TagsEditor({
  tags,
  allTags,
  onTagsChange,
}: {
  tags: string[];
  allTags: string[];
  onTagsChange: (newTags: string[]) => Promise<void>;
}) {
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Local copy so bubbles appear immediately (parent prop may be stale while mutation is in flight)
  const [localTags, setLocalTags] = useState<string[]>(() => Array.isArray(tags) ? tags : []);

  // Sync from prop when parent eventually refreshes (e.g. dialog reopened or query re-fetched)
  const prevTagsRef = useRef(tags);
  if (prevTagsRef.current !== tags && Array.isArray(tags)) {
    prevTagsRef.current = tags;
    setLocalTags(tags);
  }

  const safeAllTags = Array.isArray(allTags) ? allTags : [];

  const suggestions = inputValue.trim()
    ? safeAllTags.filter(
        t =>
          t.toLowerCase().includes(inputValue.trim().toLowerCase()) &&
          !localTags.map(x => x.toLowerCase()).includes(t.toLowerCase())
      )
    : safeAllTags.filter(t => !localTags.map(x => x.toLowerCase()).includes(t.toLowerCase()));

  const addTag = async (tag: string) => {
    const cleaned = tag.trim().toLowerCase().replace(/,/g, "");
    if (!cleaned || localTags.map(x => x.toLowerCase()).includes(cleaned)) {
      setInputValue("");
      return;
    }
    const newTags = [...localTags, cleaned];
    setLocalTags(newTags); // Optimistic: show bubble immediately
    setInputValue("");
    setSaving(true);
    try {
      await onTagsChange(newTags);
    } catch {
      setLocalTags(localTags); // Revert on error
    } finally {
      setSaving(false);
    }
  };

  const removeTag = async (tag: string) => {
    const newTags = localTags.filter(t => t !== tag);
    setLocalTags(newTags); // Optimistic: remove bubble immediately
    setSaving(true);
    try {
      await onTagsChange(newTags);
    } catch {
      setLocalTags(localTags); // Revert on error
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && inputValue.trim()) {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && localTags.length > 0) {
      removeTag(localTags[localTags.length - 1]);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Tag className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Tags</span>
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      <div
        className="flex flex-wrap gap-1.5 min-h-[34px] px-2.5 py-1.5 rounded-md border border-border/60 bg-muted/20 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {localTags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-500/15 text-orange-400 border border-orange-500/20"
            data-testid={`tag-${tag}`}
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="hover:text-orange-200 leading-none"
              data-testid={`button-remove-tag-${tag}`}
            >
              <XIcon className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={localTags.length === 0 ? "Add tags… (Enter or comma to confirm)" : ""}
            className="bg-transparent outline-none text-xs text-foreground placeholder:text-muted-foreground/50 w-full min-w-[130px]"
            data-testid="input-tag"
          />
          {focused && suggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[150px] max-h-[160px] overflow-y-auto">
              {suggestions.slice(0, 8).map(s => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={() => addTag(s)}
                  className="w-full text-left text-xs px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
                  data-testid={`suggestion-tag-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClosedTicketBucketEditor({
  ticket,
  bucketsData,
  issueBucketId,
  setIssueBucketId,
  solutionBucketId,
  setSolutionBucketId,
  onSave,
}: {
  ticket: Ticket;
  bucketsData: { issueBuckets: IssueBucket[]; solutionBuckets: SolutionBucket[] } | undefined;
  issueBucketId: number | null;
  setIssueBucketId: (id: number | null) => void;
  solutionBucketId: number | null;
  setSolutionBucketId: (id: number | null) => void;
  onSave: (issueBucketId: number | null, solutionBucketId: number | null) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { toast } = useToast();

  const origIssueId = ticket.issueBucketId ?? null;
  const origSolutionId = ticket.solutionBucketId ?? null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(issueBucketId, solutionBucketId);
      setDirty(false);
      toast({ title: "Classification updated", description: "Bucket changes saved and logged to history." });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleIssueChange = (v: string) => {
    const id = (v && v !== "__none__") ? Number(v) : null;
    setIssueBucketId(id);
    setDirty(id !== origIssueId || solutionBucketId !== origSolutionId);
  };

  const handleSolutionChange = (v: string) => {
    const id = (v && v !== "__none__") ? Number(v) : null;
    setSolutionBucketId(id);
    setDirty(issueBucketId !== origIssueId || id !== origSolutionId);
  };

  return (
    <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-xs font-medium text-foreground/70">Problem Classification</span>
        </div>
        {dirty && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="button-save-buckets"
            className="h-6 px-2 text-xs"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
            Save
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Issue Type</label>
          <Select
            value={issueBucketId !== null ? String(issueBucketId) : "__none__"}
            onValueChange={handleIssueChange}
          >
            <SelectTrigger data-testid="select-closed-issue-bucket" className="h-7 text-xs bg-background">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not set</SelectItem>
              {(bucketsData?.issueBuckets ?? []).map(b => (
                <SelectItem key={b.id} value={String(b.id)} className="text-xs">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Solution Type</label>
          <Select
            value={solutionBucketId !== null ? String(solutionBucketId) : "__none__"}
            onValueChange={handleSolutionChange}
          >
            <SelectTrigger data-testid="select-closed-solution-bucket" className="h-7 text-xs bg-background">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not set</SelectItem>
              {(bucketsData?.solutionBuckets ?? []).map(b => (
                <SelectItem key={b.id} value={String(b.id)} className="text-xs">
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export function TicketForm({ ticket, onSuccess, onCancel, onDirtyChange }: TicketFormProps) {
  const isEditing = !!ticket;
  const createMutation = useCreateTicket();
  const updateMutation = useUpdateTicket();
  const deleteMutation = useDeleteTicket();
  const { user, canCloseTickets, isRequester, canSuperEscalate, canCriticalEscalate } = useAuth();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sentToProject, setSentToProject] = useState(false);
  const [sendingToProject, setSendingToProject] = useState(false);
  const [projectStatus, setProjectStatus] = useState<{ processed: boolean; step?: string; tasks?: { label: string; done: boolean }[] } | null>(null);
  const projectPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (projectPollRef.current) clearInterval(projectPollRef.current); };
  }, []);

  const startProjectPolling = (immediate = true) => {
    if (projectPollRef.current) clearInterval(projectPollRef.current);
    const poll = async () => {
      try {
        const res = await fetch("/api/convert-to-project");
        const json = await res.json();
        if (json?.data) {
          setProjectStatus(json.data);
          if (json.data.processed === true) {
            clearInterval(projectPollRef.current!);
            projectPollRef.current = null;
          }
        }
      } catch {}
    };
    if (immediate) poll();
    projectPollRef.current = setInterval(poll, 5000);
  };

  // Auto-log a history entry when project status updates meaningfully
  const prevProjectStatusRef = useRef<typeof projectStatus>(null);
  useEffect(() => {
    if (!ticket || !projectStatus) return;
    const prev = prevProjectStatusRef.current;
    prevProjectStatusRef.current = projectStatus;
    if (!prev) return; // skip first set (on-mount load, not a real update)
    const stepChanged = prev.step !== projectStatus.step;
    const justCompleted = !prev.processed && projectStatus.processed;
    if (!stepChanged && !justCompleted) return;
    const actor = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Project App";
    const now = new Date().toISOString();
    const stepLabels: Record<string, string> = {
      scoping: "Scoping",
      resource_assignment: "Resource Assignment",
      in_progress: "In Progress",
      timeline_set: "Timeline Set",
      complete: "Project Created",
    };
    const stepLabel = stepLabels[projectStatus.step ?? ""] ?? (projectStatus.step?.replace(/_/g, " ") ?? "in progress");
    const text = justCompleted || projectStatus.step === "complete"
      ? "Project created — ticket successfully converted to project."
      : `Project tracker updated: ${stepLabel}`;
    const current = Array.isArray(ticket.nextStepsHistory) ? ticket.nextStepsHistory : [];
    updateMutation.mutateAsync({ id: ticket.id, data: { nextStepsHistory: [...current, { text, updatedBy: actor, updatedAt: now }] as any } })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/tickets"] }))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectStatus]);

  // On open or tag change: detect prior conversion via tag or per-ticket API lookup
  const tagsKey = JSON.stringify(ticket?.tags ?? []);
  useEffect(() => {
    if (!ticket) return;
    const hasTag = Array.isArray(ticket.tags) && ticket.tags.map((t: string) => t.toLowerCase()).includes("project");
    const ticketId = encodeURIComponent(ticket.ticketNumber || `ISR-${ticket.id}`);
    const check = async () => {
      try {
        const res = await fetch(`/api/convert-to-project/by-ticket/${ticketId}`);
        const json = await res.json();
        const data = json?.data;
        if (hasTag || data) {
          setSentToProject(true);
          if (data) setProjectStatus(data);
          startProjectPolling(false);
        }
      } catch {
        if (hasTag) {
          setSentToProject(true);
          startProjectPolling(false);
        }
      }
    };
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, tagsKey]);

  const [markingComplete, setMarkingComplete] = useState(false);
  const markProjectComplete = async () => {
    if (!ticket || markingComplete) return;
    setMarkingComplete(true);
    try {
      const ticketId = encodeURIComponent(ticket.ticketNumber || `ISR-${ticket.id}`);
      const res = await fetch(`/api/convert-to-project/complete/${ticketId}`, { method: "POST" });
      const json = await res.json();
      if (json?.data) {
        setProjectStatus(json.data);
        if (projectPollRef.current) { clearInterval(projectPollRef.current); projectPollRef.current = null; }
      }
    } finally {
      setMarkingComplete(false);
    }
  };

  const convertToProject = async () => {
    if (!ticket || sentToProject || sendingToProject) return;
    setSendingToProject(true);
    try {
      await apiRequest("POST", "/api/convert-to-project", {
        id: ticket.ticketNumber || `ISR-${ticket.id}`,
        title: ticket.title,
        customer: ticket.customerName ?? null,
        systemId: ticket.systemId ?? null,
        priority: ticket.priorityLabel ?? null,
        assignee: ticket.assigneeName ?? null,
      });
      const currentTags: string[] = Array.isArray(ticket.tags) ? ticket.tags : [];
      const currentHistory = Array.isArray(ticket.nextStepsHistory) ? ticket.nextStepsHistory : [];
      const actor = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Team";
      const now = new Date().toISOString();
      const updates: Record<string, unknown> = {};
      if (!currentTags.map(t => t.toLowerCase()).includes("project")) {
        updates.tags = [...currentTags, "project"];
      }
      updates.nextStepsHistory = [
        ...currentHistory,
        { text: "Ticket converted to project and sent to project tracker.", updatedBy: actor, updatedAt: now },
      ];
      await updateMutation.mutateAsync({ id: ticket.id, data: updates as any });
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets/tags"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setSentToProject(true);
      startProjectPolling();
    } finally {
      setSendingToProject(false);
    }
  };

  const loggedInUserName = useMemo(() => {
    if (!user) return undefined;
    return [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;
  }, [user]);

  const userCanCloseThisTicket = useMemo(() => {
    if (canCloseTickets) return true;
    if (!isRequester || !ticket || !loggedInUserName) return false;
    const openedByMe = ticket.nextStepsHistory?.some(
      (e) => e.text === "Ticket created" && e.updatedBy === loggedInUserName
    ) ?? false;
    const isAssignee = !!ticket.assigneeName && ticket.assigneeName === loggedInUserName;
    return openedByMe || isAssignee;
  }, [canCloseTickets, isRequester, ticket, loggedInUserName]);

  const { data: options } = useQuery<TicketOptions>({
    queryKey: ["/api/tickets/options"],
    staleTime: 0,
  });

  const [newContactName, setNewContactName] = useState(ticket?.contactName || "");
  const [newContactPhone, setNewContactPhone] = useState(ticket?.contactPhone || "");
  const [newContactEmail, setNewContactEmail] = useState(ticket?.contactEmail || "");
  const [showNewContact, setShowNewContact] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [finalDetermination, setFinalDetermination] = useState("");
  const [finalSolution, setFinalSolution] = useState("");
  const [issueBucketId, setIssueBucketId] = useState<number | null>(ticket?.issueBucketId ?? null);
  const [solutionBucketId, setSolutionBucketId] = useState<number | null>(ticket?.solutionBucketId ?? null);
  const [bucketizing, setBucketizing] = useState(false);
  const [bucketNewLabel, setBucketNewLabel] = useState<{ issue?: string; solution?: string } | null>(null);
  const closeFormRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: bucketsData } = useQuery<{ issueBuckets: IssueBucket[]; solutionBuckets: SolutionBucket[] }>({
    queryKey: ["/api/buckets"],
    staleTime: 60_000,
  });

  const { data: allTagsData } = useQuery<string[]>({
    queryKey: ["/api/tickets/tags"],
    staleTime: 30_000,
    enabled: !!ticket,
  });

  const [sysMetaOpen, setSysMetaOpen] = useState(false);
  const [editSysAlias, setEditSysAlias] = useState("");

  // Escalation
  const [showEscalateForm, setShowEscalateForm] = useState(false);
  const [escalateLevel, setEscalateLevel] = useState("");
  const [escalateComment, setEscalateComment] = useState("");
  const [escalatePending, setEscalatePending] = useState(false);
  // Normalize legacy "Normal" to "Standard"
  const normalizeEscLevel = (l: string | null | undefined) => (!l || l === "Normal") ? "Standard" : l;
  const [currentEscalationLevel, setCurrentEscalationLevel] = useState(normalizeEscLevel(ticket?.escalationLevel));

  // Information Only flow
  const [showInfoOnlyDialog, setShowInfoOnlyDialog] = useState(false);
  const [infoOnlyDetermination, setInfoOnlyDetermination] = useState("");
  const [infoOnlySolution, setInfoOnlySolution] = useState("");
  const [infoOnlyPending, setInfoOnlyPending] = useState(false);

  // File upload to Slack
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ name: string; permalink: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
    });
  }

  async function uploadFileToTicket(file: File, ticketId: number) {
    setFileUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const result: { name: string; permalink: string } = await (await apiRequest(
        "POST",
        `/api/tickets/${ticketId}/upload-to-slack`,
        { filename: file.name, data: base64, mimeType: file.type }
      )).json();
      setUploadedFiles((prev) => [...prev, { name: result.name, permalink: result.permalink }]);
      setPendingFile(null);
      toast({ title: "File uploaded", description: `${result.name} was sent to Slack.` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setFileUploading(false);
    }
  }

  // Parts Order dialog
  const [partsOrderOpen, setPartsOrderOpen] = useState(false);
  const [poChannel, setPoChannel] = useState(ticket?.csChannel?.replace(/^#/, "") || "");
  const [poAsaSys, setPoAsaSys] = useState("");
  const [poAsaLoading, setPoAsaLoading] = useState(false);
  const [poVendorPart, setPoVendorPart] = useState("");
  const [poDescription, setPoDescription] = useState("");
  const [poNeedByDate, setPoNeedByDate] = useState("");
  const [poWorkOrder, setPoWorkOrder] = useState("");
  const [poMessageUrl, setPoMessageUrl] = useState<string | null>(null);
  const [poWorkflowUrl, setPoWorkflowUrl] = useState<string | null>(null);

  const { data: slackChannels = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/slack/channels"],
    enabled: isEditing,
  });

  const partsOrderMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tickets/${ticket?.id}/parts-order`, {
        customerChannel: poChannel,
        asaOrSysNumber: poAsaSys || undefined,
        vendorPartNumber: poVendorPart || undefined,
        partDescription: poDescription || undefined,
        needByDate: poNeedByDate || undefined,
        workOrderNumber: poWorkOrder || undefined,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to send parts order");
      }
      return res.json() as Promise<{ success: boolean; messageUrl: string | null; workflowUrl: string | null }>;
    },
    onSuccess: (data) => {
      setPoMessageUrl(data.messageUrl || null);
      if (data.workflowUrl) setPoWorkflowUrl(data.workflowUrl);
      setPoVendorPart("");
      setPoDescription("");
      setPoNeedByDate("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to send parts order", description: err.message, variant: "destructive" });
    },
  });

  // AI Assist panels
  const [descAiOpen, setDescAiOpen] = useState(false);
  const [nextStepsAiOpen, setNextStepsAiOpen] = useState(false);
  const [closeAiOpen, setCloseAiOpen] = useState(false);
  const [titleRegenPending, setTitleRegenPending] = useState(false);

  const form = useForm<InsertTicket>({
    resolver: zodResolver(isEditing ? insertTicketSchema : createTicketSchema),
    defaultValues: {
      title: ticket?.title || "",
      description: ticket?.description || "",
      status: ticket?.status || "open",
      priority: ticket?.priority || "medium",
      priorityLabel: ticket?.priorityLabel || undefined,
      customerName: ticket?.customerName || undefined,
      systemId: ticket?.systemId || undefined,
      workOrderNumber: ticket?.workOrderNumber || undefined,
      assigneeName: ticket?.assigneeName || loggedInUserName || undefined,
      region: ticket?.region || undefined,
      contactPhone: ticket?.contactPhone || undefined,
      commsDirection: ticket?.commsDirection || undefined,
      escalationSource: ticket?.escalationSource || undefined,
      nextSteps: ticket?.status === "open" ? "" : (ticket?.nextSteps || ""),
      estimatedNextUpdate: ticket?.estimatedNextUpdate ? new Date(ticket.estimatedNextUpdate) : (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; })(),
      notifyNames: ticket?.notifyNames || [],
    },
  });

  useEffect(() => {
    if (!isEditing && loggedInUserName && !form.getValues("assigneeName")) {
      form.setValue("assigneeName", loggedInUserName);
    }
  }, [loggedInUserName, isEditing, form]);

  // Notify parent whenever the form dirty state changes (used to show close confirmation)
  const isDirty = form.formState.isDirty;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Auto-regen title when description changes in edit mode (debounced 2.5 s)
  const watchedDescription = form.watch("description");
  useEffect(() => {
    if (!isEditing) return;
    if (!watchedDescription?.trim()) return;
    const timer = setTimeout(async () => {
      setTitleRegenPending(true);
      try {
        const res = await fetch("/api/ai/regen-title", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: watchedDescription }),
        });
        const data = await res.json();
        const currentTitle = form.getValues("title");
        if (res.ok && data.title && !currentTitle?.trim()) {
          form.setValue("title", data.title, { shouldDirty: true });
        }
      } catch { /* silent */ } finally {
        setTitleRegenPending(false);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [watchedDescription, isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (data: InsertTicket) => {
    if (newContactName) {
      data.contactName = newContactName;
      if (newContactPhone) data.contactPhone = newContactPhone;
      if (newContactEmail) data.contactEmail = newContactEmail;
    }
    if (!isEditing && !data.contactName) {
      toast({
        title: "Contact required",
        description: "Please select or add a contact for this ticket.",
        variant: "destructive",
      });
      return;
    }
    if (isEditing) {
      await updateMutation.mutateAsync({ id: ticket.id, data });
    } else {
      const newTicket = await createMutation.mutateAsync(data);
      if (pendingFile && newTicket?.id) {
        await uploadFileToTicket(pendingFile, newTicket.id);
      }
    }
    onSuccess?.();
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleBucketize = async () => {
    if (!finalDetermination.trim() || !finalSolution.trim()) {
      toast({
        title: "Fill in both fields first",
        description: "Please enter the final determination and solution before bucketizing.",
        variant: "destructive",
      });
      return;
    }
    setBucketizing(true);
    setBucketNewLabel(null);
    try {
      const result = await apiRequest("POST", "/api/ai/bucketize", {
        ticketTitle: ticket?.title,
        description: ticket?.description,
        finalDetermination,
        finalSolution,
      });
      const data = await result.json();
      setIssueBucketId(data.issueBucket.id);
      setSolutionBucketId(data.solutionBucket.id);
      setBucketNewLabel({
        issue: data.issueBucket.isNew ? data.issueBucket.name : undefined,
        solution: data.solutionBucket.isNew ? data.solutionBucket.name : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/buckets"] });
    } catch (err: any) {
      toast({ title: "Bucketization failed", description: err.message || "AI request failed", variant: "destructive" });
    } finally {
      setBucketizing(false);
    }
  };

  const handleCloseTicket = async () => {
    const issueProvided = !!finalDetermination.trim() || issueBucketId !== null;
    const solutionProvided = !!finalSolution.trim() || solutionBucketId !== null;

    if (!issueProvided || !solutionProvided) {
      toast({
        title: "Missing required fields",
        description: !issueProvided
          ? "Please provide a final determination (type it or select an issue type)."
          : "Please provide a final solution (type it or select a solution type).",
        variant: "destructive",
      });
      return;
    }

    const formData = form.getValues();
    if (showNewContact && newContactName) {
      formData.contactPhone = newContactPhone || undefined;
    }

    const parts = [];
    if (finalDetermination.trim()) parts.push(`Final Determination: ${finalDetermination.trim()}`);
    if (finalSolution.trim()) parts.push(`Final Solution: ${finalSolution.trim()}`);
    const resolution = parts.join("\n\n");

    await updateMutation.mutateAsync({
      id: ticket!.id,
      data: {
        ...formData,
        status: "closed",
        resolution,
        issueBucketId: issueBucketId ?? undefined,
        solutionBucketId: solutionBucketId ?? undefined,
      },
    });
    onSuccess?.();
  };

  const handleReopenTicket = async () => {
    await updateMutation.mutateAsync({
      id: ticket!.id,
      data: {
        status: "open",
      },
    });
    toast({
      title: "Ticket reopened",
      description: `${ticket!.ticketNumber} has been reopened.`,
    });
    onSuccess?.();
  };

  const handleInfoOnlyClick = async () => {
    const valid = await form.trigger();
    if (!valid) return;
    const data = form.getValues();
    if (newContactName) {
      data.contactName = newContactName;
    }
    if (!data.contactName) {
      toast({ title: "Contact required", description: "Please select or add a contact for this ticket.", variant: "destructive" });
      return;
    }
    setInfoOnlyDetermination("");
    setInfoOnlySolution("");
    setShowInfoOnlyDialog(true);
  };

  const ESCALATION_LEVELS = ["Standard", "Elevated", "High", "Critical"] as const;
  type EscalationLevel = typeof ESCALATION_LEVELS[number];


  const escalationLevelColor = (level: string) =>
    level === "Critical" ? "bg-red-500/15 text-red-400 border-red-500/40" :
    level === "High" ? "bg-orange-500/15 text-orange-400 border-orange-500/40" :
    level === "Elevated" ? "bg-amber-500/15 text-amber-400 border-amber-500/40" :
    "bg-green-500/10 text-green-400 border-green-500/30";

  const handleEscalateSubmit = async () => {
    if (!ticket || !escalateLevel || !escalateComment.trim()) return;
    setEscalatePending(true);
    const curIdx = ESCALATION_LEVELS.indexOf(currentEscalationLevel as EscalationLevel);
    const newIdx = ESCALATION_LEVELS.indexOf(escalateLevel as EscalationLevel);
    const isDeescalating = newIdx < curIdx;
    try {
      const now = new Date().toISOString();
      const actor = loggedInUserName || user?.email || "Unknown";
      const prevLevel = currentEscalationLevel;
      const action = isDeescalating ? "De-escalated" : "Escalated";
      const historyEntry = { level: escalateLevel, comment: escalateComment.trim(), escalatedBy: actor, escalatedAt: now };
      const auditEntry = { text: `${action} from ${prevLevel} to ${escalateLevel}: ${escalateComment.trim()}`, updatedBy: actor, updatedAt: now };
      const currentEscHistory = ticket.escalationHistory || [];
      const currentHistory = ticket.nextStepsHistory || [];
      await apiRequest("PATCH", `/api/tickets/${ticket.id}`, {
        escalationLevel: escalateLevel,
        escalationHistory: [...currentEscHistory, historyEntry],
        nextStepsHistory: [...currentHistory, auditEntry],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setCurrentEscalationLevel(escalateLevel);
      toast({ title: isDeescalating ? "Escalation reduced" : "Escalation updated", description: `Ticket ${isDeescalating ? "de-escalated" : "escalated"} to ${escalateLevel}.` });
      setShowEscalateForm(false);
      setEscalateLevel("");
      setEscalateComment("");
    } catch (err: any) {
      toast({ title: "Failed to update escalation", description: err.message, variant: "destructive" });
    } finally {
      setEscalatePending(false);
    }
  };

  const handleInfoOnlyConfirm = async () => {
    if (!infoOnlyDetermination.trim() || !infoOnlySolution.trim()) {
      toast({ title: "Missing fields", description: "Please fill in both the final determination and final solution.", variant: "destructive" });
      return;
    }
    setInfoOnlyPending(true);
    try {
      const data = form.getValues();
      if (newContactName) {
        data.contactName = newContactName;
        if (newContactPhone) data.contactPhone = newContactPhone;
        if (newContactEmail) data.contactEmail = newContactEmail;
      }
      const newTicket = await createMutation.mutateAsync(data);
      if (pendingFile && newTicket?.id) {
        await uploadFileToTicket(pendingFile, newTicket.id);
      }
      const resolution = `Final Determination: ${infoOnlyDetermination.trim()}\n\nFinal Solution: ${infoOnlySolution.trim()}`;
      await updateMutation.mutateAsync({
        id: newTicket.id,
        data: { status: "closed", resolution },
      });
      setShowInfoOnlyDialog(false);
      onSuccess?.();
    } catch (err: any) {
      toast({ title: "Failed to create ticket", description: err.message, variant: "destructive" });
    } finally {
      setInfoOnlyPending(false);
    }
  };

  const [newTicketDateOpen, setNewTicketDateOpen] = useState(false);
  const [editDateOpen, setEditDateOpen] = useState(false);

  const selectedCustomer = form.watch("customerName");

  const systemIdToCustomer = useMemo(() => {
    const map: Record<string, string> = {};
    if (!options?.customerSystemIds) return map;
    for (const [customer, ids] of Object.entries(options.customerSystemIds)) {
      for (const id of ids) {
        map[id] = customer;
      }
    }
    return map;
  }, [options]);

  const filteredSystemIds = useMemo(() => {
    if (!options) return [];
    const perCustomer = selectedCustomer ? options.customerSystemIds?.[selectedCustomer] : undefined;
    // Use the customer's specific systems if they exist in the map (even if the
    // array is temporarily empty). Only fall back to the global list when the
    // customer is not in the map at all (undefined).
    const ids = perCustomer !== undefined
      ? perCustomer
      : (options.systemIds || []);
    const meta = options.systemMeta || {};
    return ids.map(id => {
      const m = meta[id] || {};
      const customerName = systemIdToCustomer[id];
      let label = id;
      if (customerName) label += ` — ${customerName}`;
      if (m.region) label += ` — (${m.region})`;
      if (m.alias) label += ` — ${m.alias}`;
      if (m.vendor) label += ` — ${m.vendor}`;
      return { value: id, label };
    });
  }, [selectedCustomer, options, systemIdToCustomer]);

  const filteredContacts = useMemo(() => {
    if (!options?.customerContacts || !selectedCustomer) return [];
    return options.customerContacts[selectedCustomer] || [];
  }, [selectedCustomer, options]);

  const currentSystemId = form.watch("systemId");

  const sysMetaMutation = useMutation({
    mutationFn: (data: { alias: string }) =>
      apiRequest("PATCH", `/api/system-meta/${encodeURIComponent(currentSystemId || "")}`, {
        alias: data.alias,
        ticketId: ticket?.id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets/options"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setSysMetaOpen(false);
      toast({ title: "System info updated", description: "Changes saved to Airtable." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update system info", description: err.message, variant: "destructive" });
    },
  });

  const selectedPriorityLabel = form.watch("priorityLabel");
  useEffect(() => {
    if (selectedPriorityLabel) {
      const pl = selectedPriorityLabel.toLowerCase();
      if (pl.includes("p1") || pl.includes("high") || pl.includes("critical")) {
        form.setValue("priority", "high");
      } else if (pl.includes("p3") || pl.includes("p4") || pl.includes("low") || pl.includes("project") || pl.includes("other")) {
        form.setValue("priority", "low");
      } else {
        form.setValue("priority", "medium");
      }

      if (!isEditing) {
        const today = new Date();
        today.setHours(12, 0, 0, 0);
        let defaultDate: Date;
        if (pl.includes("p1")) {
          defaultDate = today;
        } else if (pl.includes("p2")) {
          defaultDate = new Date(today);
          defaultDate.setDate(defaultDate.getDate() + 1);
        } else {
          defaultDate = new Date(today);
          defaultDate.setDate(defaultDate.getDate() + 7);
        }
        form.setValue("estimatedNextUpdate", defaultDate);
      }
    }
  }, [selectedPriorityLabel, form, isEditing]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 overflow-x-hidden">
        {isEditing && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground shrink-0">Customer:</span>
              <FormField
                control={form.control}
                name="customerName"
                render={({ field }) => (
                  <SearchableSelect
                    data-testid="select-edit-customer"
                    value={field.value || undefined}
                    onValueChange={(val) => {
                      field.onChange(val);
                      form.setValue("systemId", undefined);
                      setNewContactName("");
                      setNewContactEmail("");
                      setNewContactPhone("");
                      setAddingContact(false);
                    }}
                    options={[INTERNAL_ONLY_CUSTOMER, ...(options?.customers || []).filter(c => c !== INTERNAL_ONLY_CUSTOMER)]}
                    placeholder="Select customer"
                    triggerClassName="h-7 text-sm bg-transparent border-border/60 flex-1 min-w-0"
                  />
                )}
              />
            </div>
            {selectedCustomer !== INTERNAL_ONLY_CUSTOMER && (
              <>
                <div className="flex items-center gap-2 text-sm">
                  {currentSystemId ? (
                    <button
                      type="button"
                      className="shrink-0 leading-none"
                      data-testid="icon-system-meta"
                      onClick={() => {
                        if (!sysMetaOpen) {
                          const meta = options?.systemMeta?.[currentSystemId] || {};
                          setEditSysAlias(meta.alias || "");
                        }
                        setSysMetaOpen(!sysMetaOpen);
                      }}
                    >
                      <Cpu className={`h-3.5 w-3.5 shrink-0 transition-colors cursor-pointer ${sysMetaOpen ? "text-[#FF9100]" : "text-[#FF9100] hover:text-[#FF9100]/80"}`} />
                    </button>
                  ) : (
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-muted-foreground shrink-0">System:</span>
                  <FormField
                    control={form.control}
                    name="systemId"
                    render={({ field }) => (
                      <SearchableSelect
                        data-testid="select-edit-system"
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        options={filteredSystemIds}
                        placeholder="Select system"
                        triggerClassName="h-7 text-sm bg-transparent border-border/60 flex-1 min-w-0"
                      />
                    )}
                  />
                </div>
                {sysMetaOpen && currentSystemId && (
                  <div className="rounded-md border border-[#FF9100]/40 bg-muted/30 p-3 space-y-3 text-sm ml-5">
                    <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Edit System Info</p>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Alias</label>
                      <Input
                        value={editSysAlias}
                        onChange={(e) => setEditSysAlias(e.target.value)}
                        placeholder="e.g. BeRobox"
                        className="h-7 text-sm"
                        data-testid="input-sys-alias"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        className="flex-1 h-7 text-xs bg-[#FF9100] hover:bg-[#FF9100]/80 text-black"
                        disabled={sysMetaMutation.isPending}
                        onClick={() => sysMetaMutation.mutate({ alias: editSysAlias })}
                        data-testid="button-save-sys-meta"
                      >
                        {sysMetaMutation.isPending ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => setSysMetaOpen(false)}
                        data-testid="button-cancel-sys-meta"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="flex items-center gap-2 text-sm">
              {(() => {
                const selectedContact = filteredContacts.find(c => c.name === newContactName);
                const hasInfo = !!(newContactEmail || newContactPhone || selectedContact?.email || selectedContact?.phone);
                const displayEmail = newContactEmail || selectedContact?.email || "";
                const displayPhone = newContactPhone || selectedContact?.phone || "";
                const icon = (
                  <UserCircle
                    className={`h-3.5 w-3.5 shrink-0 transition-colors ${hasInfo && newContactName ? "text-[#FF9100] cursor-pointer hover:text-[#FF9100]/80" : "text-muted-foreground"}`}
                    data-testid="icon-contact-info"
                  />
                );
                return hasInfo && newContactName ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="shrink-0 leading-none">{icon}</button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="right"
                      align="start"
                      className="w-64 p-3 space-y-2 text-sm z-[200]"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <UserCircle className="h-4 w-4 text-[#FF9100]" />
                        {newContactName}
                      </div>
                      {displayEmail && (
                        <a
                          href={`mailto:${displayEmail}`}
                          className="flex items-center gap-1.5 text-blue-500 hover:underline break-all"
                          data-testid="link-contact-email"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          {displayEmail}
                        </a>
                      )}
                      {displayPhone && (
                        <a
                          href={`tel:${displayPhone}`}
                          className="flex items-center gap-1.5 text-blue-500 hover:underline"
                          data-testid="link-contact-phone"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {displayPhone}
                        </a>
                      )}
                    </PopoverContent>
                  </Popover>
                ) : icon;
              })()}
              <span className="text-muted-foreground shrink-0">Contact:</span>
              {filteredContacts.length > 0 ? (
                <SearchableSelect
                  key={selectedCustomer || "__no_customer__"}
                  data-testid="select-edit-contact"
                  value={newContactName || undefined}
                  onValueChange={(val) => {
                    setNewContactName(val);
                    const contact = filteredContacts.find(c => c.name === val);
                    if (contact) {
                      setNewContactEmail(contact.email || "");
                      setNewContactPhone(contact.phone || "");
                      if (contact.email) form.setValue("contactEmail", contact.email);
                      if (contact.phone) form.setValue("contactPhone", contact.phone);
                    }
                  }}
                  options={filteredContacts.map(c => c.name)}
                  placeholder="Select contact"
                  triggerClassName="h-7 text-sm bg-transparent border-border/60 flex-1 min-w-0"
                />
              ) : (
                <Input
                  data-testid="input-edit-contact"
                  placeholder={selectedCustomer ? "No contacts found" : "Select customer first"}
                  className="h-7 text-sm bg-transparent border-border/60 flex-1"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                />
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <UserCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground shrink-0">Assignee:</span>
              <FormField
                control={form.control}
                name="assigneeName"
                render={({ field }) => (
                  <SearchableSelect
                    data-testid="select-edit-assignee"
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                    options={options?.assignees || []}
                    placeholder="Select assignee"
                    triggerClassName="h-7 text-sm bg-transparent border-border/60 flex-1 min-w-0"
                  />
                )}
              />
            </div>
            {(newContactEmail || ticket.contactEmail) && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Email:</span>
                <span data-testid="text-edit-contact-email" className="text-foreground">{newContactEmail || ticket.contactEmail}</span>
              </div>
            )}
            {(newContactPhone || ticket.contactPhone) && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Phone:</span>
                <span data-testid="text-edit-contact-phone" className="text-foreground">{newContactPhone || ticket.contactPhone}</span>
              </div>
            )}
            {ticket.csChannel && (
              <div className="flex items-center gap-2 text-sm">
                <SiSlack className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Slack:</span>
                <a
                  href={`https://app.slack.com/client/T019Y3V5LR4/${ticket.csChannel.replace(/^#/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="link-slack-channel"
                  className="text-[#FF9100] hover:underline flex items-center gap-1"
                >
                  #{ticket.csChannel.replace(/^#/, "")}
                  <ExternalLink className="h-3 w-3" />
                </a>
                {ticket.slackMessageId && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <a
                      href={`https://goformic.slack.com/archives/${ticket.csChannel.replace(/^#/, "")}/p${ticket.slackMessageId.replace(".", "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="link-slack-thread"
                      className="text-[#FF9100] hover:underline flex items-center gap-1"
                    >
                      Thread
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </>
                )}
              </div>
            )}
            <div className="pt-1.5 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="button-email-customer"
                className="w-full text-sm gap-2"
                onClick={() => setEmailDialogOpen(true)}
              >
                <Mail className="h-4 w-4" />
                Email Customer
              </Button>
              <EmailComposeDialog
                open={emailDialogOpen}
                onOpenChange={setEmailDialogOpen}
                defaultTo={ticket.contactEmail || ""}
                defaultSubject={`Formic Support Update - ${ticket.ticketNumber || `#${ticket.id}`}`}
                defaultBody={(() => {
                  const ref = ticket.ticketNumber || `#${ticket.id}`;
                  const customerDisplay = ticket.customerName || "Valued Customer";
                  const contactOnFile = [
                    ticket.contactEmail ? `Email: ${ticket.contactEmail}` : null,
                    ticket.contactPhone ? `Phone: ${ticket.contactPhone}` : null,
                  ].filter(Boolean).join("\n");
                  const contactSection = contactOnFile
                    ? `We currently have the following contact information on file:\n${contactOnFile}\n\nCould you please confirm this is the best way to reach you?`
                    : `Could you please reply with the best contact information (email and phone number) so we can keep you updated?`;
                  return `Dear ${customerDisplay},\n\nThank you for reaching out to Formic Technologies support.\n\nWe wanted to let you know that we have received your service request (${ref}) and our team is actively working on it.\n\n${contactSection}\n\nIf you have any additional details or questions, please don't hesitate to reply to this email.\n\nBest regards,\nFormic Technologies Support Team\nsupport@formic.co`;
                })()}
                ticketRef={ticket.ticketNumber || `#${ticket.id}`}
                customerName={ticket.customerName || "Valued Customer"}
                onSent={async (toAddr, sentSubject) => {
                  const historyEntry = {
                    text: `Email sent to ${toAddr} — "${sentSubject}"`,
                    updatedBy: loggedInUserName || "Unknown",
                    updatedAt: new Date().toISOString(),
                  };
                  const currentHistory = ticket.nextStepsHistory || [];
                  await updateMutation.mutateAsync({
                    id: ticket.id,
                    data: { nextStepsHistory: [...currentHistory, historyEntry] },
                  });
                }}
              />
            </div>
          </div>
        )}

        {!isEditing && (
          <>
            <FormField
              control={form.control}
              name="customerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Which customer?{!isEditing && <span className="text-red-500 ml-1">*</span>}</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      data-testid="select-customer"
                      value={field.value || undefined}
                      onValueChange={(val) => {
                        field.onChange(val);
                        form.setValue("systemId", undefined);
                        form.clearErrors("systemId");
                        setNewContactName("");
                        setNewContactPhone("");
                        setNewContactEmail("");
                        setAddingContact(false);
                        form.setValue("contactEmail", undefined);
                        form.setValue("contactPhone", undefined);
                      }}
                      options={[INTERNAL_ONLY_CUSTOMER, ...(options?.customers || []).filter(c => c !== INTERNAL_ONLY_CUSTOMER)]}
                      placeholder="Select option"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedCustomer !== INTERNAL_ONLY_CUSTOMER && (
              <FormField
                control={form.control}
                name="systemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Formic System ID{!isEditing && <span className="text-red-500 ml-1">*</span>}</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        data-testid="select-system-id"
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        options={filteredSystemIds}
                        placeholder="Select option"
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Select the Formic system this request is about</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium leading-none">Which contact?{!isEditing && <span className="text-red-500 ml-1">*</span>}</label>
                {selectedCustomer && !addingContact && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="button-add-new-contact"
                    className="h-7 text-xs gap-1 text-[#FF9100]"
                    onClick={() => setAddingContact(true)}
                  >
                    <Plus className="h-3 w-3" /> Add new
                  </Button>
                )}
                {addingContact && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="button-back-to-contacts"
                    className="h-7 text-xs gap-1"
                    onClick={() => setAddingContact(false)}
                  >
                    <ArrowLeft className="h-3 w-3" /> Back
                  </Button>
                )}
              </div>
              <div className="mt-2 space-y-2">
                {addingContact ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        data-testid="input-new-first-name"
                        placeholder="First name *"
                        className="bg-muted/50"
                        value={newFirstName}
                        onChange={(e) => setNewFirstName(e.target.value)}
                      />
                      <Input
                        data-testid="input-new-last-name"
                        placeholder="Last name *"
                        className="bg-muted/50"
                        value={newLastName}
                        onChange={(e) => setNewLastName(e.target.value)}
                      />
                    </div>
                    <Input
                      data-testid="input-new-email"
                      placeholder="Email"
                      type="email"
                      className="bg-muted/50"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                    />
                    <Input
                      data-testid="input-new-phone"
                      placeholder="Phone number"
                      className="bg-muted/50"
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                    />
                    <Button
                      type="button"
                      data-testid="button-save-new-contact"
                      className="w-full bg-[#FF9100] hover:bg-[#FF9100]/90 text-white"
                      disabled={!newFirstName.trim() || !newLastName.trim()}
                      onClick={async () => {
                        try {
                          const res = await fetch("/api/contacts", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({
                              firstName: newFirstName.trim(),
                              lastName: newLastName.trim(),
                              email: newEmail.trim() || undefined,
                              phone: newPhone.trim() || undefined,
                              customerName: selectedCustomer,
                            }),
                          });
                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.message);
                          }
                          const contact = await res.json();
                          setNewContactName(contact.name);
                          setNewContactEmail(contact.email || "");
                          setNewContactPhone(contact.phone || "");
                          if (contact.email) form.setValue("contactEmail", contact.email);
                          if (contact.phone) form.setValue("contactPhone", contact.phone);
                          setAddingContact(false);
                          setNewFirstName("");
                          setNewLastName("");
                          setNewEmail("");
                          setNewPhone("");
                          queryClient.invalidateQueries({ queryKey: ["/api/tickets/options"] });
                          toast({ title: "Contact added", description: `${contact.name} has been added to Airtable.` });
                        } catch (err: any) {
                          toast({ title: "Error", description: err.message || "Failed to create contact", variant: "destructive" });
                        }
                      }}
                    >
                      Save Contact to Airtable
                    </Button>
                  </>
                ) : filteredContacts.length > 0 ? (
                  <>
                    <SearchableSelect
                      key={selectedCustomer || "__no_customer__"}
                      data-testid="select-contact-name"
                      value={newContactName || undefined}
                      onValueChange={(val) => {
                        setNewContactName(val);
                        const contact = filteredContacts.find(c => c.name === val);
                        if (contact) {
                          setNewContactEmail(contact.email || "");
                          setNewContactPhone(contact.phone || "");
                          if (contact.email) form.setValue("contactEmail", contact.email);
                          if (contact.phone) form.setValue("contactPhone", contact.phone);
                        }
                      }}
                      options={filteredContacts.map(c => c.name)}
                      placeholder="Select a contact"
                    />
                    {newContactEmail && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                        <Mail className="h-3.5 w-3.5" />
                        <span data-testid="text-contact-email">{newContactEmail}</span>
                      </div>
                    )}
                    <Input
                      data-testid="input-contact-phone"
                      placeholder="Contact phone number"
                      className="bg-muted/50"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <Input
                      data-testid="input-contact-name"
                      placeholder={selectedCustomer ? "No contacts found — use Add new" : "Select a customer first"}
                      className="bg-muted/50"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                    />
                    <Input
                      data-testid="input-contact-email"
                      placeholder="Contact email"
                      type="email"
                      className="bg-muted/50"
                      value={newContactEmail}
                      onChange={(e) => {
                        setNewContactEmail(e.target.value);
                        form.setValue("contactEmail", e.target.value);
                      }}
                    />
                    <Input
                      data-testid="input-contact-phone"
                      placeholder="Contact phone number"
                      className="bg-muted/50"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                    />
                  </>
                )}
              </div>
            </div>

            <FormField
              control={form.control}
              name="commsDirection"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Comms direction?{!isEditing && <span className="text-red-500 ml-1">*</span>}</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      data-testid="select-comms-direction"
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                      options={COMMS_DIRECTIONS}
                      placeholder="Select option"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {!isEditing && (
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input data-testid="input-title" placeholder="Ticket title (or leave blank for AI-generated)" className="bg-muted/50" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {isEditing && (
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel>Title</FormLabel>
                  {titleRegenPending && (
                    <span className="flex items-center gap-1 text-[11px] text-orange-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Regenerating title…
                    </span>
                  )}
                </div>
                <FormControl>
                  <Input data-testid="input-title" placeholder="Ticket title" className="bg-muted/50" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>Enter description{!isEditing && <span className="text-red-500 ml-1">*</span>}</FormLabel>
                <button
                  type="button"
                  data-testid="button-ai-assist-description"
                  onClick={() => setDescAiOpen(true)}
                  className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  AI Assist
                </button>
              </div>
              <FormControl>
                <RichTextEditor
                  testId="input-description"
                  placeholder="Description of issue including fault, current status, and next steps when possible"
                  value={field.value || ""}
                  onChange={field.onChange}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">Description of issue including fault, current status, and next steps when possible</p>
              <FormMessage />
            </FormItem>
          )}
        />

        {!isEditing && (
          <>
            <FormField
              control={form.control}
              name="priorityLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What's the priority?{!isEditing && <span className="text-red-500 ml-1">*</span>}</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      data-testid="select-priority-label"
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                      options={options?.priorityLabels || []}
                      placeholder="Select option"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="estimatedNextUpdate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated Next Update<span className="text-red-500 ml-1">*</span></FormLabel>
                  <Popover open={newTicketDateOpen} onOpenChange={setNewTicketDateOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          data-testid="select-next-update-new"
                          variant="outline"
                          className="w-full justify-start text-left font-normal bg-muted/50"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                          {field.value ? format(new Date(field.value), "EEE MMM d, yyyy") : <span className="text-muted-foreground">Select date</span>}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value ? new Date(field.value) : undefined}
                        onSelect={(date) => {
                          field.onChange(date ?? null);
                          setNewTicketDateOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="escalationSource"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>How did you receive this escalation?{!isEditing && <span className="text-red-500 ml-1">*</span>}</FormLabel>
                  <FormControl>
                    <SearchableSelect
                      data-testid="select-escalation-source"
                      value={field.value || undefined}
                      onValueChange={field.onChange}
                      options={ESCALATION_SOURCES}
                      placeholder="Select option"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 gap-3 items-start">
              <FormField
                control={form.control}
                name="assigneeName"
                render={({ field }) => {
                  const assigneeList = options?.assignees || [];
                  const allAssignees = loggedInUserName && !assigneeList.includes(loggedInUserName)
                    ? [loggedInUserName, ...assigneeList]
                    : assigneeList;
                  return (
                    <FormItem>
                      <FormLabel>Assignee (required)</FormLabel>
                      <FormControl>
                        <SearchableSelect
                          data-testid="select-assignee"
                          value={field.value || undefined}
                          onValueChange={field.onChange}
                          options={allAssignees}
                          placeholder="Select user"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
              <FormField
                control={form.control}
                name="notifyNames"
                render={({ field }) => {
                  const assigneeList = options?.assignees || [];
                  const allAssignees = loggedInUserName && !assigneeList.includes(loggedInUserName)
                    ? [loggedInUserName, ...assigneeList]
                    : assigneeList;
                  return (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                        Notify
                      </FormLabel>
                      <FormControl>
                        <NotifySelect
                          options={allAssignees}
                          selected={field.value || []}
                          onChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  );
                }}
              />
            </div>
          </>
        )}

        {isEditing && (
          <>
            <div className="grid grid-cols-1 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-muted/50">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="priorityLabel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <FormControl>
                      <SearchableSelect
                        data-testid="select-edit-priority"
                        value={field.value || undefined}
                        onValueChange={field.onChange}
                        options={options?.priorityLabels || []}
                        placeholder="Select priority"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="estimatedNextUpdate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated Next Update</FormLabel>
                  <Popover open={editDateOpen} onOpenChange={setEditDateOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          data-testid="select-next-update"
                          variant="outline"
                          className="w-full justify-start text-left font-normal bg-muted/50"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4 opacity-70" />
                          {field.value ? format(new Date(field.value), "EEE MMM d, yyyy") : <span className="text-muted-foreground">No date set</span>}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                      <div className="p-2 border-b">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-muted-foreground text-xs"
                          onClick={() => { field.onChange(null); setEditDateOpen(false); }}
                        >
                          Clear date
                        </Button>
                      </div>
                      <Calendar
                        mode="single"
                        selected={field.value ? new Date(field.value) : undefined}
                        onSelect={(date) => {
                          field.onChange(date ?? null);
                          setEditDateOpen(false);
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {isEditing && userCanCloseThisTicket && showCloseForm && (
          <div ref={closeFormRef} className="space-y-3 p-4 rounded-lg border border-red-900/50 bg-red-950/20">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">Close Ticket</h4>
              <button
                type="button"
                data-testid="button-ai-assist-close"
                onClick={() => setCloseAiOpen(true)}
                className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                AI Assist
              </button>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Final determination of the issue <span className="text-red-500">*</span></label>
              <Textarea
                data-testid="input-final-determination"
                placeholder="What was the root cause or final determination?"
                className="resize-none h-20 bg-background"
                value={finalDetermination}
                onChange={(e) => setFinalDetermination(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Final solution <span className="text-red-500">*</span></label>
              <Textarea
                data-testid="input-final-solution"
                placeholder="How was the issue resolved?"
                className="resize-none h-20 bg-background"
                value={finalSolution}
                onChange={(e) => setFinalSolution(e.target.value)}
              />
            </div>

            {/* Bucket classification */}
            <div className="space-y-2 pt-1 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Problem Classification</span>
                <button
                  type="button"
                  data-testid="button-bucketize-ai"
                  onClick={handleBucketize}
                  disabled={bucketizing || !finalDetermination.trim() || !finalSolution.trim()}
                  className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 disabled:opacity-40 transition-colors"
                >
                  {bucketizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {bucketizing ? "Classifying..." : "Auto-classify with AI"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Issue type</label>
                  <Select
                    value={issueBucketId !== null ? String(issueBucketId) : ""}
                    onValueChange={(v) => setIssueBucketId(v ? Number(v) : null)}
                  >
                    <SelectTrigger data-testid="select-issue-bucket" className="h-8 text-xs bg-background">
                      <SelectValue placeholder="Select issue type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(bucketsData?.issueBuckets ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)} className="text-xs">
                          {b.name}
                          {b.count > 0 && <span className="text-muted-foreground ml-1">({b.count})</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bucketNewLabel?.issue && (
                    <p className="text-[10px] text-orange-400 flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" /> New bucket created: "{bucketNewLabel.issue}"
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Solution type</label>
                  <Select
                    value={solutionBucketId !== null ? String(solutionBucketId) : ""}
                    onValueChange={(v) => setSolutionBucketId(v ? Number(v) : null)}
                  >
                    <SelectTrigger data-testid="select-solution-bucket" className="h-8 text-xs bg-background">
                      <SelectValue placeholder="Select solution type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(bucketsData?.solutionBuckets ?? []).map((b) => (
                        <SelectItem key={b.id} value={String(b.id)} className="text-xs">
                          {b.name}
                          {b.count > 0 && <span className="text-muted-foreground ml-1">({b.count})</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bucketNewLabel?.solution && (
                    <p className="text-[10px] text-orange-400 flex items-center gap-1">
                      <Sparkles className="h-2.5 w-2.5" /> New bucket created: "{bucketNewLabel.solution}"
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="button-cancel-close"
                onClick={() => setShowCloseForm(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="button-confirm-close"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={isPending || !(finalDetermination.trim() || issueBucketId !== null) || !(finalSolution.trim() || solutionBucketId !== null)}
                onClick={handleCloseTicket}
              >
                {isPending ? "Closing..." : "Confirm & Close"}
              </Button>
            </div>
          </div>
        )}

        {/* Slack File Attachment */}
        <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <SiSlack className="h-4 w-4 text-[#4A154B]" />
            <span className="text-sm font-medium text-foreground/80">Attach file to Slack</span>
          </div>
          <input
            ref={fileInputRef}
            id="slack-file-input"
            type="file"
            data-testid="input-slack-file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setPendingFile(file);
              e.target.value = "";
            }}
          />
          {pendingFile ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground truncate max-w-[200px]">{pendingFile.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setPendingFile(null)}
              >
                <XIcon className="h-3 w-3" />
              </Button>
              {isEditing && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="button-upload-to-slack"
                  disabled={fileUploading}
                  className="h-7 text-xs"
                  onClick={() => uploadFileToTicket(pendingFile, ticket!.id)}
                >
                  {fileUploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                  {fileUploading ? "Uploading…" : "Upload now"}
                </Button>
              )}
              {!isEditing && (
                <span className="text-xs text-muted-foreground italic">(uploads when ticket is created)</span>
              )}
            </div>
          ) : (
            <label
              htmlFor="slack-file-input"
              data-testid="button-choose-slack-file"
              className="inline-flex items-center h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md cursor-pointer transition-colors"
            >
              <Paperclip className="h-3 w-3 mr-1" />
              Choose file…
            </label>
          )}
          {uploadedFiles.length > 0 && (
            <div className="space-y-1 pt-1">
              {uploadedFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3 flex-shrink-0" />
                  {f.permalink ? (
                    <a href={f.permalink} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-400 truncate max-w-[240px]">
                      {f.name}
                    </a>
                  ) : (
                    <span className="truncate max-w-[240px]">{f.name}</span>
                  )}
                  <span className="text-green-500 ml-1">✓</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-border/50">
          {isEditing && !ticket?.airtableRecordId && (
            <div className="flex items-center gap-2 shrink-0">
              {confirmDelete ? (
                <>
                  <span className="text-xs text-red-400">Delete permanently?</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    data-testid="button-confirm-delete-ticket"
                    disabled={deleteMutation.isPending}
                    onClick={async () => {
                      await deleteMutation.mutateAsync(ticket!.id);
                      onSuccess?.();
                    }}
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="button-delete-ticket"
                  className="text-red-400 hover:text-red-300 hover:bg-red-950/30"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 flex-1 min-w-0 justify-end items-center">
            {isEditing && (
              sentToProject ? (
                <div
                  data-testid="tracker-convert-project"
                  className="flex items-center gap-2 mr-auto"
                >
                  {(() => {
                    const step = projectStatus?.step ?? "scoping";
                    const isDone = projectStatus?.processed === true || step === "complete";
                    const LABELS: Record<string, string> = {
                      scoping: "Scoping",
                      resource_assignment: "Resources",
                      in_progress: "In Progress",
                      timeline_set: "Timeline",
                      complete: "Created",
                    };
                    const label = isDone ? "Created" : (LABELS[step] ?? "Scoping");
                    return (
                      <>
                        <span className="text-xs text-muted-foreground">Project:</span>
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{
                            background: isDone ? "#085041" : "#E1F5EE",
                            color: isDone ? "#ffffff" : "#085041",
                            border: `1px solid ${isDone ? "#085041" : "#5DCAA5"}`,
                          }}
                        >
                          {!isDone && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {isDone && <Check className="w-2.5 h-2.5" />}
                          {label}
                        </span>
                        {!isDone && (
                          <button
                            type="button"
                            onClick={markProjectComplete}
                            disabled={markingComplete}
                            className="text-[10px] font-medium underline underline-offset-2 opacity-40 hover:opacity-80 transition-opacity disabled:opacity-20"
                            style={{ color: "#085041" }}
                          >
                            {markingComplete ? "Marking…" : "Mark created ✓"}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="button-convert-project-form"
                  onClick={convertToProject}
                  disabled={sendingToProject || isPending}
                  className="inline-flex items-center px-3 py-1.5 rounded text-xs font-medium mr-auto transition-opacity disabled:opacity-50"
                  style={{ background: "#E1F5EE", color: "#085041", border: "1px solid #5DCAA5" }}
                >
                  {sendingToProject ? "Sending…" : "Convert to project"}
                </button>
              )
            )}
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
                Cancel
              </Button>
            )}
            <Button data-testid="button-submit" type="submit" disabled={isPending} className="min-w-[100px]">
              {isPending ? "Saving..." : isEditing ? "Save Changes" : "Create Ticket"}
            </Button>
            {!isEditing && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="button-info-only"
                      disabled={isPending || infoOnlyPending}
                      onClick={handleInfoOnlyClick}
                      className="min-w-[130px] border-blue-800 text-blue-400 hover:bg-blue-950/30 gap-1.5"
                    >
                      <Info className="h-3.5 w-3.5" />
                      Information Only
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-center text-xs">
                    This will open and immediately close the ticket for tracking purposes only
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {isEditing && userCanCloseThisTicket && ticket?.status === "open" && !showCloseForm && (
              <Button
                type="button"
                variant="outline"
                data-testid="button-close-ticket"
                className="min-w-[100px] border-red-800 text-red-400 hover:bg-red-950/30"
                disabled={isPending}
                onClick={() => {
                  setShowCloseForm(true);
                  setTimeout(() => closeFormRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
                }}
              >
                Close Ticket
              </Button>
            )}
            {isEditing && userCanCloseThisTicket && ticket?.status === "closed" && (
              <Button
                type="button"
                variant="outline"
                data-testid="button-reopen-ticket"
                className="min-w-[100px] border-green-800 text-green-400 hover:bg-green-950/30"
                disabled={isPending}
                onClick={handleReopenTicket}
              >
                {isPending ? "Reopening..." : "Reopen Ticket"}
              </Button>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="space-y-4 pt-2 border-t border-border/50">
            <FormField
              control={form.control}
              name="workOrderNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WO#</FormLabel>
                  <Input
                    {...field}
                    placeholder="Work order number or link (optional)"
                    value={field.value || ""}
                    data-testid="input-work-order"
                    className="bg-muted/50"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Can be a work order number or link (e.g., https://app.getmaintainx.com/workorders/87638858)</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Parts Order button */}
            <button
              type="button"
              data-testid="button-parts-order"
              onClick={async () => {
                setPoChannel(ticket?.csChannel?.replace(/^#/, "") || "");
                setPoAsaSys("");
                setPoWorkOrder(ticket?.ticketNumber || "");
                setPartsOrderOpen(true);
                const sysId = currentSystemId || ticket?.systemId;
                if (sysId) {
                  setPoAsaLoading(true);
                  try {
                    const res = await apiRequest("GET", `/api/system-asa/${encodeURIComponent(sysId)}`);
                    const data = await res.json();
                    if (data.asa) setPoAsaSys(data.asa);
                    else setPoAsaSys(sysId);
                  } catch {
                    setPoAsaSys(sysId);
                  } finally {
                    setPoAsaLoading(false);
                  }
                }
              }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium border transition-colors
                bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
            >
              <Package className="h-4 w-4 shrink-0" />
              Order Parts via Slack
            </button>

            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-foreground">Next Steps / Updates</h4>
              <button
                type="button"
                data-testid="button-ai-assist-next-steps"
                onClick={() => setNextStepsAiOpen(true)}
                className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 transition-colors"
              >
                <Sparkles className="h-3 w-3" />
                AI Assist
              </button>
            </div>
            <FormField
              control={form.control}
              name="nextSteps"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <MentionTextarea
                      data-testid="input-next-steps"
                      placeholder="Add an update... (type @ to mention someone)"
                      className="flex min-h-[80px] w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none h-20"
                      value={field.value ?? ""}
                      onChange={(val) => field.onChange(val)}
                      onBlur={field.onBlur}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Escalation Level */}
            {isEditing && ticket && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-current opacity-70" />
                    Escalation Level
                  </h4>
                  {!showEscalateForm && ticket.status !== "closed" && (() => {
                    const curIdx = ESCALATION_LEVELS.indexOf(currentEscalationLevel as EscalationLevel);
                    const canDeescalate = curIdx > 0;
                    const canEscalate = ESCALATION_LEVELS.some((l, i) => {
                      if (i <= curIdx) return false;
                      if (l === "Critical" && !canCriticalEscalate) return false;
                      if (l === "High" && !canSuperEscalate && curIdx < ESCALATION_LEVELS.indexOf("High")) return false;
                      return true;
                    });
                    if (!canDeescalate && !canEscalate) return null;
                    return (
                      <button
                        type="button"
                        data-testid="button-escalate"
                        onClick={() => { setShowEscalateForm(true); setEscalateLevel(""); setEscalateComment(""); }}
                        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                      >
                        <span className="text-[13px] leading-none">{canDeescalate ? "⇅" : "↑"}</span>
                        {canDeescalate ? "Adjust Level" : "Escalate"}
                      </button>
                    );
                  })()}
                </div>
                <div className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${escalationLevelColor(currentEscalationLevel)}`}>
                  {currentEscalationLevel}
                </div>
                {showEscalateForm && (() => {
                  const curIdx = ESCALATION_LEVELS.indexOf(currentEscalationLevel as EscalationLevel);
                  const newIdx = escalateLevel ? ESCALATION_LEVELS.indexOf(escalateLevel as EscalationLevel) : -1;
                  const isDeescalating = newIdx !== -1 && newIdx < curIdx;
                  const panelClass = isDeescalating
                    ? "border-blue-500/30 bg-blue-500/5"
                    : "border-amber-500/30 bg-amber-500/5";
                  const confirmClass = isDeescalating
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-amber-600 hover:bg-amber-700 text-white";
                  const confirmLabel = isDeescalating ? "Confirm De-escalation" : "Confirm Escalation";
                  return (
                    <div className={`rounded-md border ${panelClass} p-3 space-y-2.5 mt-1`}>
                      <p className="text-[11px] text-muted-foreground">Select the new escalation level and provide a reason.</p>
                      <div className="flex flex-wrap gap-2">
                        {ESCALATION_LEVELS.filter(l => {
                          if (l === currentEscalationLevel) return false;
                          const idx = ESCALATION_LEVELS.indexOf(l);
                          if (idx > curIdx) {
                            if (l === "Critical" && !canCriticalEscalate) return false;
                            if (l === "High" && !canSuperEscalate && curIdx < ESCALATION_LEVELS.indexOf("High")) return false;
                          }
                          return true;
                        }).map(level => (
                          <button
                            key={level}
                            type="button"
                            data-testid={`button-escalate-level-${level.toLowerCase()}`}
                            onClick={() => setEscalateLevel(level)}
                            className={`px-3 py-1 rounded-full border text-[11px] font-semibold transition-all ${escalateLevel === level ? escalationLevelColor(level) + " ring-1 ring-offset-1 ring-current" : "border-border/50 text-muted-foreground hover:border-border"}`}
                          >
                            {ESCALATION_LEVELS.indexOf(level as EscalationLevel) < curIdx ? "↓ " : "↑ "}{level}
                          </button>
                        ))}
                      </div>
                      <Textarea
                        data-testid="input-escalate-comment"
                        placeholder="Reason for level change (required)…"
                        className="resize-none h-16 bg-muted/50 text-xs"
                        value={escalateComment}
                        onChange={e => setEscalateComment(e.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid="button-escalate-cancel"
                          onClick={() => setShowEscalateForm(false)}
                          disabled={escalatePending}
                          className="text-xs h-7"
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          data-testid="button-escalate-confirm"
                          disabled={escalatePending || !escalateLevel || !escalateComment.trim()}
                          onClick={handleEscalateSubmit}
                          className={`text-xs h-7 ${confirmClass}`}
                        >
                          {escalatePending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Saving…</> : confirmLabel}
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {isEditing && (
              <TagsEditor
                tags={ticket?.tags ?? []}
                allTags={allTagsData ?? []}
                onTagsChange={async (newTags) => {
                  await updateMutation.mutateAsync({
                    id: ticket!.id,
                    data: { tags: newTags as any },
                  });
                  await queryClient.invalidateQueries({ queryKey: ["/api/tickets/tags"] });
                }}
              />
            )}

            {ticket!.nextStepsHistory && ticket!.nextStepsHistory.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Update History
                </h4>
                <div className="max-h-[250px] overflow-y-auto overflow-x-hidden space-y-0 rounded-md border border-border/60 bg-muted/20">
                  {[...ticket!.nextStepsHistory].reverse().map((entry, i) => {
                    const isPriorityChange =
                      entry.text?.startsWith("Priority changed from") ||
                      entry.text?.startsWith("Priority set to") ||
                      entry.text?.startsWith("Priority cleared");
                    const isAssigneeChange = entry.text?.startsWith("Assignee changed");
                    const isStatusChange =
                      entry.text?.startsWith("Ticket closed") ||
                      entry.text?.startsWith("Ticket reopened") ||
                      entry.text?.startsWith("Status changed");
                    const isCustomerChange = entry.text?.startsWith("Customer changed");
                    const isEmailSent = entry.text?.startsWith("Email sent to");
                    const isSlackNotif = entry.text?.startsWith("Slack notification sent to");
                    const isAirtableWarn = entry.text?.startsWith("⚠ Airtable");
                    const isEscalation = entry.text?.startsWith("Escalation changed from");
                    const formattedTime = (() => {
                      try {
                        return new Date(entry.updatedAt).toLocaleString("en-US", {
                          timeZone: "America/Chicago",
                          month: "numeric",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        }) + " CST";
                      } catch {
                        return entry.updatedAt;
                      }
                    })();

                    const tagLabel = isPriorityChange ? "Priority"
                      : isAssigneeChange ? "Assignee"
                      : isStatusChange ? "Status"
                      : isCustomerChange ? "Customer"
                      : isEmailSent ? "Email"
                      : isSlackNotif ? "Slack"
                      : isAirtableWarn ? "Sync Warning"
                      : isEscalation ? "Escalation"
                      : null;

                    const tagColor = isPriorityChange ? "text-[#FF9100]"
                      : isAssigneeChange ? "text-blue-500"
                      : isStatusChange ? "text-green-600"
                      : isCustomerChange ? "text-purple-500"
                      : isEmailSent ? "text-sky-500"
                      : isSlackNotif ? "text-[#4A154B]"
                      : isAirtableWarn ? "text-red-500"
                      : isEscalation ? "text-amber-500"
                      : "";

                    const bgColor = isPriorityChange ? "bg-orange-500/5"
                      : isAssigneeChange ? "bg-blue-500/5"
                      : isStatusChange ? "bg-green-500/5"
                      : isCustomerChange ? "bg-purple-500/5"
                      : isEmailSent ? "bg-sky-500/5"
                      : isSlackNotif ? "bg-purple-500/5"
                      : isAirtableWarn ? "bg-red-500/5"
                      : isEscalation ? "bg-amber-500/5"
                      : "";

                    const textColor = isPriorityChange ? "text-[#FF9100]/80 font-medium"
                      : isAssigneeChange ? "text-blue-600/80 font-medium"
                      : isStatusChange ? "text-green-700/80 font-medium"
                      : isCustomerChange ? "text-purple-600/80 font-medium"
                      : isEmailSent ? "text-sky-600/80 font-medium"
                      : isSlackNotif ? "text-purple-700/80 font-medium"
                      : isAirtableWarn ? "text-red-600/80 font-medium"
                      : isEscalation ? "text-amber-600/80 font-medium"
                      : "text-foreground/80";

                    // For Slack entries, split "description — url" so the link is clickable
                    const slackParts = isSlackNotif && entry.text
                      ? (() => {
                          const sepIdx = entry.text.indexOf(" — ");
                          if (sepIdx === -1) return null;
                          return {
                            label: entry.text.slice(0, sepIdx),
                            url: entry.text.slice(sepIdx + 3),
                          };
                        })()
                      : null;

                    return (
                      <div key={i} data-testid={`history-entry-${i}`} className={`text-xs border-b border-border/30 last:border-0 p-2.5 ${bgColor}`}>
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          {tagLabel && (
                            <span className={`${tagColor} font-semibold text-[10px] uppercase tracking-wide`}>{tagLabel}</span>
                          )}
                          <span className="font-medium text-foreground">{entry.updatedBy}</span>
                          <span>·</span>
                          <span>{formattedTime}</span>
                        </div>
                        {slackParts ? (
                          <p className={`${textColor}`}>
                            {slackParts.label}{" — "}
                            <a
                              href={slackParts.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline hover:opacity-70"
                              data-testid="link-slack-history"
                            >
                              View in Slack
                            </a>
                          </p>
                        ) : (
                          <p className={`whitespace-pre-wrap break-words ${textColor}`}>
                            {entry.text}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isEditing && ticket?.status === "closed" && ticket.id && (
              <PriorityHistoryBreakdown ticketId={ticket.id} />
            )}

            {isEditing && ticket?.status === "closed" && (
              <ClosedTicketBucketEditor
                ticket={ticket}
                bucketsData={bucketsData}
                issueBucketId={issueBucketId}
                setIssueBucketId={setIssueBucketId}
                solutionBucketId={solutionBucketId}
                setSolutionBucketId={setSolutionBucketId}
                onSave={async (newIssueBucketId, newSolutionBucketId) => {
                  await updateMutation.mutateAsync({
                    id: ticket.id,
                    data: {
                      issueBucketId: newIssueBucketId as any,
                      solutionBucketId: newSolutionBucketId as any,
                    },
                  });
                  await queryClient.invalidateQueries({ queryKey: ["/api/buckets"] });
                }}
              />
            )}
          </div>
        )}
      </form>

      {/* Information Only Dialog */}
      <Dialog open={showInfoOnlyDialog} onOpenChange={(v) => { if (!v && !infoOnlyPending) setShowInfoOnlyDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-4 w-4 text-blue-400" />
              Information Only — Close Details
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            This ticket will be created and immediately closed for tracking purposes. Please provide the resolution details below.
          </p>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Final determination of the issue</label>
              <Textarea
                data-testid="input-info-only-determination"
                placeholder="What was the root cause or final determination?"
                className="resize-none h-20 bg-muted/50 text-sm"
                value={infoOnlyDetermination}
                onChange={(e) => setInfoOnlyDetermination(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-muted-foreground">Final solution</label>
              <Textarea
                data-testid="input-info-only-solution"
                placeholder="How was the issue resolved?"
                className="resize-none h-20 bg-muted/50 text-sm"
                value={infoOnlySolution}
                onChange={(e) => setInfoOnlySolution(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="button-info-only-cancel"
                onClick={() => setShowInfoOnlyDialog(false)}
                disabled={infoOnlyPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="button-info-only-confirm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                disabled={infoOnlyPending || !infoOnlyDetermination.trim() || !infoOnlySolution.trim()}
                onClick={handleInfoOnlyConfirm}
              >
                {infoOnlyPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Creating…</> : <><Check className="h-3.5 w-3.5 mr-1.5" />Create & Close</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AI Assist Panels */}
      <AiAssistPanel
        open={descAiOpen}
        onClose={() => setDescAiOpen(false)}
        mode="description"
        context={{
          ticketTitle: form.getValues("title") ?? undefined,
          customerName: form.getValues("customerName") ?? undefined,
          systemId: form.getValues("systemId") ?? undefined,
          assigneeName: form.getValues("assigneeName") ?? undefined,
        }}
        onAccept={(text) => form.setValue("description", text, { shouldDirty: true })}
        initialText={(() => {
          const raw = form.getValues("description") || "";
          const div = typeof document !== "undefined" ? document.createElement("div") : null;
          if (div) { try { div.innerHTML = raw; } catch { /* ignore */ } return div.textContent || div.innerText || ""; }
          return raw.replace(/<[^>]*>/g, "");
        })()}
      />
      <AiAssistPanel
        open={nextStepsAiOpen}
        onClose={() => setNextStepsAiOpen(false)}
        mode="next-steps"
        context={{
          ticketTitle: form.getValues("title") ?? undefined,
          customerName: form.getValues("customerName") ?? undefined,
          systemId: form.getValues("systemId") ?? undefined,
          assigneeName: form.getValues("assigneeName") ?? undefined,
        }}
        onAccept={(text) => form.setValue("nextSteps", text, { shouldDirty: true })}
        initialText={form.getValues("nextSteps") || ""}
      />
      <CloseTicketAiPanel
        open={closeAiOpen}
        onClose={() => setCloseAiOpen(false)}
        context={{
          ticketTitle: form.getValues("title") ?? undefined,
          customerName: form.getValues("customerName") ?? undefined,
          description: form.getValues("description") ?? undefined,
        }}
        onAccept={(det, sol) => {
          setFinalDetermination(det);
          setFinalSolution(sol);
        }}
      />

      {/* Parts Order Dialog */}
      <Dialog open={partsOrderOpen} onOpenChange={(open) => {
        setPartsOrderOpen(open);
        if (!open) { setPoMessageUrl(null); setPoWorkflowUrl(null); partsOrderMutation.reset(); }
      }}>
        <DialogContent className="max-w-lg bg-[#0f1923] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Package className="h-5 w-5 text-amber-400" />
              Parts Order Request
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Customer CS Channel */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-white">Customer CS Channel</label>
              {slackChannels.length > 0 ? (
                <select
                  data-testid="select-po-channel"
                  value={poChannel}
                  onChange={(e) => setPoChannel(e.target.value)}
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                  style={{ WebkitAppearance: "none" }}
                >
                  <option value="">Select a channel…</option>
                  {slackChannels.map((ch) => (
                    <option key={ch.id} value={ch.id} className="bg-[#0f1923]">
                      #{ch.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  data-testid="input-po-channel"
                  type="text"
                  value={poChannel}
                  onChange={(e) => setPoChannel(e.target.value)}
                  placeholder="Channel ID or name"
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                />
              )}
              <p className="text-xs text-white/40">Type customer name here.</p>
            </div>

            {/* ASA or SYS # */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-white">ASA or SYS #</label>
              <div className="relative">
                <input
                  data-testid="input-po-asa-sys"
                  type="text"
                  value={poAsaSys}
                  onChange={(e) => setPoAsaSys(e.target.value)}
                  placeholder={poAsaLoading ? "Looking up ASA…" : "ASA #, SYS ID, etc."}
                  disabled={poAsaLoading}
                  className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50 disabled:opacity-60"
                />
                {poAsaLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                  </div>
                )}
              </div>
              <p className="text-xs text-white/40">ASA #, SYS ID, etc.</p>
            </div>

            {/* Brand, Vendor, Part Number */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-white">Brand, Vendor, Part Number</label>
              <input
                data-testid="input-po-vendor-part"
                type="text"
                value={poVendorPart}
                onChange={(e) => setPoVendorPart(e.target.value)}
                placeholder="Write something"
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <p className="text-xs text-white/40">All or some…the more I have the faster it ships.</p>
            </div>

            {/* Part Description */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-white">Part Description</label>
              <textarea
                data-testid="input-po-description"
                value={poDescription}
                onChange={(e) => setPoDescription(e.target.value)}
                placeholder="Write something"
                rows={3}
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50 resize-none"
              />
              <p className="text-xs text-white/40">NUC, 3&#39; Ethernet cable, 58mm cup, add a picture.</p>
            </div>

            {/* Need by date */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-white">
                Need by date <span className="font-normal text-white/40">(optional)</span>
              </label>
              <input
                data-testid="input-po-need-by"
                type="date"
                value={poNeedByDate}
                onChange={(e) => setPoNeedByDate(e.target.value)}
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-400/50"
                style={{ colorScheme: "dark" }}
              />
            </div>

            {/* Work Order Number or Link */}
            <div className="space-y-1">
              <label className="text-sm font-semibold text-white">Work Order Number or Link</label>
              <input
                data-testid="input-po-work-order"
                type="text"
                value={poWorkOrder}
                onChange={(e) => setPoWorkOrder(e.target.value)}
                placeholder="Write something"
                className="w-full rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
            </div>

            {/* Success state */}
            {poMessageUrl && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <Check className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-300">Parts order sent to Slack</p>
                  <a
                    href={poMessageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-po-slack-message"
                    className="flex items-center gap-1 mt-1 text-xs text-[#4A9EFF] hover:underline"
                  >
                    <SiSlack className="h-3 w-3" />
                    View message in Slack
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {poWorkflowUrl && (
                    <a
                      href={poWorkflowUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="link-po-workflow"
                      className="flex items-center gap-1 mt-1 text-xs text-amber-300 hover:underline"
                    >
                      <SiSlack className="h-3 w-3" />
                      Open Parts Order Workflow in Slack
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-white/10">
              <button
                type="button"
                data-testid="button-po-cancel"
                onClick={() => setPartsOrderOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-white/15 text-white/70 hover:bg-white/5 transition-colors"
              >
                Close
              </button>
              {!poMessageUrl && (
                <button
                  type="button"
                  data-testid="button-po-submit"
                  disabled={!poChannel || partsOrderMutation.isPending}
                  onClick={() => partsOrderMutation.mutate()}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-[#1a8a1a] text-white hover:bg-[#1a8a1a]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {partsOrderMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <SiSlack className="h-4 w-4" />
                  )}
                  Submit
                </button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Form>
  );
}
