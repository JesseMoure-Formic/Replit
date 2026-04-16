import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MentionTextarea } from "@/components/mention-textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { MapPin, Loader2, BookOpen, Save, Trash2, Globe, User, Ticket, ChevronDown } from "lucide-react";
import type { CheckInTemplate } from "@shared/schema";

const SPECIAL_OPTIONS = ["Remote Support", "In office (ORD)", "In office (OAK)", "Traveling"];
const REMOTE_SUPPORT = "Remote Support";

function isOfficeOption(c: string) {
  return c === "In office (ORD)" || c === "In office (OAK)" || c === "Traveling";
}

interface SiteEntry { systemId: string; csChannel: string | null; region: string | null; }
interface OpenTicket { id: number; ticketNumber: string | null; title: string | null; priority: string | null; priorityLabel: string | null; assigneeName: string | null; slackMessageId: string | null; }

interface CheckInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SaveTemplateState {
  open: boolean;
  name: string;
  isGlobal: boolean;
}

export function CheckInDialog({ open, onOpenChange }: CheckInDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const defaultName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email?.split("@")[0] || "";
  const isAdmin = user?.email === "jmoure@formic.co";

  const [visitorName, setVisitorName] = useState("");
  const [customer, setCustomer] = useState("");
  const [systemId, setSystemId] = useState("");
  const [notes, setNotes] = useState("");
  const [targetTicketIds, setTargetTicketIds] = useState<number[]>([]);
  const [saveTemplate, setSaveTemplate] = useState<SaveTemplateState>({ open: false, name: "", isGlobal: false });
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  const isRemoteSupport = customer.trim() === REMOTE_SUPPORT;
  const isOfficeWork = isOfficeOption(customer.trim());
  const isSpecial = isRemoteSupport || isOfficeWork;
  const resolvedSystemId = isSpecial ? "" : systemId.trim();

  useEffect(() => {
    if (open && defaultName && !visitorName) {
      setVisitorName(defaultName);
    }
  }, [open, defaultName]);

  useEffect(() => {
    setTargetTicketIds([]);
  }, [systemId]);

  const { data: sitesMap = {} } = useQuery<Record<string, SiteEntry[]>>({
    queryKey: ["/api/check-in/sites"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: options } = useQuery<{ assignees: string[] }>({
    queryKey: ["/api/tickets/options"],
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery<CheckInTemplate[]>({
    queryKey: ["/api/check-in/templates"],
    enabled: open,
    staleTime: 60 * 1000,
  });

  const { data: openTickets = [], isLoading: ticketsLoading } = useQuery<OpenTicket[]>({
    queryKey: ["/api/check-in/open-tickets", resolvedSystemId],
    queryFn: () => fetch(`/api/check-in/open-tickets?systemId=${encodeURIComponent(resolvedSystemId)}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!resolvedSystemId,
    staleTime: 30 * 1000,
  });

  const assignees: string[] = useMemo(
    () => (options?.assignees ?? []).filter(Boolean).sort(),
    [options]
  );

  const customers = useMemo(
    () => [...SPECIAL_OPTIONS, ...Object.keys(sitesMap).sort()],
    [sitesMap]
  );

  const matchedCustomerSystems: SiteEntry[] = useMemo(() => {
    if (!customer.trim() || isSpecial) return [];
    if (sitesMap[customer]) return sitesMap[customer];
    const key = Object.keys(sitesMap).find(k => k.toLowerCase().includes(customer.toLowerCase()));
    return key ? sitesMap[key] : [];
  }, [sitesMap, customer, isSpecial]);

  const allSystemIds: string[] = useMemo(() => {
    return matchedCustomerSystems.map(s => s.systemId);
  }, [matchedCustomerSystems]);

  const selectedSite = useMemo(() => {
    if (isSpecial) return null;
    return matchedCustomerSystems.find(s => s.systemId === systemId) || null;
  }, [matchedCustomerSystems, systemId, isSpecial]);

  const systemMismatch = useMemo(() => {
    if (isSpecial || !customer.trim() || !systemId.trim()) return false;
    if (matchedCustomerSystems.length === 0) return false;
    return !matchedCustomerSystems.some(s => s.systemId === systemId);
  }, [isSpecial, customer, systemId, matchedCustomerSystems]);

  const personalTemplates = templates.filter(t => !t.isGlobal);
  const globalTemplates = templates.filter(t => t.isGlobal);

  const handleCustomerChange = (val: string) => {
    setCustomer(val);
    setSystemId("");
  };

  const toggleTicket = (id: number) => {
    setTargetTicketIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const reset = () => {
    setCustomer("");
    setSystemId("");
    setNotes("");
    setTargetTicketIds([]);
    setVisitorName(defaultName);
    setSaveTemplate({ open: false, name: "", isGlobal: false });
    setTemplatePopoverOpen(false);
  };

  const loadTemplate = (content: string) => {
    setNotes(content);
    setTemplatePopoverOpen(false);
  };

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/check-in", {
        visitorName,
        customerName: customer,
        systemId: isSpecial ? "N/A" : systemId,
        notes: notes.trim() || undefined,
        targetTicketIds,
        csChannel: selectedSite?.csChannel || null,
        region: selectedSite?.region || null,
        isOfficeWork,
      }),
    onSuccess: (data: any) => {
      const ticketsUpdated: number = data?.ticketsUpdated ?? 0;
      const threadRepliesSent: number = data?.threadRepliesSent ?? 0;
      let desc: string;
      if (isOfficeWork) {
        desc = `Office presence logged to Slack (${customer})`;
      } else {
        const parts = [`Slack notification sent for ${customer}${!isRemoteSupport && systemId ? ` — ${systemId}` : ""}`];
        if (ticketsUpdated > 0) parts.push(`Updated ${ticketsUpdated} open ticket${ticketsUpdated !== 1 ? "s" : ""}`);
        if (threadRepliesSent > 0) parts.push(`Thread reply sent for ${threadRepliesSent} ticket${threadRepliesSent !== 1 ? "s" : ""}`);
        desc = parts.join(" · ");
      }
      toast({ title: "Checked in!", description: desc });
      onOpenChange(false);
      reset();
    },
    onError: (err: any) => {
      toast({ title: "Check-in failed", description: err.message || "Could not send Slack notification", variant: "destructive" });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/check-in/templates", {
        name: saveTemplate.name.trim(),
        content: notes.trim(),
        isGlobal: saveTemplate.isGlobal,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/check-in/templates"] });
      toast({ title: "Template saved" });
      setSaveTemplate({ open: false, name: "", isGlobal: false });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save template", description: err.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/check-in/templates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/check-in/templates"] });
    },
  });

  const canSubmit = visitorName.trim() && customer.trim() && (isSpecial || systemId.trim()) && !systemMismatch && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[#FF9100]" />
            Site Check-In
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Visitor name */}
          <div className="space-y-1.5">
            <Label htmlFor="checkin-visitor">Who is visiting?</Label>
            {isAdmin ? (
              <>
                <datalist id="checkin-visitor-list">
                  {assignees.map(name => <option key={name} value={name} />)}
                </datalist>
                <Input
                  id="checkin-visitor"
                  data-testid="input-checkin-visitor"
                  list="checkin-visitor-list"
                  value={visitorName}
                  onChange={e => setVisitorName(e.target.value)}
                  placeholder="Type or select a name…"
                  autoComplete="off"
                />
              </>
            ) : (
              <Input
                id="checkin-visitor"
                data-testid="input-checkin-visitor"
                value={visitorName}
                disabled
                className="opacity-70 cursor-not-allowed"
              />
            )}
          </div>

          {/* Customer / Location */}
          <div className="space-y-1.5">
            <Label htmlFor="checkin-customer">
              Customer / Location <span className="text-destructive">*</span>
            </Label>
            <datalist id="checkin-customer-list">
              {customers.map(c => <option key={c} value={c} />)}
            </datalist>
            <Input
              id="checkin-customer"
              data-testid="input-checkin-customer"
              list="checkin-customer-list"
              value={customer}
              onChange={e => handleCustomerChange(e.target.value)}
              placeholder="Type or select a customer…"
              autoComplete="off"
            />
          </div>

          {/* System ID — hidden for special options */}
          {!isSpecial && (
            <div className="space-y-1.5">
              <Label htmlFor="checkin-system">System ID</Label>
              <datalist id="checkin-system-list">
                {allSystemIds.map(id => <option key={id} value={id} />)}
              </datalist>
              <Input
                id="checkin-system"
                data-testid="input-checkin-system"
                list="checkin-system-list"
                value={systemId}
                onChange={e => setSystemId(e.target.value)}
                placeholder={allSystemIds.length > 0 ? `${allSystemIds.length} system${allSystemIds.length !== 1 ? "s" : ""} available…` : "Type or select a system ID…"}
                autoComplete="off"
                className={systemMismatch ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {systemMismatch && (
                <p className="text-xs text-destructive">
                  "{systemId}" does not belong to {customer}. Please select one of the systems above.
                </p>
              )}
              {!systemMismatch && allSystemIds.length > 0 && systemId && selectedSite && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Matches {customer}</p>
              )}
            </div>
          )}

          {selectedSite?.region && (
            <p className="text-xs text-muted-foreground -mt-2">
              Region: <span className="font-medium">{selectedSite.region}</span>
              {selectedSite.csChannel && <> · Slack: <span className="font-medium font-mono">{selectedSite.csChannel}</span></>}
            </p>
          )}

          {/* Open tickets for this system */}
          {resolvedSystemId && (
            <div className="space-y-1.5">
              <Label className="flex items-start gap-1.5 flex-wrap">
                <span className="flex items-center gap-1.5 shrink-0">
                  <Ticket className="h-3.5 w-3.5" />
                  Open Tickets for {resolvedSystemId}
                </span>
                <span className="text-xs text-muted-foreground font-normal">(check if this visit targets a ticket)</span>
              </Label>
              {ticketsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading tickets…
                </div>
              ) : openTickets.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No open tickets for this system.</p>
              ) : (
                <div className="border rounded-md divide-y">
                  {openTickets.map(t => (
                    <label
                      key={t.id}
                      className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-accent/40 transition-colors"
                      data-testid={`checkin-ticket-${t.id}`}
                    >
                      <Checkbox
                        id={`ticket-${t.id}`}
                        checked={targetTicketIds.includes(t.id)}
                        onCheckedChange={() => toggleTicket(t.id)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">{t.ticketNumber || `#${t.id}`}</span>
                          {(t.priorityLabel || t.priority) && (
                            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {t.priorityLabel || t.priority}
                            </span>
                          )}
                          {!t.slackMessageId && (
                            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded">no Slack thread</span>
                          )}
                        </div>
                        <p className="text-sm font-medium leading-snug mt-0.5 truncate">{t.title || "(no title)"}</p>
                        {t.assigneeName && (
                          <p className="text-xs text-muted-foreground mt-0.5">Assigned: {t.assigneeName}</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Notes with template support ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="checkin-notes">Notes</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="button-load-template"
                className="h-7 text-xs px-2 gap-1 border-dashed"
                onClick={() => setTemplatePopoverOpen(v => !v)}
              >
                <BookOpen className="h-3 w-3" />
                Templates
                <ChevronDown className={`h-3 w-3 opacity-60 transition-transform ${templatePopoverOpen ? "rotate-180" : ""}`} />
              </Button>
            </div>

            {templatePopoverOpen && (
              <div className="rounded-md border bg-muted/20">
                {templatesLoading ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                  </div>
                ) : templates.length === 0 ? (
                  <div className="p-3 text-center">
                    <p className="text-xs text-muted-foreground">No templates yet. Type a note below and save it as a template.</p>
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto divide-y">
                    {personalTemplates.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 bg-muted/40">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Personal</p>
                        </div>
                        {personalTemplates.map(t => (
                          <div key={t.id} className="flex items-center justify-between px-3 py-2 hover:bg-accent cursor-pointer group">
                            <button
                              type="button"
                              className="flex-1 text-left"
                              onClick={() => loadTemplate(t.content)}
                            >
                              <p className="text-sm font-medium">{t.name}{t.userName ? ` - ${t.userName}` : ""}</p>
                              <p className="text-xs text-muted-foreground truncate">{t.content}</p>
                            </button>
                            <button
                              type="button"
                              className="ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive text-muted-foreground"
                              onClick={() => deleteTemplateMutation.mutate(t.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                    {globalTemplates.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 bg-muted/40">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" /> Global</p>
                        </div>
                        {globalTemplates.map(t => (
                          <div key={t.id} className="flex items-center justify-between px-3 py-2 hover:bg-accent cursor-pointer group">
                            <button
                              type="button"
                              className="flex-1 text-left"
                              onClick={() => loadTemplate(t.content)}
                            >
                              <p className="text-sm font-medium">{t.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{t.content}</p>
                              {t.userName && <p className="text-xs text-muted-foreground/70 mt-0.5">by {t.userName}</p>}
                            </button>
                            {t.userId === user?.id && (
                              <button
                                type="button"
                                className="ml-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive text-muted-foreground"
                                onClick={() => deleteTemplateMutation.mutate(t.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <MentionTextarea
              data-testid="input-checkin-notes"
              value={notes}
              onChange={setNotes}
              placeholder="Optional — purpose of visit, systems to check, etc. (type @ or # to mention)"
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
            />

            {notes.trim() && !saveTemplate.open && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground px-2"
                onClick={() => setSaveTemplate({ open: true, name: "", isGlobal: false })}
              >
                <Save className="h-3 w-3 mr-1" /> Save as template
              </Button>
            )}

            {saveTemplate.open && (
              <div className="border rounded-md p-3 space-y-2 bg-muted/30">
                <Input
                  placeholder="Template name…"
                  value={saveTemplate.name}
                  onChange={e => setSaveTemplate(s => ({ ...s, name: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-template-name"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter" && saveTemplate.name.trim()) saveTemplateMutation.mutate(); }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSaveTemplate(s => ({ ...s, isGlobal: false }))}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${!saveTemplate.isGlobal ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}
                  >
                    <User className="h-3 w-3" /> Personal
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaveTemplate(s => ({ ...s, isGlobal: true }))}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${saveTemplate.isGlobal ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}
                  >
                    <Globe className="h-3 w-3" /> Global
                  </button>
                  <div className="flex-1" />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!saveTemplate.name.trim() || saveTemplateMutation.isPending}
                    onClick={() => saveTemplateMutation.mutate()}
                  >
                    {saveTemplateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setSaveTemplate({ open: false, name: "", isGlobal: false })}
                  >
                    Cancel
                  </Button>
                </div>
                {saveTemplate.isGlobal && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" /> Visible to all team members · your name will be shown
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { onOpenChange(false); reset(); }} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="button-checkin-confirm"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="bg-[#FF9100] hover:bg-[#FF9100]/90 text-white"
          >
            {mutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</> : "Check In"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
