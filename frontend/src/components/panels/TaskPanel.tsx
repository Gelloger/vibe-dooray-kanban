import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels';
import { useProject } from '@/contexts/ProjectContext';
import { useTaskAttemptsWithSessions } from '@/hooks/useTaskAttempts';
import { useTaskAttemptWithSession } from '@/hooks/useTaskAttempt';
import { useNavigateWithSearch } from '@/hooks';
import { paths } from '@/lib/paths';
import type { TaskWithAttemptStatus } from 'shared/types';
import type { WorkspaceWithSession } from '@/types/attempt';
import { NewCardContent } from '../ui/new-card';
import { Button } from '../ui/button';
import { PlusIcon, PencilRuler, ListTodo } from 'lucide-react';
import { CreateAttemptDialog } from '@/components/dialogs/tasks/CreateAttemptDialog';
import WYSIWYGEditor from '@/components/ui/wysiwyg';
import { DataTable, type ColumnDef } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import TaskDesignPanel from './TaskDesignPanel';

type TabType = 'design' | 'attempts';

interface TaskPanelProps {
  task: TaskWithAttemptStatus | null;
}

const TaskPanel = ({ task }: TaskPanelProps) => {
  const { t } = useTranslation('tasks');
  const navigate = useNavigateWithSearch();
  const { projectId } = useProject();
  const [activeTab, setActiveTab] = useState<TabType>('attempts');

  const {
    data: attempts = [],
    isLoading: isAttemptsLoading,
    isError: isAttemptsError,
  } = useTaskAttemptsWithSessions(task?.id);

  const { data: parentAttempt, isLoading: isParentLoading } =
    useTaskAttemptWithSession(task?.parent_workspace_id || undefined);

  const formatTimeAgo = (iso: string) => {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const absSec = Math.round(Math.abs(diffMs) / 1000);

    const rtf =
      typeof Intl !== 'undefined' &&
      typeof Intl.RelativeTimeFormat === 'function'
        ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
        : null;

    const to = (value: number, unit: Intl.RelativeTimeFormatUnit) =>
      rtf
        ? rtf.format(-value, unit)
        : `${value} ${unit}${value !== 1 ? 's' : ''} ago`;

    if (absSec < 60) return to(Math.round(absSec), 'second');
    const mins = Math.round(absSec / 60);
    if (mins < 60) return to(mins, 'minute');
    const hours = Math.round(mins / 60);
    if (hours < 24) return to(hours, 'hour');
    const days = Math.round(hours / 24);
    if (days < 30) return to(days, 'day');
    const months = Math.round(days / 30);
    if (months < 12) return to(months, 'month');
    const years = Math.round(months / 12);
    return to(years, 'year');
  };

  const displayedAttempts = [...attempts].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (!task) {
    return (
      <div className="text-muted-foreground">
        {t('taskPanel.noTaskSelected')}
      </div>
    );
  }

  const titleContent = `# ${task.title || 'Task'}`;
  const descriptionContent = task.description || '';
  const doorayTaskNumber = task.dooray_task_number;

  const attemptColumns: ColumnDef<WorkspaceWithSession>[] = [
    {
      id: 'executor',
      header: '',
      accessor: (attempt) => attempt.session?.executor || 'Base Agent',
      className: 'pr-4',
    },
    {
      id: 'branch',
      header: '',
      accessor: (attempt) => attempt.branch || '—',
      className: 'pr-4',
    },
    {
      id: 'time',
      header: '',
      accessor: (attempt) => formatTimeAgo(attempt.created_at),
      className: 'pr-0 text-right',
    },
  ];

  // Resizable panels layout storage
  const { defaultLayout, onLayoutChange } = useDefaultLayout({
    groupId: 'taskPanel-v2',  // Changed to reset cached layout
    storage: localStorage,
  });

  return (
    <>
      <NewCardContent className="h-full flex flex-col">
        <Group
          orientation="vertical"
          className="h-full min-h-0"
          defaultLayout={defaultLayout}
          onLayoutChange={onLayoutChange}
        >
            {/* Task Header Panel */}
            <Panel
              id="task-header"
              defaultSize={30}
              minSize={10}
              className="min-h-0 overflow-hidden"
            >
              <div className="h-full min-h-0 overflow-y-auto p-6 pb-0 space-y-3">
                <WYSIWYGEditor value={titleContent} disabled />
                {doorayTaskNumber && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono">
                      {doorayTaskNumber}
                    </span>
                  </div>
                )}
                {descriptionContent && (
                  <WYSIWYGEditor value={descriptionContent} disabled />
                )}
              </div>
            </Panel>

            {/* Resize Handle */}
            <Separator
              id="handle-task-panel"
              className="h-2 bg-transparent hover:bg-border/50 cursor-row-resize transition-colors"
            />

            {/* Tab Content Panel - 2단계: 탭 네비게이션 추가 */}
            <Panel
              id="tab-content"
              defaultSize={70}
              minSize={10}
              className="min-h-0 overflow-hidden"
            >
              <div className="h-full min-h-0 flex flex-col px-6 pb-6 overflow-hidden">
                {/* Tab Navigation */}
                <div className="flex gap-1 mb-4 border-b border-border flex-shrink-0">
                  <button
                    onClick={() => setActiveTab('design')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
                      'border-b-2 -mb-px',
                      activeTab === 'design'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <PencilRuler size={14} />
                    {t('taskPanel.tabs.design')}
                  </button>
                  <button
                    onClick={() => setActiveTab('attempts')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
                      'border-b-2 -mb-px',
                      activeTab === 'attempts'
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <ListTodo size={14} />
                    {t('taskPanel.tabs.attempts')}
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  {activeTab === 'design' ? (
                    <TaskDesignPanel task={task} />
                  ) : (
                    <div className="h-full min-h-0 overflow-y-auto space-y-4">
                      {task.parent_workspace_id && (
                        <DataTable
                          data={parentAttempt ? [parentAttempt] : []}
                          columns={attemptColumns}
                          keyExtractor={(attempt) => attempt.id}
                          onRowClick={(attempt) => {
                            if (projectId) {
                              navigate(
                                paths.attempt(projectId, attempt.task_id, attempt.id)
                              );
                            }
                          }}
                          isLoading={isParentLoading}
                          headerContent="Parent Attempt"
                        />
                      )}

                      {isAttemptsLoading ? (
                        <div className="text-muted-foreground">
                          {t('taskPanel.loadingAttempts')}
                        </div>
                      ) : isAttemptsError ? (
                        <div className="text-destructive">
                          {t('taskPanel.errorLoadingAttempts')}
                        </div>
                      ) : (
                        <DataTable
                          data={displayedAttempts}
                          columns={attemptColumns}
                          keyExtractor={(attempt) => attempt.id}
                          onRowClick={(attempt) => {
                            if (projectId && task.id) {
                              navigate(paths.attempt(projectId, task.id, attempt.id));
                            }
                          }}
                          emptyState={t('taskPanel.noAttempts')}
                          headerContent={
                            <div className="w-full flex text-left">
                              <span className="flex-1">
                                {t('taskPanel.attemptsCount', {
                                  count: displayedAttempts.length,
                                })}
                              </span>
                              <span>
                                <Button
                                  variant="icon"
                                  onClick={() =>
                                    CreateAttemptDialog.show({
                                      taskId: task.id,
                                    })
                                  }
                                >
                                  <PlusIcon size={16} />
                                </Button>
                              </span>
                            </div>
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
        </Group>
      </NewCardContent>
    </>
  );
};

export default TaskPanel;
