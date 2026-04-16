import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { DEFAULT_ROLE_CONFIG, type RoleConfig, type RoleKey } from "@shared/schema";

async function fetchUser(): Promise<User | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function logout(): Promise<void> {
  window.location.href = "/api/logout";
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const { data: roleConfigs = [] } = useQuery<RoleConfig[]>({
    queryKey: ["/api/admin/role-config"],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
    },
  });

  const role = user?.role || "requester";

  // Resolve permissions from DB config first, then default config, then all-false fallback
  const configForRole = roleConfigs.find(c => c.role === role);
  const defaultForRole = (["admin", "manager", "agent", "requester"].includes(role))
    ? DEFAULT_ROLE_CONFIG[role as RoleKey].permissions
    : { canCloseTickets: false, canEditDailyReview: false, canGenerateDailyReport: false, canSuperEscalate: false, canCriticalEscalate: false };
  const permissions = configForRole?.permissions ?? defaultForRole;

  const isAdmin = role === "admin";

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    role,
    roleConfigs,
    isAdmin,
    isManager: role === "manager" || isAdmin,
    isAgent: role === "agent" || role === "manager" || isAdmin,
    isRequester: role === "requester",
    canCloseTickets: isAdmin ? true : (permissions.canCloseTickets ?? false),
    canEditDailyReview: isAdmin ? true : (permissions.canEditDailyReview ?? false),
    canGenerateDailyReport: isAdmin ? true : (permissions.canGenerateDailyReport ?? false),
    canViewDailyReview: !!user,
    canSuperEscalate: isAdmin ? true : (permissions.canSuperEscalate ?? false),
    canCriticalEscalate: isAdmin ? true : (permissions.canCriticalEscalate ?? false),
  };
}
