import { useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { changelog, majorFunctions, minorFeatures, formatTokens, type ChangeType } from "@/data/changelog";
import { ChevronDown, ChevronRight, Zap, Puzzle, History, BookOpen } from "lucide-react";

function VersionBadge({ type }: { type: ChangeType }) {
  const styles: Record<ChangeType, string> = {
    Major: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    Minor: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    Patch: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700",
  };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${styles[type]}`}>
      {type}
    </span>
  );
}

function StatusDot({ status }: { status: "Live" | "Beta" | "Planned" }) {
  const styles = {
    Live: "bg-green-500",
    Beta: "bg-yellow-400",
    Planned: "bg-zinc-400",
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${styles[status]} mt-[5px] flex-shrink-0`} />;
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-mono leading-none">
      <span className="text-muted-foreground/60">{label}</span>
      <span className="font-semibold text-foreground/70">{value}</span>
    </span>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[#FF9100]">{icon}</span>
      <h3 className="text-sm font-semibold text-foreground tracking-wide uppercase">{title}</h3>
    </div>
  );
}

export function DevChangesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set([changelog[0]?.version]));
  const [, setLocation] = useLocation();

  const totalMajorTokens = majorFunctions.reduce((s, f) => s + f.tokenCount, 0);
  const totalMinorTokens = minorFeatures.reduce((s, f) => s + f.tokenCount, 0);

  const toggleVersion = (version: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      next.has(version) ? next.delete(version) : next.add(version);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-[#FF9100]/10 flex items-center justify-center">
              <History className="h-4 w-4 text-[#FF9100]" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base font-semibold">Dev Changes</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Internal development summary · Formic ISR Tracker</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <MetaPill label="total tokens" value={`~${formatTokens(totalMajorTokens + totalMinorTokens)}`} />
              <button
                onClick={() => { onOpenChange(false); setLocation("/sop"); }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted hover:bg-muted/70 text-[11px] font-medium text-foreground/70 hover:text-foreground transition-colors"
                title="Open Ticketing SOP"
                data-testid="button-open-sop"
              >
                <BookOpen className="h-3.5 w-3.5 text-[#FF9100]" />
                Ticketing SOP
              </button>
            </div>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-8">

          {/* Major Functions */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader icon={<Zap className="h-4 w-4" />} title="Major Functions" />
              <div className="flex items-center gap-2">
                <MetaPill label="tokens" value={`~${formatTokens(totalMajorTokens)}`} />
              </div>
            </div>
            <div className="space-y-2">
              {majorFunctions.map(fn => (
                <div
                  key={fn.name}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
                >
                  <StatusDot status={fn.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{fn.name}</span>
                      {fn.status !== "Live" && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          {fn.status}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{fn.description}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                    <MetaPill label="" value={`${formatTokens(fn.tokenCount)} tok`} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Minor Features */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <SectionHeader icon={<Puzzle className="h-4 w-4" />} title="Minor Features" />
              <div className="flex items-center gap-2">
                <MetaPill label="tokens" value={`~${formatTokens(totalMinorTokens)}`} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {minorFeatures.map(f => (
                <div
                  key={f.name}
                  className="px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-foreground leading-snug">{f.name}</p>
                    <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                      <MetaPill label="" value={`${formatTokens(f.tokenCount)} tok`} />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{f.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Version History */}
          <section>
            <SectionHeader icon={<History className="h-4 w-4" />} title="Version History" />
            <div className="space-y-2">
              {changelog.map(entry => {
                const isOpen = expandedVersions.has(entry.version);
                return (
                  <div key={entry.version} className="rounded-lg border border-border bg-card overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
                      onClick={() => toggleVersion(entry.version)}
                      data-testid={`dev-version-${entry.version}`}
                    >
                      {isOpen
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      }
                      <span className="text-xs font-mono font-semibold text-foreground w-10 flex-shrink-0">
                        v{entry.version}
                      </span>
                      <VersionBadge type={entry.type} />
                      <span className="text-xs font-medium text-foreground flex-1 truncate">{entry.title}</span>
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">{entry.date}</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 pt-0.5 border-t border-border/60">
                        <ul className="space-y-1 mt-2">
                          {entry.changes.map((change, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              <span className="text-[#FF9100] mt-0.5 flex-shrink-0">·</span>
                              <span className="leading-snug">{change}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <p className="text-[11px] text-muted-foreground/60 text-center pb-1">
            Token counts derived from actual file sizes (chars ÷ 4).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
