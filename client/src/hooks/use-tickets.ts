import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { Ticket, InsertTicket, UpdateTicketRequest } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useTickets() {
  return useQuery({
    queryKey: [api.tickets.list.path],
    queryFn: async () => {
      const res = await fetch(api.tickets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return (await res.json()) as Ticket[];
    },
  });
}

export function useTicket(id: number) {
  return useQuery({
    queryKey: [api.tickets.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.tickets.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch ticket");
      return (await res.json()) as Ticket;
    },
    enabled: !!id,
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertTicket) => {
      const res = await fetch(api.tickets.create.path, {
        method: api.tickets.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create ticket");
      }
      return (await res.json()) as Ticket;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] });
      toast({ title: "Ticket created", description: "Your ticket has been saved." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: UpdateTicketRequest }) => {
      const url = buildUrl(api.tickets.update.path, { id });
      const res = await fetch(url, {
        method: api.tickets.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update ticket");
      }
      return (await res.json()) as Ticket;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.tickets.get.path, data.id] });
      toast({ title: "Ticket updated", description: "Your changes have been saved." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to delete ticket");
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] });
      toast({ title: "Ticket deleted", description: "The ticket has been permanently deleted." });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });
}

export function useSyncTickets() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.tickets.sync.path, {
        method: api.tickets.sync.method,
        credentials: "include"
      });
      if (!res.ok) throw new Error("Failed to sync tickets");
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] });
      toast({ title: "Sync successful", description: "Tickets synced with external services." });
    },
    onError: (error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    }
  });
}
