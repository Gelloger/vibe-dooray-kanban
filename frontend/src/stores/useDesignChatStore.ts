import { create } from 'zustand';
import type { DesignMessage } from 'shared/types';

// 스트리밍 이벤트 타입 (useDesignSession.ts의 정의와 동일)
export interface StreamingEvent {
  type: 'text' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
}

// 툴 이벤트 타입
export interface ToolEvent {
  type: 'tool_use' | 'tool_result';
  toolName: string;
  content: string;
}

// 태스크별 채팅 상태
interface DesignChatState {
  isStreaming: boolean;
  streamingContent: string;
  streamingEvents: StreamingEvent[];
  toolEvents: ToolEvent[];
  currentUserMessage: DesignMessage | null;
  error: string | null;
  pendingText: string;
}

// 초기 상태
const initialChatState: DesignChatState = {
  isStreaming: false,
  streamingContent: '',
  streamingEvents: [],
  toolEvents: [],
  currentUserMessage: null,
  error: null,
  pendingText: '',
};

// 스토어 인터페이스
interface DesignChatStore {
  // 태스크별 상태 (taskId -> state)
  chats: Record<string, DesignChatState>;

  // AbortController는 별도 관리 (직렬화 불가)
  abortControllers: Record<string, AbortController | null>;

  // 액션
  getState: (taskId: string) => DesignChatState;
  startStreaming: (taskId: string, userMessage: DesignMessage) => void;
  updateStreamingContent: (taskId: string, content: string) => void;
  setStreamingEvents: (taskId: string, events: StreamingEvent[]) => void;
  addStreamingEvent: (taskId: string, event: StreamingEvent) => void;
  setToolEvents: (taskId: string, events: ToolEvent[]) => void;
  updateCurrentUserMessage: (taskId: string, message: DesignMessage | null) => void;
  setPendingText: (taskId: string, text: string) => void;
  appendPendingText: (taskId: string, text: string) => void;
  finishStreaming: (taskId: string) => void;
  setError: (taskId: string, error: string | null) => void;
  cancelStream: (taskId: string) => void;
  setAbortController: (taskId: string, controller: AbortController | null) => void;
  getAbortController: (taskId: string) => AbortController | null;
}

export const useDesignChatStore = create<DesignChatStore>((set, get) => ({
  chats: {},
  abortControllers: {},

  getState: (taskId) => get().chats[taskId] ?? initialChatState,

  startStreaming: (taskId, userMessage) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...initialChatState,
          isStreaming: true,
          currentUserMessage: userMessage,
        },
      },
    })),

  updateStreamingContent: (taskId, content) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          streamingContent: content,
        },
      },
    })),

  setStreamingEvents: (taskId, events) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          streamingEvents: events,
        },
      },
    })),

  addStreamingEvent: (taskId, event) =>
    set((state) => {
      const current = state.chats[taskId] ?? initialChatState;
      return {
        chats: {
          ...state.chats,
          [taskId]: {
            ...current,
            streamingEvents: [...current.streamingEvents, event],
          },
        },
      };
    }),

  setToolEvents: (taskId, events) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          toolEvents: events,
        },
      },
    })),

  updateCurrentUserMessage: (taskId, message) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          currentUserMessage: message,
        },
      },
    })),

  setPendingText: (taskId, text) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          pendingText: text,
        },
      },
    })),

  appendPendingText: (taskId, text) =>
    set((state) => {
      const current = state.chats[taskId] ?? initialChatState;
      return {
        chats: {
          ...state.chats,
          [taskId]: {
            ...current,
            pendingText: current.pendingText + text,
          },
        },
      };
    }),

  finishStreaming: (taskId) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          isStreaming: false,
          streamingContent: '',
          streamingEvents: [],
          toolEvents: [],
          currentUserMessage: null,
          pendingText: '',
        },
      },
    })),

  setError: (taskId, error) =>
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          error,
        },
      },
    })),

  cancelStream: (taskId) => {
    const controller = get().abortControllers[taskId];
    if (controller) {
      controller.abort();
    }
    set((state) => ({
      chats: {
        ...state.chats,
        [taskId]: {
          ...(state.chats[taskId] ?? initialChatState),
          isStreaming: false,
        },
      },
      abortControllers: {
        ...state.abortControllers,
        [taskId]: null,
      },
    }));
  },

  setAbortController: (taskId, controller) =>
    set((state) => ({
      abortControllers: {
        ...state.abortControllers,
        [taskId]: controller,
      },
    })),

  getAbortController: (taskId) => get().abortControllers[taskId] ?? null,
}));

// 편의 훅: 특정 taskId의 상태만 구독
export function useDesignChatState(taskId: string | undefined) {
  return useDesignChatStore((state) =>
    taskId ? state.chats[taskId] ?? initialChatState : initialChatState
  );
}

// 초기 상태 export (테스트 및 타입 참조용)
export { initialChatState };
export type { DesignChatState };
