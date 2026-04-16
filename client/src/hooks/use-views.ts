import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { SavedView } from "@shared/schema";

export function useSetDefaultView() {
  return useMutation({
    mutationFn: async (viewId: number | null) => {
      const res = await apiRequest("PATCH", "/api/auth/user/preferences", { defaultViewId: viewId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });
}

export function useViews() {
  return useQuery<SavedView[]>({
    queryKey: ["/api/views"],
  });
}

export function useCreateView() {
  return useMutation({
    mutationFn: async (data: { name: string; isGlobal: boolean; filters: Record<string, string[]> }) => {
      const res = await apiRequest("POST", "/api/views", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/views"] });
    },
  });
}

export function useUpdateView() {
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name?: string; isGlobal?: boolean; filters?: Record<string, any> } }) => {
      const res = await apiRequest("PATCH", `/api/views/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/views"] });
    },
  });
}

export function useDeleteView() {
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/views/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/views"] });
    },
  });
}
