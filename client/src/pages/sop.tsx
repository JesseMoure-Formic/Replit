import { Link } from "wouter";
import { FormicMark } from "@/components/formic-logo";
import { ArrowLeft, BookOpen, LogIn, Search, Plus, Tag, UserCheck, FileText, Paperclip, RefreshCw, ArrowUpRight, ClipboardList, XCircle, History, CheckSquare, AlertTriangle, Lightbulb, ImageIcon, Lock } from "lucide-react";
import { useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";

function ScreenshotPlaceholder({ label, caption, src, onInsert }: {
  label: string;
  caption: string;
  src?: string;
  onInsert?: (dataUrl: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onInsert) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") onInsert(result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  if (src) {
    return (
      <figure className="my-4 flex flex-col items-center">
        <div className="rounded-lg border border-border bg-card overflow-hidden w-fit max-w-full">
          <img src={src} alt={caption} className="max-h-72 w-auto max-w-full block" />
          {onInsert && (
            <figcaption className="flex items-center justify-end px-3 py-1.5 border-t border-border bg-muted/30">
              <button
                onClick={() => fileRef.current?.click()}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Replace
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </figcaption>
          )}
        </div>
      </figure>
    );
  }

  return (
    <div className="my-4 rounded-lg border-2 border-dashed border-[#FF9100]/30 bg-[#FF9100]/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-2 h-2 rounded-full bg-[#FF9100]/50 flex-shrink-0" />
            <span className="text-xs font-mono font-semibold text-[#FF9100]/70 uppercase tracking-wide">
              {label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{caption}</p>
        </div>
        {onInsert && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted hover:bg-muted/70 text-xs font-medium text-foreground/70 hover:text-foreground transition-colors"
            >
              <ImageIcon className="h-3 w-3" />
              Insert screenshot
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </>
        )}
      </div>
    </div>
  );
}

function StepItem({ num, children }: { num: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#FF9100]/15 text-[#FF9100] text-xs font-bold flex items-center justify-center mt-0.5">
        {num}
      </span>
      <span className="text-sm text-foreground/85 leading-snug">{children}</span>
    </div>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  return (
    <button
      onClick={() => setChecked(v => !v)}
      className="flex items-start gap-2.5 w-full text-left py-1 group"
    >
      <CheckSquare className={`h-4 w-4 mt-0.5 flex-shrink-0 transition-colors ${checked ? "text-green-500" : "text-muted-foreground/40 group-hover:text-muted-foreground/70"}`} />
      <span className={`text-sm leading-snug transition-colors ${checked ? "line-through text-muted-foreground/50" : "text-foreground/85"}`}>
        {children}
      </span>
    </button>
  );
}

function Section({ icon, title, children, id }: { icon: React.ReactNode; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-border/40">
        <span className="text-[#FF9100]">{icon}</span>
        <h2 className="text-base font-semibold text-foreground tracking-wide">{title}</h2>
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function CalloutBox({ type, children }: { type: "tip" | "warning"; children: React.ReactNode }) {
  const styles = {
    tip: "bg-blue-500/8 border-blue-500/20 text-blue-400",
    warning: "bg-amber-500/8 border-amber-500/20 text-amber-400",
  };
  const Icon = type === "tip" ? Lightbulb : AlertTriangle;
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3.5 py-3 my-3 ${styles[type]}`}>
      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0" />
      <p className="text-sm leading-snug text-foreground/80">{children}</p>
    </div>
  );
}

function PriorityRow({ level, color, label, examples }: { level: string; color: string; label: string; examples: string }) {
  return (
    <div className="flex gap-3 py-2 border-b border-border/20 last:border-0">
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold flex-shrink-0 w-10 justify-center ${color}`}>{level}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground">{label} — </span>
        <span className="text-sm text-muted-foreground">{examples}</span>
      </div>
    </div>
  );
}

type ScreenshotKey = "login" | "directory" | "new-ticket" | "priority" | "assignee" | "next-steps" | "attachment" | "edit-ticket" | "escalation" | "close-ticket" | "history";

export default function SopPage() {
  const { isAdmin } = useAuth();
  const [screenshots, setScreenshots] = useState<Partial<Record<ScreenshotKey, string>>>({});

  function shot(key: ScreenshotKey) {
    return {
      src: screenshots[key],
      onInsert: isAdmin
        ? (dataUrl: string) => setScreenshots(prev => ({ ...prev, [key]: dataUrl }))
        : undefined,
    };
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="glass-header sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/">
              <FormicMark className="h-7 text-[#FF9100] cursor-pointer" />
            </Link>
            <div className="w-px h-6 bg-white/20" />
            <span className="font-semibold text-sm tracking-wide text-white/90 uppercase">Ticketing SOP</span>
            {!isAdmin && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-white/10 text-white/50 uppercase tracking-wide">
                <Lock className="h-2.5 w-2.5" />
                Read only
              </span>
            )}
          </div>
          <Link href="/">
            <button className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white/90 transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">

        {/* Title block */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#FF9100]/10 mb-2">
            <BookOpen className="h-6 w-6 text-[#FF9100]" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Formic Ticketing App — SOP</h1>
          <p className="text-muted-foreground text-sm max-w-xl mx-auto">
            Standard Operating Procedure for creating, managing, and closing ISR tickets. Designed for new Formic employees.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground pt-1">
            <span className="px-2 py-1 rounded bg-muted">Version 1.0</span>
            <span className="px-2 py-1 rounded bg-muted">Last updated: April 2026</span>
            <span className="px-2 py-1 rounded bg-muted">Audience: All Field &amp; Support Staff</span>
          </div>
        </div>

        {/* Purpose */}
        <Section icon={<FileText className="h-4.5 w-4.5" />} title="Purpose" id="purpose">
          <p className="text-sm text-foreground/80 leading-relaxed">
            This SOP defines how Formic employees create, track, and close ISR (Issue Service Request) tickets in the Formic Ticketing App. Following this process ensures every issue is documented, assigned, and resolved consistently — and that nothing falls through the cracks.
          </p>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Who should use this</p>
              <p className="text-sm text-foreground/80">Field Service Engineers (FSEs), Customer Success (CS) team, support staff, and managers.</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">When to create a ticket</p>
              <p className="text-sm text-foreground/80">Any time a customer reports an issue, a robot malfunctions, or a service visit is needed.</p>
            </div>
          </div>
        </Section>

        {/* Step 1 — Logging In */}
        <Section icon={<LogIn className="h-4.5 w-4.5" />} title="1. Logging In" id="login">
          <StepItem num={1}>Open the Formic Ticketing App in your browser.</StepItem>
          <StepItem num={2}>Click <strong>Sign in with Replit</strong>. You must use your <strong>@formic.co</strong> Google account.</StepItem>
          <StepItem num={3}>Once signed in, you land on the <strong>Service Requests</strong> dashboard.</StepItem>
          <ScreenshotPlaceholder label="[Insert Screenshot: Login Screen]" caption="The login page showing the Formic logo and Sign in with Replit button." {...shot("login")} />
          <CalloutBox type="tip">Only @formic.co email addresses can access the app. If you see an access denied message, contact your manager to confirm your account is set up.</CalloutBox>
        </Section>

        {/* Step 2 — Finding Customer / System */}
        <Section icon={<Search className="h-4.5 w-4.5" />} title="2. Finding the Correct Customer or System" id="find">
          <p className="text-sm text-muted-foreground mb-2">Before creating a ticket, confirm you have the right customer and system ID.</p>
          <StepItem num={1}>Use the <strong>Customer</strong> filter or search bar on the dashboard to find existing tickets for that customer.</StepItem>
          <StepItem num={2}>Check the <strong>Customer Directory</strong> (accessible from the sidebar) for the full contact list and system IDs.</StepItem>
          <StepItem num={3}>The system ID follows the format <code className="text-xs bg-muted px-1 py-0.5 rounded">CUSTNAME_SYS1</code> — confirm with the customer or your manager if unsure.</StepItem>
          <ScreenshotPlaceholder label="[Insert Screenshot: Customer Directory]" caption="The Customer Directory page listing all active customers with their contacts and system IDs." {...shot("directory")} />
        </Section>

        {/* Step 3 — Creating a New Ticket */}
        <Section icon={<Plus className="h-4.5 w-4.5" />} title="3. Creating a New Ticket" id="create">
          <StepItem num={1}>Click the <strong>+ New Ticket</strong> button in the top-right corner of the dashboard.</StepItem>
          <StepItem num={2}>Select the <strong>Customer</strong> from the dropdown. Type to search.</StepItem>
          <StepItem num={3}>Select the <strong>System ID</strong>. Only active systems for that customer will appear.</StepItem>
          <StepItem num={4}>Write a clear <strong>Issue Summary</strong> (the title will auto-generate from your description).</StepItem>
          <StepItem num={5}>Set the <strong>Priority</strong> (see Priority Guidance below).</StepItem>
          <StepItem num={6}>Set an <strong>Assignee</strong> — the person responsible for resolving the ticket.</StepItem>
          <StepItem num={7}>Click <strong>Create Ticket</strong>. A Slack notification is sent automatically.</StepItem>
          <ScreenshotPlaceholder label="[Insert Screenshot: New Ticket Form]" caption="The New Ticket dialog showing the Customer, System ID, Priority, Assignee, and Description fields." {...shot("new-ticket")} />
          <CalloutBox type="tip">The AI title generator will automatically create a concise title from your description. Review it and edit if needed before saving.</CalloutBox>
        </Section>

        {/* Step 4 — Priority */}
        <Section icon={<Tag className="h-4.5 w-4.5" />} title="4. Selecting the Right Priority" id="priority">
          <p className="text-sm text-muted-foreground mb-3">Priority determines response urgency. Set it accurately — it affects Slack alerts and daily review order.</p>
          <div className="rounded-lg border border-border bg-card px-4 py-2 mb-3">
            <PriorityRow level="P1" color="bg-red-500/15 text-red-400" label="Critical" examples="Robot fully down, production stopped, no workaround" />
            <PriorityRow level="P2" color="bg-orange-500/15 text-orange-400" label="High" examples="Significant degradation, partial production impact" />
            <PriorityRow level="P3" color="bg-yellow-500/15 text-yellow-400" label="Medium" examples="Issue present but workaround available, monitoring needed" />
            <PriorityRow level="P4" color="bg-blue-500/15 text-blue-400" label="Low" examples="Minor issue, cosmetic, or informational only" />
          </div>
          <ScreenshotPlaceholder label="[Insert Screenshot: Priority Selection]" caption="The Priority dropdown in the ticket form showing P1–P4 options with color indicators." {...shot("priority")} />
        </Section>

        {/* Step 5 — Assigning */}
        <Section icon={<UserCheck className="h-4.5 w-4.5" />} title="5. Assigning the Ticket" id="assign">
          <StepItem num={1}>Select an <strong>Assignee</strong> from the dropdown — this is the person who owns resolution.</StepItem>
          <StepItem num={2}>Use <strong>Notify</strong> to tag additional teammates who should receive Slack alerts for this ticket.</StepItem>
          <StepItem num={3}>Set a <strong>Next Update By</strong> date so the ticket doesn't go stale.</StepItem>
          <div className="rounded-lg border border-border bg-card p-4 space-y-4 mt-2">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Department prefix (first two letters of ticket type)</p>
              <p className="text-sm text-foreground/80 leading-relaxed">The first two letters of a ticket's type code indicate which department is responsible for the work. Use this to identify the correct team when creating or reassigning a ticket.</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">What the assignee owns</p>
              <div className="space-y-1.5">
                {[
                  "The assignee is the person responsible for the next required action on the ticket.",
                  "The assignee owns updates, progress notes, handoff documentation, and reassignment when the work moves to another person.",
                  "If the next step belongs to someone else, the ticket must be reassigned to that person immediately — do not leave it assigned to yourself if you are no longer the one acting.",
                  "Every ticket must have a clear current owner at all times. Unassigned or ambiguous ownership is not acceptable.",
                ].map((rule, i) => (
                  <div key={i} className="flex gap-2.5 text-sm text-foreground/80">
                    <span className="text-[#FF9100] flex-shrink-0 mt-0.5">→</span>
                    <span>{rule}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Required handoff contents</p>
              <p className="text-sm text-muted-foreground mb-2">Every time a ticket is reassigned, the outgoing owner must document the following in Next Steps before handing off:</p>
              <div className="space-y-1.5">
                {[
                  "Current status — what is the state of the issue right now?",
                  "Work completed — what has already been done and by whom?",
                  "Next steps — exactly what the new assignee needs to do.",
                  "Reason for reassignment — why is this moving to a different person?",
                ].map((item, i) => (
                  <div key={i} className="flex gap-2.5 text-sm text-foreground/80">
                    <span className="text-[#FF9100] flex-shrink-0 font-bold">{i + 1}.</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <ScreenshotPlaceholder label="[Insert Screenshot: Assignee Field]" caption="The Assignee and Notify fields in the ticket form, with the Next Update By date picker." {...shot("assignee")} />
        </Section>

        {/* Step 6 — Writing a Good Issue Summary */}
        <Section icon={<FileText className="h-4.5 w-4.5" />} title="6. Writing a Useful Issue Summary" id="summary">
          <p className="text-sm text-muted-foreground mb-2">A good description saves everyone time. Include what happened, when, and what you've already tried.</p>
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-green-400 mb-1">✅ Good example</p>
              <p className="text-sm text-foreground/80 font-mono leading-snug bg-muted/40 rounded p-2">
                Robot stops mid-cycle with E-Stop fault "Arm collision detected." Occurs every 3–5 pallets, especially on the south end of the line. Restarting clears it temporarily. Happened since morning shift, started after last weekend's firmware update.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-red-400 mb-1">❌ Avoid</p>
              <p className="text-sm text-foreground/80 font-mono leading-snug bg-muted/40 rounded p-2">
                Robot broken. Not working.
              </p>
            </div>
          </div>
          <CalloutBox type="tip">Use the AI Assist button (✨) next to the description field to polish your text. Describe the issue in plain English and the AI will clean it up.</CalloutBox>
        </Section>

        {/* Step 7 — Detailed Notes */}
        <Section icon={<ClipboardList className="h-4.5 w-4.5" />} title="7. Writing Detailed Notes (Next Steps)" id="notes">
          <p className="text-sm text-muted-foreground mb-2">Use the <strong>Next Steps</strong> field to log what needs to happen and by when.</p>
          <StepItem num={1}>Be specific: "Schedule remote session with @Alan for Thursday" not "Follow up soon."</StepItem>
          <StepItem num={2}>Use <strong>@name</strong> to mention a teammate who needs to act.</StepItem>
          <StepItem num={3}>After every interaction, update Next Steps so the ticket tells the full story.</StepItem>
          <ScreenshotPlaceholder label="[Insert Screenshot: Next Steps Field]" caption="The Next Steps field showing @mention autocomplete and the AI Assist button." {...shot("next-steps")} />
        </Section>

        {/* Step 8 — Attachments */}
        <Section icon={<Paperclip className="h-4.5 w-4.5" />} title="8. Adding Photos or Attachments" id="attachments">
          <StepItem num={1}>In the ticket form, scroll to the <strong>Attach file to Slack</strong> section.</StepItem>
          <StepItem num={2}>Select a file (photo, log, PDF).</StepItem>
          <StepItem num={3}>Click <strong>Upload now</strong> — the file is posted directly to the ticket's Slack thread.</StepItem>
          <CalloutBox type="tip">Photos of error screens, robot faults, or damaged parts are extremely useful for remote troubleshooting. Always attach them when available.</CalloutBox>
        </Section>

        {/* Step 9 — Updating Status */}
        <Section icon={<RefreshCw className="h-4.5 w-4.5" />} title="9. Updating Ticket Status" id="update">
          <StepItem num={1}>Open the ticket by clicking its row in the dashboard.</StepItem>
          <StepItem num={2}>Update <strong>Next Steps</strong> with your latest actions and what needs to happen next.</StepItem>
          <StepItem num={3}>Adjust the <strong>Priority</strong> if the situation has changed.</StepItem>
          <StepItem num={4}>Update the <strong>Next Update By</strong> date so the ticket stays off the overdue list.</StepItem>
          <ScreenshotPlaceholder label="[Insert Screenshot: Edit Ticket Dialog]" caption="The Edit Ticket dialog with Next Steps, Priority, and Next Update By fields highlighted." {...shot("edit-ticket")} />
          <CalloutBox type="warning">Tickets with no update for 3+ days will appear on the overdue list and in the daily review. Update them even if only to say you're still investigating.</CalloutBox>
        </Section>

        {/* Step 10 — Reassigning / Escalating */}
        <Section icon={<ArrowUpRight className="h-4.5 w-4.5" />} title="10. Reassigning or Escalating a Ticket" id="escalate">
          <p className="text-sm text-muted-foreground mb-2">When a ticket needs different expertise or urgency increases, escalate it.</p>
          <StepItem num={1}>Change the <strong>Assignee</strong> to the correct person in the edit dialog.</StepItem>
          <StepItem num={2}>Change the <strong>Escalation Level</strong> to reflect urgency: Standard → Elevated → High → Critical.</StepItem>
          <StepItem num={3}>Note in <strong>Next Steps</strong> why you're escalating and what information the new assignee needs.</StepItem>

          <ScreenshotPlaceholder label="[Insert Screenshot: Escalation Level Badge]" caption="The escalation level badge on a ticket row, showing the inline toggle from Standard to Critical." {...shot("escalation")} />
        </Section>

        {/* Step 11 — Recording Work */}
        <Section icon={<ClipboardList className="h-4.5 w-4.5" />} title="11. Recording Work Performed" id="work">
          <p className="text-sm text-muted-foreground mb-2">Before closing, document everything that was done so the customer and your team have a complete record.</p>
          <StepItem num={1}>In the ticket edit dialog, update <strong>Next Steps</strong> with a summary of all actions taken.</StepItem>
          <StepItem num={2}>Include dates, people involved, and any parts or software changes.</StepItem>
          <StepItem num={3}>Attach any relevant logs, photos, or files to the Slack thread.</StepItem>
        </Section>

        {/* Step 12 — Closing */}
        <Section icon={<XCircle className="h-4.5 w-4.5" />} title="12. Closing the Ticket Correctly" id="close">
          <StepItem num={1}>Click <strong>Close Ticket</strong> inside the edit dialog.</StepItem>
          <StepItem num={2}>Fill in <strong>Final Determination</strong> — what was the root cause?</StepItem>
          <StepItem num={3}>Fill in <strong>Final Solution</strong> — what fixed it?</StepItem>
          <StepItem num={4}>Click <strong>Confirm Close</strong>. A Slack notification is sent and the ticket is moved to Closed status.</StepItem>
          <CalloutBox type="tip">Use the AI Assist button (✨) in the close panel to help draft the determination and solution from your notes.</CalloutBox>
          <ScreenshotPlaceholder label="[Insert Screenshot: Close Ticket Panel]" caption="The Close Ticket section showing the Final Determination and Final Solution fields." {...shot("close-ticket")} />
          <CalloutBox type="warning">Do not close a ticket without filling in both fields. Incomplete closures make future root-cause analysis impossible.</CalloutBox>
        </Section>

        {/* Step 13 — Reviewing History */}
        <Section icon={<History className="h-4.5 w-4.5" />} title="13. Reviewing Ticket History" id="history">
          <StepItem num={1}>Open any ticket and scroll to the <strong>History</strong> tab in the edit dialog.</StepItem>
          <StepItem num={2}>Every change is logged with who made it and when — assignee changes, priority changes, status changes, and notes.</StepItem>
          <StepItem num={3}>Use history to understand the timeline when investigating recurring issues.</StepItem>
          <ScreenshotPlaceholder label="[Insert Screenshot: Ticket History Tab]" caption="The History tab showing a chronological list of changes made to the ticket." {...shot("history")} />
        </Section>

        {/* Common Mistakes */}
        <Section icon={<AlertTriangle className="h-4.5 w-4.5" />} title="Common Mistakes to Avoid" id="mistakes">
          <div className="space-y-2">
            {[
              "Setting P1 for every ticket — reserve P1 for production-stopping events only.",
              "Leaving Next Steps blank after a customer call — always log what was said and what happens next.",
              "Closing a ticket without filling in Final Determination and Final Solution.",
              "Duplicating tickets — search for an existing ticket before creating a new one.",
              "Not updating the Next Update By date — stale dates make tickets look overdue when they aren't.",
              "Assigning tickets to yourself when a different engineer is the right owner.",
            ].map((m, i) => (
              <div key={i} className="flex gap-2.5 text-sm text-foreground/80">
                <span className="text-red-400 flex-shrink-0 mt-0.5">✗</span>
                <span>{m}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Best Practices */}
        <Section icon={<Lightbulb className="h-4.5 w-4.5" />} title="Best Practices" id="best-practices">
          <div className="space-y-2">
            {[
              "Check the dashboard every morning — use the Daily Review page for a structured briefing.",
              "Update your tickets at the end of every shift, even if nothing changed.",
              "Use @mention in Next Steps to create a clear action item for a specific person.",
              "Attach photos immediately after a site visit while the context is fresh.",
              "If a ticket spans multiple days, keep adding updates rather than creating a new one.",
              "Use the Triage view daily to catch any new unassigned tickets.",
            ].map((b, i) => (
              <div key={i} className="flex gap-2.5 text-sm text-foreground/80">
                <span className="text-green-400 flex-shrink-0 mt-0.5">✓</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick Reference Checklist */}
        <section id="checklist">
          <div className="rounded-xl border border-[#FF9100]/20 bg-[#FF9100]/5 p-6">
            <div className="flex items-center gap-2.5 mb-5">
              <CheckSquare className="h-5 w-5 text-[#FF9100]" />
              <h2 className="text-base font-semibold text-foreground">Quick Reference Checklist</h2>
              <span className="text-xs text-muted-foreground ml-1">Click items to mark complete</span>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Creating a ticket</p>
              <CheckItem>Searched for an existing ticket before creating</CheckItem>
              <CheckItem>Correct customer and system ID selected</CheckItem>
              <CheckItem>Priority set accurately (P1 = production down only)</CheckItem>
              <CheckItem>Assignee set to the right person</CheckItem>
              <CheckItem>Next Update By date filled in</CheckItem>
              <CheckItem>Issue summary is clear and specific</CheckItem>
              <CheckItem>Photos or logs attached if available</CheckItem>

              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 mt-4">Updating a ticket</p>
              <CheckItem>Next Steps updated with latest actions</CheckItem>
              <CheckItem>Next Update By date extended if needed</CheckItem>
              <CheckItem>Priority adjusted if urgency changed</CheckItem>
              <CheckItem>New files attached to Slack thread if applicable</CheckItem>

              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2 mt-4">Closing a ticket</p>
              <CheckItem>All work performed documented in Next Steps</CheckItem>
              <CheckItem>Final Determination filled in (root cause)</CheckItem>
              <CheckItem>Final Solution filled in (what fixed it)</CheckItem>
              <CheckItem>Customer notified if applicable</CheckItem>
            </div>
          </div>
        </section>

        <p className="text-center text-xs text-muted-foreground/50 pb-4">
          Formic Ticketing App SOP · Internal use only · Update this document when processes change
        </p>
      </div>
    </div>
  );
}
