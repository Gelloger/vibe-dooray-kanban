import { useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskWithAttemptStatus, DesignMessage } from 'shared/types';
import { Loader2, ExternalLink, User, Bot } from 'lucide-react';
import { Button } from '../ui/button';
import { CreateDoorayTaskDialog } from '@/components/dialogs/tasks/CreateDoorayTaskDialog';
import { useProject } from '@/contexts/ProjectContext';
import { useDooraySettings } from '@/hooks/useDooray';
import {
  useDesignSessionFull,
  useDesignChatStream,
} from '@/hooks/useDesignSession';
import { DesignChatBox } from '@/components/tasks/DesignChatBox';
import { cn } from '@/lib/utils';

interface TaskDesignPanelProps {
  task: TaskWithAttemptStatus;
}

/**
 * Message bubble component for design chat
 */
function DesignMessageBubble({ message }: { message: DesignMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Bot className="h-4 w-4" />
        )}
      </div>

      {/* Message content */}
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </p>
        <p
          className={cn(
            'text-xs mt-1',
            isUser ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}
        >
          {new Date(message.created_at).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

/**
 * Streaming message bubble for real-time AI responses
 */
function StreamingBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-3 flex-row">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-muted">
        <Bot className="h-4 w-4" />
      </div>

      {/* Message content */}
      <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
        <p className="text-sm whitespace-pre-wrap break-words">
          {content}
          <span className="inline-block w-2 h-4 ml-1 bg-current opacity-50 animate-pulse" />
        </p>
      </div>
    </div>
  );
}

/**
 * TaskDesignPanel provides a design/planning phase for tasks.
 * Users can chat with Claude to design their implementation before creating workspaces.
 */
const TaskDesignPanel = ({ task }: TaskDesignPanelProps) => {
  const { t } = useTranslation(['tasks', 'dooray']);
  const { projectId } = useProject();
  const { isConnected, settings } = useDooraySettings();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch design session with messages
  const {
    data: sessionData,
    isLoading,
    error,
  } = useDesignSessionFull(task.id);

  // Streaming chat hook
  const {
    sendStreamingChat,
    isStreaming,
    streamingContent,
  } = useDesignChatStream(task.id);

  // Scroll to bottom when messages change or streaming content updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessionData?.messages, streamingContent]);

  // Handle sending a message (with AI streaming)
  const handleSendMessage = useCallback(
    async (content: string) => {
      // Use the streaming AI chat endpoint for real-time responses
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
    // Extract design conversation as context for the Dooray task
    const designContext = sessionData?.messages
      ?.map((m) => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    await CreateDoorayTaskDialog.show({
      localProjectId: projectId,
      sessionId: sessionData?.session?.id,
      initialTitle: task.title,
      initialBody: task.description
        ? `${task.description}\n\n---\n\n## Design Discussion\n\n${designContext || ''}`
        : designContext || undefined,
      originalTaskId: task.id,
    });
  };

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

  const messages = sessionData?.messages ?? [];
  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {hasMessages || isStreaming ? (
          <>
            {messages.map((message) => (
              <DesignMessageBubble key={message.id} message={message} />
            ))}
            {/* Show streaming content in real-time */}
            {isStreaming && streamingContent && (
              <StreamingBubble content={streamingContent} />
            )}
            <div ref={messagesEndRef} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Bot className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {t('taskPanel.design.title')}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('taskPanel.design.emptyState',
                'Start a conversation to plan your implementation. Describe what you want to build and get suggestions from the AI.'
              )}
            </p>
          </div>
        )}
      </div>

      {/* Chat input */}
      <div className="border-t p-4">
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
            <div className="text-xs text-muted-foreground text-center">
              {t('taskPanel.design.linkedToDooray', {
                number: task.dooray_task_number,
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TaskDesignPanel;
