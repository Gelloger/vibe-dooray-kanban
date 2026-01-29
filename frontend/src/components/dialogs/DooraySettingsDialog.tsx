import { useState, useEffect, useMemo } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Check, Link2Off, RefreshCw, Tag, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import {
  useDooraySettings,
  useDooraySync,
  useDoorayTags,
  useUpdateDoorayTags,
  useDoorayImportByNumber,
  useDoorayProjects,
  useUpdateDoorayProject,
} from '@/hooks/useDooray';
import type { SyncResult, ImportResult, DoorayProject } from 'shared/types';

type Step = 'token' | 'projects' | 'connected' | 'tags';

export interface DooraySettingsDialogProps {
  projectId?: string; // Local vibe-kanban project ID for sync
}

const DooraySettingsDialogImpl = NiceModal.create<DooraySettingsDialogProps>(
  ({ projectId }) => {
    const modal = useModal();

    const [step, setStep] = useState<Step>('token');
    const [token, setToken] = useState('');
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [taskNumber, setTaskNumber] = useState('');
    const [importResult, setImportResult] = useState<ImportResult | null>(null);

    const {
      settings,
      isConnected,
      saveSettings,
      deleteSettings,
      isSaving,
      isDeleting,
      isLoading: isLoadingSettings,
    } = useDooraySettings();

    const { syncTasks, isSyncing } = useDooraySync();
    const { tagGroups, isLoading: isLoadingTags } = useDoorayTags(settings?.selected_project_id || null);
    const { updateSelectedTags, isUpdating: isUpdatingTags } = useUpdateDoorayTags();
    const { importByNumber, isImporting } = useDoorayImportByNumber();
    const { projects, isLoading: isLoadingProjects } = useDoorayProjects(isConnected);
    const { updateSelectedProject, isUpdating: isUpdatingProject } = useUpdateDoorayProject();

    // Initialize state based on existing settings
    useEffect(() => {
      if (isLoadingSettings) return;

      if (isConnected && settings) {
        // If connected but no project selected, go to project selection
        if (!settings.selected_project_id) {
          setStep('projects');
        } else {
          setStep('connected');
        }
        // Load selected tags from settings
        if (settings.selected_tag_ids) {
          try {
            const tagIds = JSON.parse(settings.selected_tag_ids) as string[];
            setSelectedTagIds(new Set(tagIds));
          } catch {
            setSelectedTagIds(new Set());
          }
        }
      } else {
        setStep('token');
      }
    }, [isConnected, settings, isLoadingSettings]);

    const handleClose = () => {
      modal.hide();
    };

    const handleConnectToken = async () => {
      if (!token.trim()) return;
      setError(null);

      try {
        const result = await saveSettings({
          dooray_token: token.trim(),
          selected_project_id: null, // Backend will auto-set
          selected_project_name: null,
        });

        // Check if save was successful (backend returns masked token if success)
        if (result?.dooray_token) {
          // Go to project selection step
          setStep('projects');
        }
      } catch (err) {
        console.error('Failed to save Dooray token:', err);
        setError('토큰 연결에 실패했습니다. 토큰을 확인해주세요.');
      }
    };

    const handleSync = async () => {
      if (!settings?.selected_project_id || !settings?.selected_project_name || !projectId) return;

      try {
        const result = await syncTasks({
          project_id: projectId,
          dooray_project_id: settings.selected_project_id,
          dooray_project_code: settings.selected_project_name,
        });
        setSyncResult(result);
      } catch (err) {
        console.error('Failed to sync tasks:', err);
      }
    };

    const handleSelectProject = async (project: DoorayProject) => {
      try {
        await updateSelectedProject({
          projectId: project.id,
          projectName: project.code,
        });
        setSelectedTagIds(new Set()); // Clear tag selection when project changes
        setStep('connected');
      } catch (err) {
        console.error('Failed to select project:', err);
      }
    };

    const handleChangeProject = () => {
      setStep('projects');
    };

    const handleDisconnect = async () => {
      try {
        await deleteSettings();
        setStep('token');
        setToken('');
        setSyncResult(null);
        setError(null);
        setSelectedTagIds(new Set());
      } catch (err) {
        console.error('Failed to disconnect:', err);
      }
    };

    const handleOpenTagSelection = () => {
      setStep('tags');
    };

    const handleTagToggle = (tagId: string) => {
      setSelectedTagIds((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(tagId)) {
          newSet.delete(tagId);
        } else {
          newSet.add(tagId);
        }
        return newSet;
      });
    };

    const handleGroupToggle = (groupId: string) => {
      setExpandedGroups((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(groupId)) {
          newSet.delete(groupId);
        } else {
          newSet.add(groupId);
        }
        return newSet;
      });
    };

    const handleSaveTags = async () => {
      try {
        const tagIds = selectedTagIds.size > 0 ? Array.from(selectedTagIds) : null;
        await updateSelectedTags(tagIds);
        setStep('connected');
      } catch (err) {
        console.error('Failed to save tags:', err);
      }
    };

    const handleCancelTags = () => {
      // Restore from settings
      if (settings?.selected_tag_ids) {
        try {
          const tagIds = JSON.parse(settings.selected_tag_ids) as string[];
          setSelectedTagIds(new Set(tagIds));
        } catch {
          setSelectedTagIds(new Set());
        }
      } else {
        setSelectedTagIds(new Set());
      }
      setStep('connected');
    };

    const handleImportByNumber = async () => {
      if (!taskNumber.trim() || !settings?.selected_project_id || !settings?.selected_project_name || !projectId) return;
      setImportResult(null);

      try {
        const result = await importByNumber({
          project_id: projectId,
          dooray_project_id: settings.selected_project_id,
          dooray_project_code: settings.selected_project_name,
          task_number: BigInt(parseInt(taskNumber, 10)),
        });
        setImportResult(result);
        if (result.success) {
          setTaskNumber('');
        }
      } catch (err) {
        console.error('Failed to import task by number:', err);
        setImportResult({
          success: false,
          task_id: null,
          message: '가져오기에 실패했습니다.',
        });
      }
    };

    // Count selected tags per group for display
    const selectedCountByGroup = useMemo(() => {
      const counts: Record<string, number> = {};
      for (const group of tagGroups) {
        counts[group.id] = group.tags.filter((t) => selectedTagIds.has(t.id)).length;
      }
      return counts;
    }, [tagGroups, selectedTagIds]);

    const renderTokenStep = () => (
      <>
        <DialogHeader>
          <DialogTitle>Dooray 연동 설정</DialogTitle>
          <DialogDescription>
            Dooray API 토큰을 입력하여 프로젝트와 연동합니다.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dooray-token">Dooray API Token</Label>
              <Input
                id="dooray-token"
                type="password"
                placeholder="xxxxx:yyyyyyy..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnectToken()}
              />
              <p className="text-xs text-muted-foreground">
                Dooray 설정 &gt; API 토큰에서 발급받은 토큰을 입력하세요.
              </p>
              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            취소
          </Button>
          <Button
            onClick={handleConnectToken}
            disabled={!token.trim() || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                연결 중...
              </>
            ) : (
              '연결'
            )}
          </Button>
        </DialogFooter>
      </>
    );

    const renderProjectsStep = () => (
      <>
        <DialogHeader>
          <DialogTitle>프로젝트 선택</DialogTitle>
          <DialogDescription>
            동기화할 Dooray 프로젝트를 선택하세요.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {isLoadingProjects ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                접근 가능한 프로젝트가 없습니다.
              </p>
            ) : (
              projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className="w-full flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 transition-colors text-left"
                  onClick={() => handleSelectProject(project)}
                  disabled={isUpdatingProject}
                >
                  <FolderOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{project.code}</div>
                    {project.description && (
                      <div className="text-xs text-muted-foreground truncate">
                        {project.description}
                      </div>
                    )}
                  </div>
                  {settings?.selected_project_id === project.id && (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </DialogContent>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (settings?.selected_project_id) {
                setStep('connected');
              } else {
                handleDisconnect();
              }
            }}
          >
            {settings?.selected_project_id ? '취소' : '연결 해제'}
          </Button>
        </DialogFooter>
      </>
    );

    const renderConnectedStep = () => (
      <>
        <DialogHeader>
          <DialogTitle>Dooray 연동됨</DialogTitle>
          <DialogDescription>
            {settings?.selected_project_name} 프로젝트와 연동되었습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="p-4 rounded-md bg-green-500/10 border border-green-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-green-600">
                  <Check className="h-5 w-5" />
                  <span className="font-medium">연결됨</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleChangeProject}
                  className="text-xs"
                >
                  프로젝트 변경
                </Button>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                프로젝트: {settings?.selected_project_name}
              </div>
            </div>

            {/* Tag Filter Button */}
            <div className="space-y-2">
              <Button
                variant="outline"
                onClick={handleOpenTagSelection}
                className="w-full justify-between"
              >
                <span className="flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  태그 필터 설정
                </span>
                <span className="text-muted-foreground text-sm">
                  {selectedTagIds.size > 0 ? `${selectedTagIds.size}개 선택됨` : '전체'}
                </span>
              </Button>
            </div>

            {/* Import by Task Number */}
            {projectId && (
              <div className="space-y-2">
                <Label htmlFor="task-number">문서번호로 가져오기</Label>
                <div className="flex gap-2">
                  <Input
                    id="task-number"
                    type="number"
                    placeholder="예: 12345"
                    value={taskNumber}
                    onChange={(e) => setTaskNumber(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleImportByNumber()}
                  />
                  <Button
                    onClick={handleImportByNumber}
                    disabled={!taskNumber.trim() || isImporting || !projectId}
                    variant="outline"
                  >
                    {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : '가져오기'}
                  </Button>
                </div>
                {importResult && (
                  <p className={`text-xs ${importResult.success ? 'text-green-600' : 'text-red-500'}`}>
                    {importResult.message}
                  </p>
                )}
              </div>
            )}

            {projectId && (
              <div className="space-y-2">
                <Button
                  onClick={handleSync}
                  disabled={isSyncing || !settings?.selected_project_id}
                  className="w-full"
                >
                  {isSyncing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      동기화 중...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      지금 동기화
                    </>
                  )}
                </Button>

                {syncResult && (
                  <div className="p-3 rounded-md bg-muted text-sm">
                    <div>생성됨: {syncResult.created}개</div>
                    <div>업데이트됨: {syncResult.updated}개</div>
                    <div>건너뜀: {syncResult.skipped}개</div>
                  </div>
                )}
              </div>
            )}

            {!projectId && (
              <p className="text-sm text-muted-foreground">
                프로젝트 페이지에서 동기화를 실행할 수 있습니다.
              </p>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                해제 중...
              </>
            ) : (
              <>
                <Link2Off className="mr-2 h-4 w-4" />
                연동 해제
              </>
            )}
          </Button>
        </DialogFooter>
      </>
    );

    const renderTagsStep = () => (
      <>
        <DialogHeader>
          <DialogTitle>태그 필터 설정</DialogTitle>
          <DialogDescription>
            동기화할 태그를 선택하세요. 선택하지 않으면 모든 태스크를 동기화합니다.
          </DialogDescription>
        </DialogHeader>
        <DialogContent>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {isLoadingTags ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tagGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                태그가 없습니다.
              </p>
            ) : (
              tagGroups.map((group) => (
                <div key={group.id} className="border rounded-md">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    onClick={() => handleGroupToggle(group.id)}
                  >
                    <span className="flex items-center gap-2 font-medium text-sm">
                      {expandedGroups.has(group.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      {group.name || '기타'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {selectedCountByGroup[group.id] || 0}/{group.tags.length}
                    </span>
                  </button>
                  {expandedGroups.has(group.id) && (
                    <div className="px-3 pb-3 space-y-2">
                      {group.tags.map((tag) => (
                        <label
                          key={tag.id}
                          className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 p-1 rounded"
                        >
                          <Checkbox
                            checked={selectedTagIds.has(tag.id)}
                            onCheckedChange={() => handleTagToggle(tag.id)}
                          />
                          <span className="text-sm">{tag.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancelTags}>
            취소
          </Button>
          <Button onClick={handleSaveTags} disabled={isUpdatingTags}>
            {isUpdatingTags ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                저장 중...
              </>
            ) : (
              '저장'
            )}
          </Button>
        </DialogFooter>
      </>
    );

    return (
      <Dialog open={modal.visible} onOpenChange={handleClose}>
        {step === 'token' && renderTokenStep()}
        {step === 'projects' && renderProjectsStep()}
        {step === 'connected' && renderConnectedStep()}
        {step === 'tags' && renderTagsStep()}
      </Dialog>
    );
  }
);

export const DooraySettingsDialog = defineModal<
  DooraySettingsDialogProps,
  void
>(DooraySettingsDialogImpl);
