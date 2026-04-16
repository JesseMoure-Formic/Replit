import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send, Loader2, Save, Trash2, FileText, Globe, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { EmailTemplate } from "@shared/schema";

interface EmailComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTo: string;
  defaultSubject: string;
  defaultBody: string;
  defaultCc?: string;
  ticketRef?: string;
  customerName?: string;
  htmlBody?: string;
  onSent?: (to: string, subject: string) => void;
}

function applyVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || `{{${key}}}`);
}

export function EmailComposeDialog({
  open,
  onOpenChange,
  defaultTo,
  defaultSubject,
  defaultBody,
  defaultCc = "",
  ticketRef = "",
  customerName = "",
  htmlBody,
  onSent,
}: EmailComposeDialogProps) {
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateIsGlobal, setTemplateIsGlobal] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setCc(defaultCc);
      setSubject(defaultSubject);
      setBody(defaultBody);
      setShowSaveTemplate(false);
      setTemplateName("");
      setTemplateIsGlobal(false);
    }
  }, [open, defaultTo, defaultCc, defaultSubject, defaultBody]);

  const { data: templates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
    enabled: open,
  });

  const saveTemplateMutation = useMutation({
    mutationFn: async (data: { name: string; subject: string; body: string; isGlobal: boolean }) => {
      const res = await apiRequest("POST", "/api/email-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({ title: "Template saved" });
      setShowSaveTemplate(false);
      setTemplateName("");
    },
    onError: (err: any) => {
      toast({ title: "Failed to save template", description: err.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/email-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete template", description: err.message, variant: "destructive" });
    },
  });

  const handleApplyTemplate = (templateId: string) => {
    if (templateId === "__none") return;
    const template = templates.find((t) => t.id === parseInt(templateId));
    if (!template) return;
    const vars: Record<string, string> = {
      ticketRef,
      customerName,
    };
    setSubject(applyVariables(template.subject, vars));
    setBody(applyVariables(template.body, vars));
  };

  const handleSend = async () => {
    if (!to.trim()) {
      toast({ title: "Recipient required", description: "Please enter a recipient email address.", variant: "destructive" });
      return;
    }
    if (!subject.trim()) {
      toast({ title: "Subject required", description: "Please enter a subject line.", variant: "destructive" });
      return;
    }

    setSending(true);
    try {
      await apiRequest("POST", "/api/send-email", {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
        cc: cc.trim() || undefined,
        html: htmlBody || undefined,
      });
      toast({ title: "Email sent", description: `Email sent from support@formic.co` });
      onSent?.(to.trim(), subject.trim());
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Failed to send email",
        description: err.message || "An error occurred while sending the email.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Compose Email</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded px-3 py-2">
            <span className="font-medium">From:</span>
            <span>support@formic.co</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-to">To <span className="text-xs text-muted-foreground font-normal">(separate multiple with commas)</span></Label>
            <Input
              id="email-to"
              data-testid="input-email-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com, another@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-cc">CC <span className="text-xs text-muted-foreground font-normal">(separate multiple with commas)</span></Label>
            <Input
              id="email-cc"
              data-testid="input-email-cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com, cc2@example.com"
            />
          </div>

          {templates.length > 0 && (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select onValueChange={handleApplyTemplate}>
                <SelectTrigger className="flex-1" data-testid="select-email-template">
                  <SelectValue placeholder="Load a template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between group">
                      <SelectItem value={String(t.id)} className="flex-1">
                        <span className="flex items-center gap-1.5">
                          {t.isGlobal ? <Globe className="h-3 w-3 text-muted-foreground" /> : <User className="h-3 w-3 text-muted-foreground" />}
                          {t.name}
                        </span>
                      </SelectItem>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 mr-1"
                        data-testid={`button-delete-template-${t.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTemplateMutation.mutate(t.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              data-testid="input-email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email-body">Message</Label>
            <Textarea
              id="email-body"
              data-testid="input-email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              style={{ whiteSpace: "pre", overflowX: "auto", overflowWrap: "normal" }}
            />
          </div>

          {showSaveTemplate && (
            <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
              <div className="text-sm font-medium">Save as Template</div>
              <div className="space-y-1.5">
                <Label htmlFor="template-name">Template Name</Label>
                <Input
                  id="template-name"
                  data-testid="input-template-name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g., Initial Customer Response"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="template-global"
                  data-testid="checkbox-template-global"
                  checked={templateIsGlobal}
                  onCheckedChange={(checked) => setTemplateIsGlobal(!!checked)}
                />
                <Label htmlFor="template-global" className="text-sm font-normal cursor-pointer">
                  Share with all team members (global template)
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Use <code className="bg-muted px-1 rounded">{"{{ticketRef}}"}</code> and <code className="bg-muted px-1 rounded">{"{{customerName}}"}</code> as placeholders that auto-fill when the template is loaded.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  data-testid="button-confirm-save-template"
                  disabled={!templateName.trim() || saveTemplateMutation.isPending}
                  onClick={() => {
                    saveTemplateMutation.mutate({
                      name: templateName.trim(),
                      subject: subject,
                      body: body,
                      isGlobal: templateIsGlobal,
                    });
                  }}
                  className="gap-1.5"
                >
                  {saveTemplateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSaveTemplate(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="button-save-as-template"
              onClick={() => setShowSaveTemplate(!showSaveTemplate)}
              className="gap-1.5 text-muted-foreground"
            >
              <Save className="h-4 w-4" />
              {showSaveTemplate ? "Hide" : "Save as Template"}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                data-testid="button-cancel-email"
                onClick={() => onOpenChange(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                data-testid="button-send-email"
                onClick={handleSend}
                disabled={sending}
                className="gap-2"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? "Sending..." : "Send Email"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
