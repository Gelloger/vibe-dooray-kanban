import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { tasksApi } from '@/lib/api';
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

// Tool event type for design chat streaming
export interface ToolEvent {
  type: 'tool_use' | 'tool_result';
  toolName: string;
  content: string;
}

// Streaming event that preserves order of text and tool events
export interface StreamingEvent {
  type: 'text' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
}

/**
 * Hook for streaming design chat with real-time updates.
 * Provides chunk-by-chunk response streaming.
 */
export function useDesignChatStream(taskId?: string) {
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [streamingEvents, setStreamingEvents] = useState<StreamingEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentUserMessage, setCurrentUserMessage] = useState<DesignMessage | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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
        setError('Task ID is required');
        return null;
      }

      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStreaming(true);
      setStreamingContent('');
      setToolEvents([]);
      setStreamingEvents([]);
      setError(null);
      pendingTextRef.current = '';

      // Create user message to display immediately (not via cache to ensure correct ordering)
      const optimisticUserMessage: DesignMessage = {
        id: `temp-${Date.now()}`,
        session_id: '',
        role: 'user',
        content: message,
        created_at: new Date().toISOString(),
      };
      setCurrentUserMessage(optimisticUserMessage);

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
              setCurrentUserMessage(userMessage);
              break;

            case 'AssistantChunk':
              accumulatedContent += event.data.content;
              pendingTextRef.current += event.data.content;
              setStreamingContent(accumulatedContent);
              // Update or add text event in streamingEvents
              setStreamingEvents(prev => {
                const lastEvent = prev[prev.length - 1];
                if (lastEvent?.type === 'text') {
                  // Append to existing text segment
                  return [
                    ...prev.slice(0, -1),
                    { ...lastEvent, content: lastEvent.content + event.data.content }
                  ];
                } else {
                  // Start new text segment
                  return [...prev, { type: 'text', content: event.data.content }];
                }
              });
              onChunk?.(event.data.content);
              break;

            case 'AssistantComplete':
              assistantMessage = event.data.message;
              break;

            case 'ToolUse':
              setToolEvents(prev => [...prev, {
                type: 'tool_use',
                toolName: event.data.tool_name,
                content: JSON.stringify(event.data.tool_input, null, 2),
              }]);
              // Add tool event to streamingEvents (this breaks text continuity)
              setStreamingEvents(prev => [...prev, {
                type: 'tool_use',
                toolName: event.data.tool_name,
                content: JSON.stringify(event.data.tool_input, null, 2),
              }]);
              break;

            case 'ToolResult':
              setToolEvents(prev => [...prev, {
                type: 'tool_result',
                toolName: event.data.tool_name,
                content: event.data.output,
              }]);
              // Skip adding tool_result to streamingEvents (user said to remove it)
              break;

            case 'Error':
              setError(event.data.message);
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
          setError(errorMessage);
          console.error('Design chat stream error:', err);
        }
        return null;
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
        setToolEvents([]);
        setStreamingEvents([]);
        setCurrentUserMessage(null);
        pendingTextRef.current = '';
        abortControllerRef.current = null;
      }
    },
    [taskId, refetchQueries]
  );

  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setCurrentUserMessage(null);
    setStreamingEvents([]);
    // Refetch to get any saved messages
    refetchQueries();
  }, [refetchQueries]);

  return {
    sendStreamingChat,
    cancelStream,
    isStreaming,
    streamingContent,
    streamingEvents,
    toolEvents,
    currentUserMessage,
    error,
  };
}
