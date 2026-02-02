import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { doorayApi } from '@/lib/api';
import type {
  DooraySettings,
  DoorayProject,
  DoorayTask,
  DoorayTagsResponse,
  SaveSettingsRequest,
  SyncRequest,
  SyncResult,
  ImportByNumberRequest,
  ImportResult,
  CreateDoorayCommentRequest,
  CreateDoorayTaskRequest,
  CreateDoorayTaskResult,
} from 'shared/types';

// Query keys for caching
const DOORAY_KEYS = {
  settings: ['dooray', 'settings'] as const,
  projects: ['dooray', 'projects'] as const,
  tasks: (projectId: string) => ['dooray', 'tasks', projectId] as const,
  tags: (projectId: string) => ['dooray', 'tags', projectId] as const,
};

/**
 * Hook for managing Dooray settings
 */
export function useDooraySettings() {
  const queryClient = useQueryClient();

  const {
    data: settings,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: DOORAY_KEYS.settings,
    queryFn: () => doorayApi.getSettings(),
    staleTime: 1000 * 60 * 5, // 5 minutes cache
    retry: false, // Don't retry on 404 (no settings)
  });

  const { mutateAsync: saveSettings, isPending: isSaving } = useMutation({
    mutationFn: (data: SaveSettingsRequest) => doorayApi.saveSettings(data),
    onSuccess: (newSettings) => {
      queryClient.setQueryData(DOORAY_KEYS.settings, newSettings);
      // Invalidate projects since we might have a new token
      queryClient.invalidateQueries({ queryKey: DOORAY_KEYS.projects });
    },
  });

  const { mutateAsync: deleteSettings, isPending: isDeleting } = useMutation({
    mutationFn: () => doorayApi.deleteSettings(),
    onSuccess: () => {
      queryClient.setQueryData(DOORAY_KEYS.settings, null);
      queryClient.removeQueries({ queryKey: DOORAY_KEYS.projects });
    },
  });

  const isConnected = Boolean(settings?.dooray_token);

  return {
    settings,
    isConnected,
    isLoading,
    isError,
    error,
    isSaving,
    isDeleting,
    refetch,
    saveSettings,
    deleteSettings,
  };
}

/**
 * Hook for fetching Dooray projects (requires valid token)
 */
export function useDoorayProjects(enabled = true) {
  const {
    data: projects,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: DOORAY_KEYS.projects,
    queryFn: () => doorayApi.getProjects(),
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

  return {
    projects: projects ?? [],
    isLoading,
    isError,
    error,
    refetch,
  };
}

/**
 * Hook for fetching tasks from a Dooray project
 */
export function useDoorayTasks(doorayProjectId: string | null) {
  const {
    data: tasks,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: doorayProjectId ? DOORAY_KEYS.tasks(doorayProjectId) : ['dooray', 'tasks', 'none'],
    queryFn: () => {
      if (!doorayProjectId) return Promise.resolve([]);
      return doorayApi.getTasks(doorayProjectId);
    },
    enabled: Boolean(doorayProjectId),
    staleTime: 1000 * 60 * 2, // 2 minutes cache
  });

  return {
    tasks: tasks ?? [],
    isLoading,
    isError,
    error,
    refetch,
  };
}

/**
 * Hook for fetching tags from a Dooray project
 */
export function useDoorayTags(doorayProjectId: string | null) {
  const {
    data: tagsResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: doorayProjectId ? DOORAY_KEYS.tags(doorayProjectId) : ['dooray', 'tags', 'none'],
    queryFn: () => {
      if (!doorayProjectId) return Promise.resolve({ tagGroups: [] } as DoorayTagsResponse);
      return doorayApi.getTags(doorayProjectId);
    },
    enabled: Boolean(doorayProjectId),
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

  return {
    tagGroups: tagsResponse?.tagGroups ?? [],
    isLoading,
    isError,
    error,
    refetch,
  };
}

/**
 * Hook for updating selected tags
 */
export function useUpdateDoorayTags() {
  const queryClient = useQueryClient();

  const { mutateAsync: updateSelectedTags, isPending } = useMutation({
    mutationFn: (tagIds: string[] | null) => doorayApi.updateSelectedTags(tagIds),
    onSuccess: (newSettings) => {
      queryClient.setQueryData(DOORAY_KEYS.settings, newSettings);
    },
  });

  return {
    updateSelectedTags,
    isUpdating: isPending,
  };
}

/**
 * Hook for updating selected project
 */
export function useUpdateDoorayProject() {
  const queryClient = useQueryClient();

  const { mutateAsync: updateSelectedProject, isPending } = useMutation({
    mutationFn: ({ projectId, projectName }: { projectId: string; projectName: string }) =>
      doorayApi.updateSelectedProject(projectId, projectName),
    onSuccess: (newSettings) => {
      queryClient.setQueryData(DOORAY_KEYS.settings, newSettings);
      // Clear tags cache when project changes since tags are project-specific
      queryClient.removeQueries({ queryKey: ['dooray', 'tags'] });
    },
  });

  return {
    updateSelectedProject,
    isUpdating: isPending,
  };
}

/**
 * Hook for syncing Dooray tasks to local project
 */
export function useDooraySync() {
  const queryClient = useQueryClient();

  const {
    mutateAsync: syncTasks,
    isPending: isSyncing,
    isError,
    error,
    data: lastSyncResult,
  } = useMutation({
    mutationFn: (data: SyncRequest) => doorayApi.sync(data),
    onSuccess: (_, variables) => {
      // Invalidate local tasks to show synced items
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.project_id] });
    },
  });

  return {
    syncTasks,
    isSyncing,
    isError,
    error,
    lastSyncResult,
  };
}

/**
 * Hook for importing a single Dooray task by task number
 */
export function useDoorayImportByNumber() {
  const queryClient = useQueryClient();

  const {
    mutateAsync: importByNumber,
    isPending: isImporting,
    isError,
    error,
    data: lastImportResult,
  } = useMutation({
    mutationFn: (data: ImportByNumberRequest) => doorayApi.importByNumber(data),
    onSuccess: (result, variables) => {
      if (result.success && result.task_id) {
        // Invalidate local tasks to show imported item
        queryClient.invalidateQueries({ queryKey: ['tasks', variables.project_id] });
      }
    },
  });

  return {
    importByNumber,
    isImporting,
    isError,
    error,
    lastImportResult,
  };
}

/**
 * Combined hook for common Dooray operations
 */
export function useDooray() {
  const settings = useDooraySettings();
  const projects = useDoorayProjects(settings.isConnected);
  const sync = useDooraySync();

  return {
    // Settings
    settings: settings.settings,
    isConnected: settings.isConnected,
    saveSettings: settings.saveSettings,
    deleteSettings: settings.deleteSettings,
    isSavingSettings: settings.isSaving,
    isDeletingSettings: settings.isDeleting,

    // Projects
    projects: projects.projects,
    isLoadingProjects: projects.isLoading,
    refetchProjects: projects.refetch,

    // Sync
    syncTasks: sync.syncTasks,
    isSyncing: sync.isSyncing,
    lastSyncResult: sync.lastSyncResult,

    // Status
    isLoading: settings.isLoading || projects.isLoading,
    isError: settings.isError || projects.isError,
  };
}

/**
 * Hook for creating a comment on a Dooray task
 */
export function useDoorayCreateComment() {
  const { mutateAsync: createComment, isPending: isCreating } = useMutation({
    mutationFn: (data: CreateDoorayCommentRequest) => doorayApi.createComment(data),
  });

  return {
    createComment,
    isCreating,
  };
}

/**
 * Hook for creating a Dooray task and syncing to local kanban
 */
export function useCreateDoorayTask() {
  const queryClient = useQueryClient();

  const {
    mutateAsync: createTask,
    isPending: isCreating,
    isError,
    error,
    data: lastResult,
  } = useMutation({
    mutationFn: (data: CreateDoorayTaskRequest) => doorayApi.createTask(data),
    onSuccess: (result, variables) => {
      if (result.success && result.local_task_id) {
        // Invalidate local tasks to show the new synced task
        queryClient.invalidateQueries({ queryKey: ['tasks', variables.local_project_id] });
      }
    },
  });

  return {
    createTask,
    isCreating,
    isError,
    error,
    lastResult,
  };
}

export type {
  DooraySettings,
  DoorayProject,
  DoorayTask,
  DoorayTagsResponse,
  SyncResult,
  ImportResult,
  ImportByNumberRequest,
  CreateDoorayTaskRequest,
  CreateDoorayTaskResult,
};
