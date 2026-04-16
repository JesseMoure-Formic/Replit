import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Trash2, Users, CheckCircle, Loader2, AlertCircle, Pencil, X, Check, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ContactRecord {
  recordId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface DuplicateGroup {
  customerName: string;
  contactName: string;
  records: ContactRecord[];
}

interface ContactWithCustomer extends ContactRecord {
  customerName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function EditContactRow({ contact, onSaved }: { contact: ContactRecord; onSaved: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { firstName: initFirst, lastName: initLast } = splitName(contact.name);
  const [firstName, setFirstName] = useState(initFirst);
  const [lastName, setLastName] = useState(initLast);
  const [email, setEmail] = useState(contact.email ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/contacts/${contact.recordId}`, {
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
      toast({ title: "Contact updated", description: "Changes saved to Airtable." });
      setEditing(false);
      onSaved();
    },
    onError: () => {
      toast({ title: "Update failed", description: "Could not save changes. Try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/contacts/${contact.recordId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
      toast({ title: "Contact deleted", description: `${contact.name} removed from Airtable.` });
    },
    onError: () => {
      toast({ title: "Delete failed", description: "Could not delete the contact.", variant: "destructive" });
      setConfirmDelete(false);
    },
  });

  const handleCancel = () => {
    const { firstName: f, lastName: l } = splitName(contact.name);
    setFirstName(f);
    setLastName(l);
    setEmail(contact.email ?? "");
    setPhone(contact.phone ?? "");
    setEditing(false);
    setConfirmDelete(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between px-4 py-2.5 text-sm group">
        <div className="min-w-0">
          <span className="font-medium">{contact.name}</span>
          {(contact.email || contact.phone) && (
            <span className="text-muted-foreground ml-2 text-xs">
              {[contact.email, contact.phone].filter(Boolean).join(" · ")}
            </span>
          )}
          {!contact.email && !contact.phone && (
            <span className="text-muted-foreground/50 ml-2 text-xs">no email or phone</span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 shrink-0"
          data-testid={`btn-edit-${contact.recordId}`}
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 bg-muted/30 border-t border-border space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">First name</Label>
          <Input
            className="h-8 text-sm"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            data-testid={`input-firstname-${contact.recordId}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Last name</Label>
          <Input
            className="h-8 text-sm"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            data-testid={`input-lastname-${contact.recordId}`}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Email</Label>
          <Input
            className="h-8 text-sm"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            data-testid={`input-email-${contact.recordId}`}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Phone</Label>
          <Input
            className="h-8 text-sm"
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            data-testid={`input-phone-${contact.recordId}`}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {/* Delete side */}
        {!confirmDelete ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            data-testid={`btn-delete-${contact.recordId}`}
            disabled={deleteMutation.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-destructive font-medium">Sure?</span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
              data-testid={`btn-confirm-delete-${contact.recordId}`}
            >
              {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes, delete"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setConfirmDelete(false)}
            >
              No
            </Button>
          </div>
        )}

        {/* Save / Cancel side */}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCancel}>
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-orange-500 hover:bg-orange-600 text-white"
            disabled={updateMutation.isPending || !firstName.trim()}
            onClick={() => updateMutation.mutate()}
            data-testid={`btn-save-${contact.recordId}`}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Check className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function DuplicatesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  // Maps groupKey -> recordId chosen to keep (defaults to first record)
  const [keepSelection, setKeepSelection] = useState<Record<string, string>>({});

  const { data: groups = [], isLoading, error, refetch } = useQuery<DuplicateGroup[]>({
    queryKey: ["/api/contacts/duplicates"],
    staleTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      await apiRequest("DELETE", `/api/contacts/${recordId}`);
    },
    onMutate: (recordId) => {
      setDeletingIds(prev => new Set(prev).add(recordId));
    },
    onSuccess: (_data, recordId) => {
      setDeletingIds(prev => { const next = new Set(prev); next.delete(recordId); return next; });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/duplicates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/contacts/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
      toast({ title: "Contact deleted", description: "Duplicate removed from Airtable." });
    },
    onError: (_err, recordId) => {
      setDeletingIds(prev => { const next = new Set(prev); next.delete(recordId); return next; });
      toast({ title: "Delete failed", description: "Could not delete the contact.", variant: "destructive" });
    },
  });

  const groupKey = (group: DuplicateGroup, gi: number) =>
    `${group.customerName}__${group.contactName}__${gi}`;

  const getKeepId = (group: DuplicateGroup, gi: number): string =>
    keepSelection[groupKey(group, gi)] ?? group.records[0]?.recordId ?? "";

  const handleDeleteAllButSelected = async (group: DuplicateGroup, gi: number) => {
    const keepId = getKeepId(group, gi);
    for (const record of group.records) {
      if (record.recordId !== keepId) {
        await deleteMutation.mutateAsync(record.recordId);
      }
    }
  };

  const activeGroups = groups.filter(g => g.records.length > 1);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Scanning Airtable for duplicates…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive py-8 justify-center">
        <AlertCircle className="h-5 w-5" />
        <span>Failed to load duplicates.</span>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (activeGroups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
        <CheckCircle className="h-10 w-10 text-green-500" />
        <p className="text-sm font-medium">No duplicate contacts found!</p>
        <p className="text-xs">All contacts in Airtable appear to be unique.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Found <span className="font-semibold text-foreground">{activeGroups.length}</span> duplicate group{activeGroups.length !== 1 ? "s" : ""}.
        Click <span className="font-medium text-foreground">Keep this</span> on the record you want to keep, then delete the rest.
      </p>
      {activeGroups.map((group, gi) => {
        const keepId = getKeepId(group, gi);
        return (
          <div key={groupKey(group, gi)} className="border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-4 py-2 flex items-center justify-between">
              <div>
                <span className="font-medium text-sm">{group.contactName}</span>
                <span className="text-muted-foreground text-xs ml-2">@ {group.customerName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs border-orange-500/40 text-orange-400">
                  {group.records.length} copies
                </Badge>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 text-xs"
                  data-testid={`btn-delete-all-${gi}`}
                  disabled={deleteMutation.isPending}
                  onClick={() => handleDeleteAllButSelected(group, gi)}
                >
                  Delete all but kept
                </Button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {group.records.map((record) => {
                const isKept = record.recordId === keepId;
                const isDeleting = deletingIds.has(record.recordId);
                return (
                  <div
                    key={record.recordId}
                    className={`flex items-center justify-between px-4 py-2.5 text-sm ${isKept ? "bg-green-500/5" : ""}`}
                    data-testid={`contact-row-${record.recordId}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isKept ? (
                        <Badge className="text-xs bg-green-600/20 text-green-400 border-green-600/30 shrink-0">
                          keep
                        </Badge>
                      ) : (
                        <button
                          className="text-xs px-2 py-0.5 rounded border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-green-500/60 hover:text-green-400 hover:bg-green-500/10 transition-colors shrink-0 cursor-pointer"
                          data-testid={`btn-keep-${record.recordId}`}
                          onClick={() =>
                            setKeepSelection(prev => ({ ...prev, [groupKey(group, gi)]: record.recordId }))
                          }
                        >
                          Keep this
                        </button>
                      )}
                      <div className="min-w-0">
                        <span className="font-medium">{record.name}</span>
                        {(record.email || record.phone) && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {[record.email, record.phone].filter(Boolean).join(" · ")}
                          </span>
                        )}
                        {!record.email && !record.phone && (
                          <span className="text-muted-foreground/50 ml-2 text-xs">no email or phone</span>
                        )}
                      </div>
                    </div>
                    {!isKept && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        data-testid={`btn-delete-${record.recordId}`}
                        disabled={isDeleting}
                        onClick={() => deleteMutation.mutate(record.recordId)}
                      >
                        {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AllContactsTab() {
  const [search, setSearch] = useState("");

  const { data: contacts = [], isLoading, error, refetch } = useQuery<ContactWithCustomer[]>({
    queryKey: ["/api/contacts/all"],
    staleTime: 0,
  });

  const filtered = search.trim().length >= 1
    ? contacts.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.customerName.toLowerCase().includes(search.toLowerCase()) ||
        (c.email ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : contacts;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading contacts…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-destructive py-8 justify-center">
        <AlertCircle className="h-5 w-5" />
        <span>Failed to load contacts.</span>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  // Group by customer for display
  const grouped: Record<string, ContactWithCustomer[]> = {};
  for (const c of filtered) {
    if (!grouped[c.customerName]) grouped[c.customerName] = [];
    grouped[c.customerName].push(c);
  }
  const customerNames = Object.keys(grouped).sort();

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9 h-9 text-sm"
          placeholder="Search by name, customer, or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-contact-search"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} contact{filtered.length !== 1 ? "s" : ""} across {customerNames.length} customer{customerNames.length !== 1 ? "s" : ""}
        {search && " matching your search"}.
        Hover a row to edit.
      </p>

      <div className="space-y-2">
        {customerNames.map(custName => (
          <div key={custName} className="border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/40 px-4 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">{custName}</span>
            </div>
            <div className="divide-y divide-border">
              {grouped[custName].map(contact => (
                <EditContactRow
                  key={contact.recordId}
                  contact={contact}
                  onSaved={() => {}}
                />
              ))}
            </div>
          </div>
        ))}
        {customerNames.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">No contacts found.</p>
        )}
      </div>
    </div>
  );
}

export function ContactDedupDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="contact-dedup-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-orange-500" />
            Contact Manager
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="edit" className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="edit" className="flex-1" data-testid="tab-edit-contacts">
              Edit Contacts
            </TabsTrigger>
            <TabsTrigger value="duplicates" className="flex-1" data-testid="tab-duplicates">
              Duplicates
            </TabsTrigger>
          </TabsList>
          <TabsContent value="edit">
            <AllContactsTab />
          </TabsContent>
          <TabsContent value="duplicates">
            <DuplicatesTab />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
