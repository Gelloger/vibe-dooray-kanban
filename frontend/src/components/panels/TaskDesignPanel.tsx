import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskWithAttemptStatus, NormalizedEntry } from 'shared/types';
import { Loader2, ExternalLink, Bot, RefreshCw, StopCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { CreateDoorayTaskDialog } from '@/components/dialogs/tasks/CreateDoorayTaskDialog';
import { UpdateDoorayBodyDialog } from '@/components/dialogs/tasks/UpdateDoorayBodyDialog';
import { useProject } from '@/contexts/ProjectContext';
import { useDooraySettings } from '@/hooks/useDooray';
import { formatDesignMessagesToMarkdown } from '@/utils/formatDesignMessages';
import {
  useDesignSessionFull,
  useDesignChatStream,
} from '@/hooks/useDesignSession';
import { DesignChatBox } from '@/components/tasks/DesignChatBox';
import {
  VirtuosoMessageList,
  VirtuosoMessageListLicense,
  type DataWithScrollModifier,
  type ScrollModifier,
  type VirtuosoMessageListProps,
} from '@virtuoso.dev/message-list';
import DisplayConversationEntry from '../NormalizedConversation/DisplayConversationEntry';
import {
  designMessageToNormalizedEntry,
  createStreamingEntry,
  createLoadingEntry,
  createToolUseEntry,
} from '@/utils/designMessageAdapter';

interface TaskDesignPanelProps {
  task: TaskWithAttemptStatus;
}

// Entry type for VirtuosoMessageList
type DesignEntryWithKey = {
  patchKey: string;
  type: 'NORMALIZED_ENTRY';
  content: NormalizedEntry;
};

const AutoScrollToBottom: ScrollModifier = {
  type: 'auto-scroll-to-bottom',
  autoScroll: 'smooth',
};

const InitialDataScrollModifier: ScrollModifier = {
  type: 'item-location',
  location: { index: 'LAST' as const, align: 'end' as const },
  purgeItemSizes: true,
};

const ItemContent: VirtuosoMessageListProps<
  DesignEntryWithKey,
  undefined
>['ItemContent'] = ({ data }) => {
  if (data.type === 'NORMALIZED_ENTRY') {
    // Add spacing between messages, less for tool entries
    const isToolEntry = data.content.entry_type.type === 'tool_use';
    const spacing = isToolEntry ? 'mb-1' : 'mb-4';

    return (
      <div className={spacing}>
        <DisplayConversationEntry
          expansionKey={data.patchKey}
          entry={data.content}
        />
      </div>
    );
  }
  return null;
};

const computeItemKey: VirtuosoMessageListProps<
  DesignEntryWithKey,
  undefined
>['computeItemKey'] = ({ data }) => `design-${data.patchKey}`;

/**
 * TaskDesignPanel provides a design/planning phase for tasks.
 * Users can chat with Claude to design their implementation before creating workspaces.
 * Uses the same UI components as In Progress mode for consistent UX.
 */
const TaskDesignPanel = ({ task }: TaskDesignPanelProps) => {
  const { t } = useTranslation(['tasks', 'dooray']);
  const { projectId } = useProject();
  const { isConnected, settings } = useDooraySettings();

  // Fetch design session with messages
  const {
    data: sessionData,
    isLoading,
    error,
  } = useDesignSessionFull(task.id);

  // Streaming chat hook
  const {
    sendStreamingChat,
    cancelStream,
    isStreaming,
    streamingEvents,
    currentUserMessage,
  } = useDesignChatStream(task.id);

  // Handle sending a message (with AI streaming)
  const handleSendMessage = useCallback(
    async (content: string) => {
      await sendStreamingChat(content);
    },
    [sendStreamingChat]
  );

  // Check if we can create a Dooray task
  const hasDoorayIntegration = Boolean(
    task.dooray_task_id && task.dooray_project_id
  );
  const canCreateDoorayTask =
    isConnected && settings?.selected_project_id && !hasDoorayIntegration;

  const handleCreateDoorayTask = async () => {
    const designContext = sessionData?.messages
      ?.map((m) => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    await CreateDoorayTaskDialog.show({
      localProjectId: projectId,
      sessionId: sessionData?.session?.id,
      taskId: task.id,
      initialTitle: task.title,
      initialBody: task.description
        ? `${task.description}\n\n---\n\n## Design Discussion\n\n${designContext || ''}`
        : designContext || undefined,
      originalTaskId: task.id,
    });
  };

  // Convert messages to NormalizedEntry format
  const messages = useMemo(
    () => sessionData?.messages ?? [],
    [sessionData?.messages]
  );
  const hasMessages = messages.length > 0;

  const normalizedEntries = useMemo((): DesignEntryWithKey[] => {
    // During streaming, exclude the current user message from cache
    // (we'll add currentUserMessage directly to ensure correct ordering)
    const filteredMessages = isStreaming && currentUserMessage
      ? messages.filter((msg) => msg.id !== currentUserMessage.id && !msg.id.startsWith('temp-'))
      : messages;

    const entries: DesignEntryWithKey[] = filteredMessages.map((msg) => ({
      patchKey: msg.id,
      type: 'NORMALIZED_ENTRY' as const,
      content: designMessageToNormalizedEntry(msg),
    }));

    // Add streaming content if currently streaming
    if (isStreaming) {
      // First, add the current user message (the question being asked)
      if (currentUserMessage) {
        entries.push({
          patchKey: currentUserMessage.id,
          type: 'NORMALIZED_ENTRY' as const,
          content: designMessageToNormalizedEntry(currentUserMessage),
        });
      }

      // Then, add streaming events in order (preserves text/tool interleaving)
      if (streamingEvents.length > 0) {
        let textSegmentIndex = 0;
        let toolIndex = 0;

        streamingEvents.forEach((event) => {
          if (event.type === 'text') {
            entries.push({
              patchKey: `streaming-text-${textSegmentIndex}`,
              type: 'NORMALIZED_ENTRY' as const,
              content: createStreamingEntry(event.content),
            });
            textSegmentIndex++;
          } else if (event.type === 'tool_use') {
            entries.push({
              patchKey: `tool-${event.toolName}-${toolIndex}`,
              type: 'NORMALIZED_ENTRY' as const,
              content: createToolUseEntry(event.toolName!, event.content),
            });
            toolIndex++;
          }
        });
      } else {
        // Show loading indicator when streaming but no events yet
        entries.push({
          patchKey: 'streaming-loading',
          type: 'NORMALIZED_ENTRY' as const,
          content: createLoadingEntry(),
        });
      }
    }

    return entries;
  }, [messages, isStreaming, streamingEvents, currentUserMessage]);

  // Track if this is the initial render to avoid scroll jumping
  const isInitialRender = useRef(true);
  const wasStreaming = useRef(false);

  // Manage scroll modifier based on streaming state
  const channelData = useMemo((): DataWithScrollModifier<DesignEntryWithKey> => {
    let scrollModifier: ScrollModifier | undefined;

    if (isStreaming) {
      // During streaming, always auto-scroll to bottom
      scrollModifier = AutoScrollToBottom;
      wasStreaming.current = true;
    } else if (isInitialRender.current && normalizedEntries.length > 0) {
      // On initial render with existing messages, scroll to bottom
      scrollModifier = InitialDataScrollModifier;
      isInitialRender.current = false;
    } else if (wasStreaming.current) {
      // Just finished streaming - no scroll modifier to preserve position
      wasStreaming.current = false;
    }
    // Otherwise: no scroll modifier - user controls their own scroll

    return {
      data: normalizedEntries,
      scrollModifier: scrollModifier as ScrollModifier,
    };
  }, [normalizedEntries, isStreaming]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-destructive py-4">
        {t('taskPanel.design.error')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 min-h-0">
        {hasMessages || isStreaming ? (
          <VirtuosoMessageListLicense
            licenseKey={import.meta.env.VITE_PUBLIC_REACT_VIRTUOSO_LICENSE_KEY}
          >
            <VirtuosoMessageList<DesignEntryWithKey, undefined>
              className="h-full"
              data={channelData}
              initialLocation={{ index: 'LAST' as const, align: 'end' as const }}
              computeItemKey={computeItemKey}
              ItemContent={ItemContent}
              Header={() => <div className="h-2" />}
              Footer={() => <div className="h-2" />}
            />
          </VirtuosoMessageListLicense>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {t('taskPanel.design.title')}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t(
                'taskPanel.design.emptyState',
                'Start a conversation to plan your implementation. Describe what you want to build and get suggestions from the AI.'
              )}
            </p>
          </div>
        )}
      </div>

      {/* Chat input */}
      <div className="border-t p-4">
        {isStreaming && (
          <div className="flex justify-center mb-3">
            <Button
              onClick={cancelStream}
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              <StopCircle className="h-4 w-4 mr-2" />
              {t('taskPanel.design.stopButton', 'Stop')}
            </Button>
          </div>
        )}
        <DesignChatBox
          onSend={handleSendMessage}
          isLoading={isStreaming}
          placeholder={t(
            'taskPanel.design.chatPlaceholder',
            'Describe what you want to build...'
          )}
        />
      </div>

      {/* Actions footer */}
      {(canCreateDoorayTask || hasDoorayIntegration) && (
        <div className="border-t p-4 space-y-2">
          {canCreateDoorayTask && (
            <Button
              onClick={handleCreateDoorayTask}
              variant="outline"
              className="w-full"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {t('dooray:createTask.title')}
            </Button>
          )}

          {hasDoorayIntegration && (
            <>
              <Button
                onClick={() => {
                  const claudeContent = formatDesignMessagesToMarkdown(messages);
                  const existingBody = task.description || '';
                  // 기존 본문에 Claude 대화 내용을 추가
                  const body = existingBody
                    ? `${existingBody}\n\n---\n\n## Design Discussion\n\n${claudeContent}`
                    : claudeContent;
                  UpdateDoorayBodyDialog.show({
                    doorayTaskId: task.dooray_task_id!,
                    initialBody: body,
                    taskId: task.id,
                    doorayProjectId: task.dooray_project_id,
                  });
                }}
                variant="outline"
                className="w-full"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('dooray:updateBody.syncButton')}
              </Button>
              <div className="text-xs text-muted-foreground text-center">
                {t('taskPanel.design.linkedToDooray', {
                  number: task.dooray_task_number,
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskDesignPanel;
