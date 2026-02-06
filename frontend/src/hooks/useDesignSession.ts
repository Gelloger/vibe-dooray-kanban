import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { tasksApi } from '@/lib/api';
import {
  useDesignChatStore,
  useDesignChatState,
} from '@/stores/useDesignChatStore';
import type {
  AddDesignMessageRequest,
  DesignMessage,
  DesignSessionWithMessages,
  DesignChatResponse,
  Session,
} from 'shared/types';

export const designSessionKeys = {
  all: ['design-sessions'] as const,
  byTaskId: (taskId: string | undefined) =>
    ['design-sessions', taskId] as const,
  messagesByTaskId: (taskId: string | undefined) =>
    ['design-sessions', taskId, 'messages'] as const,
  fullByTaskId: (taskId: string | undefined) =>
    ['design-sessions', taskId, 'full'] as const,
};

type UseDesignSessionOptions = {
  enabled?: boolean;
};

/**
 * Hook to fetch the design session for a task.
 * Creates a new session if one doesn't exist.
 */
export function useDesignSession(
  taskId?: string,
  opts?: UseDesignSessionOptions
) {
  const enabled = (opts?.enabled ?? true) && !!taskId;

  return useQuery<Session>({
    queryKey: designSessionKeys.byTaskId(taskId),
    queryFn: () => tasksApi.getDesignSession(taskId!),
    enabled,
  });
}

/**
 * Hook to fetch the design session with all messages for a task.
 */
export function useDesignSessionFull(
  taskId?: string,
  opts?: UseDesignSessionOptions
) {
  const enabled = (opts?.enabled ?? true) && !!taskId;

  return useQuery<DesignSessionWithMessages>({
    queryKey: designSessionKeys.fullByTaskId(taskId),
    queryFn: () => tasksApi.getDesignSessionFull(taskId!),
    enabled,
  });
}

/**
 * Hook to fetch design messages for a task.
 */
export function useDesignMessages(
  taskId?: string,
  opts?: UseDesignSessionOptions
) {
  const enabled = (opts?.enabled ?? true) && !!taskId;

  return useQuery<DesignMessage[]>({
    queryKey: designSessionKeys.messagesByTaskId(taskId),
    queryFn: () => tasksApi.getDesignMessages(taskId!),
    enabled,
  });
}

/**
 * Hook providing mutations for design session operations.
 */
export function useDesignSessionMutations(taskId?: string) {
  const queryClient = useQueryClient();

  const invalidateQueries = () => {
    if (taskId) {
      queryClient.invalidateQueries({
        queryKey: designSessionKeys.byTaskId(taskId),
      });
      queryClient.invalidateQueries({
        queryKey: designSessionKeys.messagesByTaskId(taskId),
      });
      queryClient.invalidateQueries({
        queryKey: designSessionKeys.fullByTaskId(taskId),
      });
    }
  };

  const addMessage = useMutation({
    mutationFn: (data: AddDesignMessageRequest) => {
      if (!taskId) throw new Error('Task ID is required');
      return tasksApi.addDesignMessage(taskId, data);
    },
    onSuccess: (newMessage: DesignMessage) => {
      // Optimistically update the messages cache
      queryClient.setQueryData<DesignMessage[]>(
        designSessionKeys.messagesByTaskId(taskId),
        (old) => (old ? [...old, newMessage] : [newMessage])
      );
      // Also update full session cache if it exists
      queryClient.setQueryData<DesignSessionWithMessages>(
        designSessionKeys.fullByTaskId(taskId),
        (old) =>
          old
            ? { ...old, messages: [...old.messages, newMessage] }
            : undefined
      );
    },
    onError: (err) => {
      console.error('Failed to add design message:', err);
      invalidateQueries();
    },
  });

  const sendChat = useMutation({
    mutationFn: (message: string) => {
      if (!taskId) throw new Error('Task ID is required');
      return tasksApi.sendDesignChat(taskId, message);
    },
    onSuccess: (response: DesignChatResponse) => {
      // Update messages cache with both user and assistant messages
      queryClient.setQueryData<DesignMessage[]>(
        designSessionKeys.messagesByTaskId(taskId),
        (old) =>
          old
            ? [...old, response.user_message, response.assistant_message]
            : [response.user_message, response.assistant_message]
      );
      // Also update full session cache - always update even if old doesn't exist
      queryClient.setQueryData<DesignSessionWithMessages>(
        designSessionKeys.fullByTaskId(taskId),
        (old) => {
          const newMessages = [response.user_message, response.assistant_message];
          if (old) {
            return {
              ...old,
              messages: [...old.messages, ...newMessages],
            };
          }
          // If no existing cache, invalidate to trigger refetch
          // This ensures we get the full session data from the server
          return old;
        }
      );
      // Always invalidate to ensure consistency with server state
      // This handles edge cases where cache might not be in sync
      invalidateQueries();
    },
    onError: (err) => {
      console.error('Failed to send design chat:', err);
      invalidateQueries();
    },
  });

  return {
    addMessage,
    sendChat,
    invalidateQueries,
  };
}

/**
 * Hook for streaming design chat with real-time updates.
 * Uses Zustand store for global state management, enabling parallel chats across tasks.
 * Provides chunk-by-chunk response streaming.
 */
export function useDesignChatStream(taskId?: string) {
  const queryClient = useQueryClient();

  // Zustand 스토어에서 상태 읽기
  const chatState = useDesignChatState(taskId);
  const store = useDesignChatStore();

  // Track if we need to start a new text segment after tool events
  const pendingTextRef = useRef<string>('');

  const refetchQueries = useCallback(async () => {
    if (taskId) {
      // Force refetch to get latest data from server
      await queryClient.refetchQueries({
        queryKey: designSessionKeys.fullByTaskId(taskId),
      });
    }
  }, [queryClient, taskId]);

  const sendStreamingChat = useCallback(
    async (
      message: string,
      onChunk?: (content: string) => void
    ): Promise<{ userMessage: DesignMessage; assistantMessage: DesignMessage } | null> => {
      if (!taskId) {
        store.setError(taskId!, 'Task ID is required');
        return null;
      }

      // Cancel any existing stream for this task
      store.cancelStream(taskId);

      const controller = new AbortController();
      store.setAbortController(taskId, controller);

      // Create user message to display immediately
      const optimisticUserMessage: DesignMessage = {
        id: `temp-${Date.now()}`,
        session_id: '',
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      };

      store.startStreaming(taskId, optimisticUserMessage);
      pendingTextRef.current = '';

      let userMessage: DesignMessage | null = null;
      let assistantMessage: DesignMessage | null = null;
      let accumulatedContent = '';

      try {
        for await (const event of tasksApi.sendDesignChatStream(
          taskId,
          message,
          controller.signal
        )) {
          if (controller.signal.aborted) break;

          switch (event.type) {
            case 'UserMessageSaved':
              userMessage = event.data.message;
              // Update current user message with server-assigned ID
              store.updateCurrentUserMessage(taskId, userMessage);
              break;

            case 'AssistantChunk':
              accumulatedContent += event.data.content;
              pendingTextRef.current += event.data.content;
              store.updateStreamingContent(taskId, accumulatedContent);
              // Update or add text event in streamingEvents
              {
                const currentState = store.getState(taskId);
                const events = currentState.streamingEvents;
                const lastEvent = events[events.length - 1];
                if (lastEvent?.type === 'text') {
                  // Append to existing text segment
                  store.setStreamingEvents(taskId, [
                    ...events.slice(0, -1),
                    { ...lastEvent, content: lastEvent.content + event.data.content }
                  ]);
                } else {
                  // Start new text segment
                  store.addStreamingEvent(taskId, { type: 'text', content: event.data.content });
                }
              }
              onChunk?.(event.data.content);
              break;

            case 'AssistantComplete':
              assistantMessage = event.data.message;
              break;

            case 'ToolUse':
              {
                const currentState = store.getState(taskId);
                store.setToolEvents(taskId, [...currentState.toolEvents, {
                  type: 'tool_use',
                  toolName: event.data.tool_name,
                  content: JSON.stringify(event.data.tool_input, null, 2),
                }]);
                // Add tool event to streamingEvents (this breaks text continuity)
                store.addStreamingEvent(taskId, {
                  type: 'tool_use',
                  toolName: event.data.tool_name,
                  content: JSON.stringify(event.data.tool_input, null, 2),
                });
              }
              break;

            case 'ToolResult':
              {
                const currentState = store.getState(taskId);
                store.setToolEvents(taskId, [...currentState.toolEvents, {
                  type: 'tool_result',
                  toolName: event.data.tool_name,
                  content: event.data.output,
                }]);
                // Skip adding tool_result to streamingEvents
              }
              break;

            case 'Error':
              store.setError(taskId, event.data.message);
              break;
          }
        }

        // Force refetch to get latest messages from server
        // This ensures the UI shows the persisted messages
        await refetchQueries();

        if (userMessage && assistantMessage) {
          return { userMessage, assistantMessage };
        }
        return null;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const errorMessage =
            err instanceof Error ? err.message : 'Unknown error occurred';
          store.setError(taskId, errorMessage);
          console.error('Design chat stream error:', err);
        }
        return null;
      } finally {
        store.finishStreaming(taskId);
        store.setAbortController(taskId, null);
        pendingTextRef.current = '';
      }
    },
    [taskId, store, refetchQueries]
  );

  const cancelStream = useCallback(() => {
    if (taskId) {
      store.cancelStream(taskId);
      // Refetch to get any saved messages
      refetchQueries();
    }
  }, [taskId, store, refetchQueries]);

  return {
    sendStreamingChat,
    cancelStream,
    isStreaming: chatState.isStreaming,
    streamingContent: chatState.streamingContent,
    streamingEvents: chatState.streamingEvents,
    toolEvents: chatState.toolEvents,
    currentUserMessage: chatState.currentUserMessage,
    error: chatState.error,
  };
}
