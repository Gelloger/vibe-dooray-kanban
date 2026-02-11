import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { useForm, useStore } from '@tanstack/react-form';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCreateDoorayTask, useDooraySettings, useDoorayProjects, useDoorayTags } from '@/hooks/useDooray';
import { useProjects } from '@/hooks/useProjects';
import { tasksApi } from '@/lib/api';
import { Loader2, Eye, EyeOff, ExternalLink, AlertCircle, CheckCircle, Bot, ChevronDown, ChevronUp, Link } from 'lucide-react';
import type { Project, PatchType } from 'shared/types';
import { extractBmadOutput } from '@/utils/conversationUtils';
import { streamJsonPatchEntries } from '@/utils/streamJsonPatchEntries';
import type { PatchTypeWithKey } from '@/hooks/useConversationHistory';
import { AiSummaryPanel } from '../dooray-ai/AiSummaryPanel';
import { AiSplitPanel } from '../dooray-ai/AiSplitPanel';
import type { SplitTask, SummaryApplyMode } from '../dooray-ai/types';

const DOORAY_URL_PATTERN =
  /https:\/\/[\w.-]+\.dooray\.com\/(?:project\/tasks\/\d+|task\/\d+\/\d+)/;

export interface CreateDoorayTaskDialogProps {
  initialTitle?: string;
  initialBody?: string;
  localProjectId?: string;
  sessionId?: string;
  /** Task ID for design session AI features */
  taskId?: string;
  /** If provided, the original task will be deleted after successful Dooray task creation */
  originalTaskId?: string;
  /** Pre-filled reference Dooray URL (e.g., QA task URL) */
  initialReferenceUrl?: string;
}

type FormValues = {
  subject: string;
  body: string;
  localProjectId: string;
  tagIds: string[];
};

type Message = {
  type: 'success' | 'error';
  text: string;
};

// Fetch entries for a single execution process
async function fetchExecutionProcessEntries(executionProcessId: string): Promise<PatchType[]> {
  const url = `/api/execution-processes/${executionProcessId}/normalized-logs/ws`;

  return new Promise<PatchType[]>((resolve) => {
    let resolved = false;

    const controller = streamJsonPatchEntries<PatchType>(url, {
      onFinished: (allEntries) => {
        if (!resolved) {
          resolved = true;
          controller.close();
          resolve(allEntries);
        }
      },
      onError: () => {
        if (!resolved) {
          resolved = true;
          controller.close();
          resolve(controller.getEntries());
        }
      },
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        controller.close();
        resolve(controller.getEntries());
      }
    }, 10000);
  });
}

const CreateDoorayTaskDialogImpl = NiceModal.create<CreateDoorayTaskDialogProps>(
  ({ initialTitle = '', initialBody = '', localProjectId: initialLocalProjectId, sessionId, taskId, originalTaskId, initialReferenceUrl = '' }) => {
    const modal = useModal();
    const { t } = useTranslation(['dooray', 'common']);
    const { createTask, isCreating } = useCreateDoorayTask();
    const { settings, isConnected } = useDooraySettings();
    const { projects: doorayProjects } = useDoorayProjects(isConnected);
    const { projects: localProjects } = useProjects();
    const { tagGroups, isLoading: isLoadingTags } = useDoorayTags(settings?.selected_project_id ?? null);
    const [showPreview, setShowPreview] = useState(false);
    const [message, setMessage] = useState<Message | null>(null);
    const [extractedTitle, setExtractedTitle] = useState(initialTitle);
    const [extractedBody, setExtractedBody] = useState(initialBody);
    const [referenceUrl, setReferenceUrl] = useState(initialReferenceUrl);

    // AI Panel state
    const [aiPanelOpen, setAiPanelOpen] = useState(false);
    const [splitTasks, setSplitTasks] = useState<SplitTask[]>([]);

    // Get mandatory tag groups
    const mandatoryTagGroups = tagGroups.filter((g) => g.mandatory);

    // Check if AI features are available (requires taskId for design session)
    const isAiAvailable = !!taskId;

    // Fetch entries from session and extract BMAD output
    useEffect(() => {
      if (!sessionId || initialTitle || initialBody) return;

      const fetchAndExtract = async () => {
        try {
          // Fetch execution processes for the session
          const response = await fetch(`/api/execution-processes?session_id=${sessionId}`);
          if (!response.ok) return;

          const data = await response.json();
          const processes = data.data || [];

          if (processes.length === 0) return;

          // Get entries from the latest process
          const latestProcess = processes[processes.length - 1];
          const entries = await fetchExecutionProcessEntries(latestProcess.id);

          const entriesWithKey: PatchTypeWithKey[] = entries.map((entry, index) => ({
            ...entry,
            patchKey: `${latestProcess.id}:${index}`,
            executionProcessId: latestProcess.id,
          }));

          // Extract BMAD output
          const { title, body } = extractBmadOutput(entriesWithKey);
          if (title) setExtractedTitle(title);
          if (body) setExtractedBody(body);
        } catch (error) {
          console.error('Failed to fetch session entries:', error);
        }
      };

      fetchAndExtract();
    }, [sessionId, initialTitle, initialBody]);

    // Find default local project
    const defaultLocalProjectId = initialLocalProjectId || localProjects[0]?.id || '';

    const form = useForm({
      defaultValues: {
        subject: extractedTitle || initialTitle,
        body: extractedBody || initialBody,
        localProjectId: defaultLocalProjectId,
        tagIds: [] as string[],
      } as FormValues,
      onSubmit: async ({ value }) => {
        setMessage(null);

        if (!settings?.selected_project_id) {
          setMessage({
            type: 'error',
            text: t('dooray:createTask.pleaseSelectProject'),
          });
          return;
        }

        // Check mandatory tags are selected
        for (const group of mandatoryTagGroups) {
          const selectedFromGroup = value.tagIds.filter((id) =>
            group.tags.some((tag) => tag.id === id)
          );
          if (selectedFromGroup.length === 0) {
            setMessage({
              type: 'error',
              text: t('dooray:createTask.mandatoryTagRequired', {
                groupName: group.name || 'Tag Group',
              }),
            });
            return;
          }
        }

        // Check if we have split tasks to create
        const selectedSplitTasks = splitTasks.filter((t) => t.selected && t.title.trim());

        try {
          if (selectedSplitTasks.length > 0) {
            // Create parent task first
            const validRefUrl = referenceUrl && DOORAY_URL_PATTERN.test(referenceUrl) ? referenceUrl : null;
            const parentResult = await createTask({
              dooray_project_id: settings.selected_project_id,
              subject: value.subject,
              body: value.body || null,
              local_project_id: value.localProjectId,
              tag_ids: value.tagIds.length > 0 ? value.tagIds : null,
              parent_task_id: null,
              reference_dooray_url: validRefUrl,
            });

            if (!parentResult.success || !parentResult.dooray_task_id) {
              setMessage({
                type: 'error',
                text: parentResult.message || t('dooray:createTask.failed'),
              });
              return;
            }

            // Create subtasks
            let successCount = 0;
            let failCount = 0;

            for (const subtask of selectedSplitTasks) {
              try {
                const subtaskResult = await createTask({
                  dooray_project_id: settings.selected_project_id,
                  subject: subtask.title,
                  body: subtask.description || null,
                  local_project_id: value.localProjectId,
                  tag_ids: value.tagIds.length > 0 ? value.tagIds : null,
                  parent_task_id: parentResult.dooray_task_id,
                  reference_dooray_url: null,
                });

                if (subtaskResult.success) {
                  successCount++;
                } else {
                  failCount++;
                }
              } catch {
                failCount++;
              }
            }

            // Delete original task if provided
            if (originalTaskId) {
              try {
                await tasksApi.delete(originalTaskId);
              } catch (deleteError) {
                console.warn('Failed to delete original task:', deleteError);
              }
            }

            if (failCount === 0) {
              setMessage({
                type: 'success',
                text: t('dooray:createTask.tasksCreated', {
                  count: successCount + 1,
                }),
              });
            } else {
              setMessage({
                type: 'success',
                text: t('dooray:createTask.tasksPartiallyCreated', {
                  success: successCount + 1,
                  fail: failCount,
                }),
              });
            }

            setTimeout(() => modal.remove(), 1500);
          } else {
            // Single task creation (original logic)
            const validRefUrl = referenceUrl && DOORAY_URL_PATTERN.test(referenceUrl) ? referenceUrl : null;
            const result = await createTask({
              dooray_project_id: settings.selected_project_id,
              subject: value.subject,
              body: value.body || null,
              local_project_id: value.localProjectId,
              tag_ids: value.tagIds.length > 0 ? value.tagIds : null,
              parent_task_id: null,
              reference_dooray_url: validRefUrl,
            });

            if (result.success) {
              if (originalTaskId) {
                try {
                  await tasksApi.delete(originalTaskId);
                } catch (deleteError) {
                  console.warn('Failed to delete original task:', deleteError);
                }
              }

              setMessage({
                type: 'success',
                text: result.dooray_task_number
                  ? t('dooray:createTask.taskCreatedWithNumber', {
                      number: Number(result.dooray_task_number),
                    })
                  : t('dooray:createTask.taskCreated'),
              });
              setTimeout(() => modal.remove(), 1500);
            } else {
              setMessage({
                type: 'error',
                text: result.message || t('dooray:createTask.failed'),
              });
            }
          }
        } catch (error) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : String(error),
          });
        }
      },
      validators: {
        onMount: ({ value }) => {
          if (!value.subject.trim()) return 'Subject is required';
          if (!value.localProjectId) return 'Local project is required';
        },
        onChange: ({ value }) => {
          if (!value.subject.trim()) return 'Subject is required';
          if (!value.localProjectId) return 'Local project is required';
        },
      },
    });

    const canSubmit = useStore(form.store, (state) => state.canSubmit);
    const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

    // Get form values for AI panels
    const currentSubject = useStore(form.store, (state) => state.values.subject);
    const currentBody = useStore(form.store, (state) => state.values.body);

    // Update local project ID when localProjects load
    useEffect(() => {
      if (!initialLocalProjectId && localProjects.length > 0) {
        const currentValue = form.getFieldValue('localProjectId');
        if (!currentValue) {
          form.setFieldValue('localProjectId', localProjects[0].id);
        }
      }
    }, [localProjects, initialLocalProjectId, form]);

    // Update form when extracted content becomes available
    useEffect(() => {
      if (extractedTitle && !form.getFieldValue('subject')) {
        form.setFieldValue('subject', extractedTitle);
      }
      if (extractedBody && !form.getFieldValue('body')) {
        form.setFieldValue('body', extractedBody);
      }
    }, [extractedTitle, extractedBody, form]);

    const handleClose = useCallback(
      (open: boolean) => {
        if (!open && !isSubmitting) {
          modal.remove();
        }
      },
      [modal, isSubmitting]
    );

    // Apply summary result
    const handleApplySummary = useCallback((summary: string, mode: SummaryApplyMode) => {
      switch (mode) {
        case 'replace':
          form.setFieldValue('body', summary);
          break;
        case 'prepend':
          form.setFieldValue('body', `${summary}\n\n---\n\n${currentBody}`);
          break;
        case 'title':
          form.setFieldValue('subject', summary);
          break;
      }
    }, [form, currentBody]);

    // Handle parent title change from split
    const handleParentTitleChange = useCallback((title: string) => {
      form.setFieldValue('subject', title);
    }, [form]);

    const selectedDoorayProject = doorayProjects.find(
      (p) => p.id === settings?.selected_project_id
    );

    // Check if split tasks are selected
    const hasSelectedSplitTasks = splitTasks.some((t) => t.selected && t.title.trim());

    if (!isConnected) {
      return (
        <Dialog open={modal.visible} onOpenChange={handleClose}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{t('dooray:createTask.title')}</DialogTitle>
            </DialogHeader>
            <div className="py-4 text-center">
              <p className="text-muted-foreground">
                {t('dooray:createTask.notConnected')}
              </p>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return (
      <Dialog open={modal.visible} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t('dooray:createTask.title')}
              {selectedDoorayProject && (
                <span className="text-sm font-normal text-muted-foreground">
                  → {selectedDoorayProject.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="space-y-4"
          >
            {/* Message Alert */}
            {message && (
              <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
                {message.type === 'error' ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <CheckCircle className="h-4 w-4" />
                )}
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="dooray-task-subject">
                {t('dooray:createTask.subjectLabel')} *
              </Label>
              <form.Field name="subject">
                {(field) => (
                  <Input
                    id="dooray-task-subject"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder={t('dooray:createTask.subjectPlaceholder')}
                    disabled={isCreating}
                    autoFocus
                  />
                )}
              </form.Field>
            </div>

            {/* Body */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="dooray-task-body">
                  {t('dooray:createTask.bodyLabel')}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  className="h-7 px-2"
                >
                  {showPreview ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-1" />
                      {t('dooray:createTask.hidePreview')}
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-1" />
                      {t('dooray:createTask.showPreview')}
                    </>
                  )}
                </Button>
              </div>
              <form.Field name="body">
                {(field) =>
                  showPreview ? (
                    <div className="min-h-[150px] max-h-[200px] overflow-auto p-3 border rounded-md bg-muted/30 prose prose-sm dark:prose-invert max-w-none">
                      {field.state.value ? (
                        <pre className="whitespace-pre-wrap font-sans text-sm">
                          {field.state.value}
                        </pre>
                      ) : (
                        <p className="text-muted-foreground italic">
                          {t('dooray:createTask.noContent')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Textarea
                      id="dooray-task-body"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder={t('dooray:createTask.bodyPlaceholder')}
                      disabled={isCreating}
                      className="min-h-[150px] max-h-[200px] font-mono text-sm"
                    />
                  )
                }
              </form.Field>
              <p className="text-xs text-muted-foreground">
                {t('dooray:createTask.markdownSupported')}
              </p>
            </div>

            {/* AI Panel */}
            {isAiAvailable && (
              <Collapsible open={aiPanelOpen} onOpenChange={setAiPanelOpen}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Bot className="h-4 w-4" />
                      {t('dooray:ai.panelTitle', 'AI 요약/분할')}
                    </span>
                    {aiPanelOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4 space-y-4">
                  {/* Summary Panel */}
                  <div className="border rounded-md p-3 space-y-3">
                    <Label className="text-sm font-medium">
                      {t('dooray:ai.summarySection', '요약')}
                    </Label>
                    <AiSummaryPanel
                      taskId={taskId}
                      body={currentBody}
                      onApply={handleApplySummary}
                      disabled={isCreating}
                      doorayProjectId={settings?.selected_project_id}
                    />
                  </div>

                  {/* Split Panel */}
                  <div className="border rounded-md p-3 space-y-3">
                    <Label className="text-sm font-medium">
                      {t('dooray:ai.splitSection', '태스크 분할')}
                    </Label>
                    <AiSplitPanel
                      taskId={taskId}
                      title={currentSubject}
                      body={currentBody}
                      splitTasks={splitTasks}
                      onSplitTasksChange={setSplitTasks}
                      onParentTitleChange={handleParentTitleChange}
                      disabled={isCreating}
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Tag Selection for Mandatory Tag Groups */}
            {mandatoryTagGroups.length > 0 && (
              <div className="space-y-3">
                <Label>{t('dooray:createTask.tagsLabel')} *</Label>
                {isLoadingTags ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('dooray:createTask.loadingTags')}
                  </div>
                ) : (
                  <form.Field name="tagIds">
                    {(field) => (
                      <div className="space-y-3">
                        {mandatoryTagGroups.map((group) => (
                          <div key={group.id} className="space-y-2">
                            <p className="text-sm font-medium">
                              {group.name || 'Tags'}
                              {group.selectOne && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({t('dooray:createTask.selectOne')})
                                </span>
                              )}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {group.tags.map((tag) => {
                                const isSelected = field.state.value.includes(tag.id);
                                return (
                                  <Button
                                    key={tag.id}
                                    type="button"
                                    variant={isSelected ? 'default' : 'outline'}
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={isCreating}
                                    onClick={() => {
                                      const currentValues = [...field.state.value];
                                      if (isSelected) {
                                        // Remove tag
                                        field.handleChange(
                                          currentValues.filter((id) => id !== tag.id)
                                        );
                                      } else {
                                        if (group.selectOne) {
                                          // Remove other tags from same group, add this one
                                          const otherGroupTagIds = group.tags.map((t) => t.id);
                                          const filtered = currentValues.filter(
                                            (id) => !otherGroupTagIds.includes(id)
                                          );
                                          field.handleChange([...filtered, tag.id]);
                                        } else {
                                          // Add tag
                                          field.handleChange([...currentValues, tag.id]);
                                        }
                                      }
                                    }}
                                  >
                                    {tag.name}
                                  </Button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </form.Field>
                )}
                <p className="text-xs text-muted-foreground">
                  {t('dooray:createTask.mandatoryTagsDescription')}
                </p>
              </div>
            )}

            {/* Reference Dooray URL */}
            <div className="space-y-2">
              <Label htmlFor="reference-dooray-url" className="flex items-center gap-1">
                <Link className="h-3.5 w-3.5" />
                {t('dooray:createTask.referenceUrlLabel', '참조 태스크 URL')}
              </Label>
              <Input
                id="reference-dooray-url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder={t('dooray:createTask.referenceUrlPlaceholder', 'https://xxx.dooray.com/project/tasks/...')}
                disabled={isCreating}
              />
              {referenceUrl && !DOORAY_URL_PATTERN.test(referenceUrl) && (
                <p className="text-xs text-destructive">
                  {t('dooray:createTask.invalidDoorayUrl', '유효한 Dooray 태스크 URL을 입력하세요.')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('dooray:createTask.referenceUrlDescription', 'QA 태스크 등 참조할 태스크 URL을 입력하면, 생성 시 자동으로 참조가 등록됩니다.')}
              </p>
            </div>

            {/* Local Project Selection */}
            <div className="space-y-2">
              <Label htmlFor="local-project">
                {t('dooray:createTask.localProjectLabel')} *
              </Label>
              <form.Field name="localProjectId">
                {(field) => (
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value)}
                    disabled={isCreating}
                  >
                    <SelectTrigger id="local-project">
                      <SelectValue
                        placeholder={t('dooray:createTask.selectLocalProject')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {localProjects.map((project: Project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </form.Field>
              <p className="text-xs text-muted-foreground">
                {t('dooray:createTask.localProjectDescription')}
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => modal.remove()}
                disabled={isCreating}
              >
                {t('common:cancel')}
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit || isCreating}
                className="min-w-[120px]"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('dooray:createTask.creating')}
                  </>
                ) : hasSelectedSplitTasks ? (
                  <>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t('dooray:createTask.createWithSubtasks', '태스크 생성 ({{count}}개)', {
                      count: splitTasks.filter((t) => t.selected && t.title.trim()).length + 1,
                    })}
                  </>
                ) : (
                  <>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t('dooray:createTask.create')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateDoorayTaskDialog = defineModal<
  CreateDoorayTaskDialogProps,
  void
>(CreateDoorayTaskDialogImpl);
