import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@radix-ui/react-label';
import { Textarea } from '@/components/ui/textarea.tsx';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import BranchSelector from '@/components/tasks/BranchSelector';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { attemptsApi } from '@/lib/api.ts';
import { useTranslation } from 'react-i18next';

import { TaskWithAttemptStatus, Workspace } from 'shared/types';
import { Loader2, Sparkles } from 'lucide-react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAuth, useRepoBranches } from '@/hooks';
import {
  GhCliHelpInstructions,
  GhCliSetupDialog,
  mapGhCliErrorToUi,
} from '@/components/dialogs/auth/GhCliSetupDialog';
import type {
  GhCliSupportContent,
  GhCliSupportVariant,
} from '@/components/dialogs/auth/GhCliSetupDialog';
import type { GhCliSetupError } from 'shared/types';
import { useUserSystem } from '@/components/ConfigProvider';
import { defineModal } from '@/lib/modals';

interface CreatePRDialogProps {
  attempt: Workspace;
  task: TaskWithAttemptStatus;
  repoId: string;
  targetBranch?: string;
}

export type CreatePRDialogResult = {
  success: boolean;
  error?: string;
};

const CreatePRDialogImpl = NiceModal.create<CreatePRDialogProps>(
  ({ attempt, task, repoId, targetBranch }) => {
    const modal = useModal();
    const { t } = useTranslation('tasks');
    const { isLoaded } = useAuth();
    const { environment } = useUserSystem();
    const [prTitle, setPrTitle] = useState('');
    const [prBody, setPrBody] = useState('');
    const [prBaseBranch, setPrBaseBranch] = useState('');
    const [creatingPR, setCreatingPR] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [ghCliHelp, setGhCliHelp] = useState<GhCliSupportContent | null>(
      null
    );
    const [isDraft, setIsDraft] = useState(false);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [summaryGenerated, setSummaryGenerated] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const initializedRef = useRef(false);

    const { data: branches = [], isLoading: branchesLoading } = useRepoBranches(
      repoId,
      { enabled: modal.visible && !!repoId }
    );

    const getGhCliHelpTitle = (variant: GhCliSupportVariant) =>
      variant === 'homebrew'
        ? 'Homebrew is required for automatic setup'
        : 'GitHub CLI needs manual setup';

    // Initialize form once when dialog opens
    useEffect(() => {
      if (!modal.visible) {
        initializedRef.current = false;
        return;
      }
      if (!isLoaded || initializedRef.current) return;
      initializedRef.current = true;

      setPrTitle(`${task.title} (vibe-kanban)`);
      setPrBody(task.description || '');
      setError(null);
      setGhCliHelp(null);
      setSummaryGenerated(false);
    }, [modal.visible, isLoaded, task]);

    // Set default base branch when branches are loaded
    useEffect(() => {
      if (branches.length > 0 && !prBaseBranch) {
        // First priority: use the target branch from attempt config
        if (targetBranch && branches.some((b) => b.name === targetBranch)) {
          setPrBaseBranch(targetBranch);
          return;
        }
        // Fallback: use the current branch
        const currentBranch = branches.find((b) => b.is_current);
        if (currentBranch) {
          setPrBaseBranch(currentBranch.name);
        }
      }
    }, [branches, prBaseBranch, targetBranch]);

    // Generate AI summary based on git diff analysis
    const handleGenerateSummary = useCallback(async () => {
      if (!repoId || !attempt.id || !prBaseBranch) return;

      // Abort previous generation if any
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsGeneratingSummary(true);
      setError(null);

      try {
        // Step 1: Load template with git info
        const preview = await attemptsApi.previewPRDescription(
          attempt.id,
          repoId,
          prBaseBranch
        );
        setPrTitle(preview.title);

        // Step 2: Stream AI summary into the Comment section of the body
        const baseBody = preview.body;
        setPrBody(baseBody);

        let aiContent = '';
        let hasError = false;
        for await (const event of attemptsApi.generatePrSummary(
          attempt.id,
          repoId,
          prBaseBranch,
          abortController.signal
        )) {
          if (event.type === 'Chunk') {
            aiContent += event.data;
            // Replace the ## Comment section content with AI-generated text
            const commentMarker = '## Comment';
            const commentIdx = baseBody.indexOf(commentMarker);
            if (commentIdx !== -1) {
              const beforeComment = baseBody.substring(
                0,
                commentIdx + commentMarker.length
              );
              setPrBody(`${beforeComment}\n${aiContent}`);
            } else {
              setPrBody(`${baseBody}\n\n${aiContent}`);
            }
          } else if (event.type === 'Complete') {
            // Final result - only update if we have actual content
            const finalContent = event.data || aiContent;
            if (finalContent.trim()) {
              const commentMarker = '## Comment';
              const commentIdx = baseBody.indexOf(commentMarker);
              if (commentIdx !== -1) {
                const beforeComment = baseBody.substring(
                  0,
                  commentIdx + commentMarker.length
                );
                setPrBody(`${beforeComment}\n${finalContent}`);
              } else {
                setPrBody(`${baseBody}\n\n${finalContent}`);
              }
            }
          } else if (event.type === 'Error') {
            setError(event.data);
            hasError = true;
            break;
          }
        }
        if (!hasError) {
          setSummaryGenerated(true);
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : t(
                'createPrDialog.errors.previewFailed',
                'Failed to generate summary'
              )
        );
      } finally {
        setIsGeneratingSummary(false);
        abortControllerRef.current = null;
      }
    }, [repoId, attempt.id, prBaseBranch, t]);

    const isMacEnvironment = useMemo(
      () => environment?.os_type?.toLowerCase().includes('mac'),
      [environment?.os_type]
    );

    const handleConfirmCreatePR = useCallback(async () => {
      if (!repoId || !attempt.id) return;

      setError(null);
      setGhCliHelp(null);
      setCreatingPR(true);

      const handleGhCliSetupOutcome = (
        setupResult: GhCliSetupError | null,
        fallbackMessage: string,
        hostname?: string
      ) => {
        if (setupResult === null) {
          setError(null);
          setGhCliHelp(null);
          setCreatingPR(false);
          modal.hide();
          return;
        }

        const ui = mapGhCliErrorToUi(setupResult, fallbackMessage, t, hostname);

        if (ui.variant) {
          setGhCliHelp(ui);
          setError(null);
          return;
        }

        setGhCliHelp(null);
        setError(ui.message);
      };

      // Always trigger AI follow-up after PR creation for description enhancement
      const result = await attemptsApi.createPR(attempt.id, {
        title: prTitle,
        body: prBody || null,
        target_branch: prBaseBranch || null,
        draft: isDraft,
        auto_generate_description: true,
        repo_id: repoId,
      });

      if (result.success) {
        setPrTitle('');
        setPrBody('');
        setPrBaseBranch('');
        setIsDraft(false);
        setSummaryGenerated(false);
        setCreatingPR(false);
        initializedRef.current = false;
        modal.resolve({ success: true } as CreatePRDialogResult);
        modal.hide();
        return;
      }

      setCreatingPR(false);

      const defaultGhCliErrorMessage =
        result.message || 'Failed to run GitHub CLI setup.';

      const showGhCliSetupDialog = async (hostname?: string | null) => {
        const setupResult = await GhCliSetupDialog.show({
          attemptId: attempt.id,
          hostname: hostname ?? undefined,
        });

        handleGhCliSetupOutcome(
          setupResult,
          defaultGhCliErrorMessage,
          hostname ?? undefined
        );
      };

      if (result.error) {
        if (
          result.error.type === 'cli_not_installed' ||
          result.error.type === 'cli_not_logged_in'
        ) {
          // Only show setup dialog for GitHub CLI on Mac
          if (result.error.provider === 'git_hub' && isMacEnvironment) {
            await showGhCliSetupDialog(result.error.hostname);
          } else {
            const providerName =
              result.error.provider === 'git_hub'
                ? result.error.hostname
                  ? `GitHub Enterprise (${result.error.hostname})`
                  : 'GitHub'
                : result.error.provider === 'azure_dev_ops'
                  ? 'Azure DevOps'
                  : 'Git host';
            const action =
              result.error.type === 'cli_not_installed'
                ? 'not installed'
                : 'not logged in';
            setError(`${providerName} CLI is ${action}`);
            setGhCliHelp(null);
          }
          return;
        } else if (
          result.error.type === 'git_cli_not_installed' ||
          result.error.type === 'git_cli_not_logged_in'
        ) {
          const gitCliErrorKey =
            result.error.type === 'git_cli_not_logged_in'
              ? 'createPrDialog.errors.gitCliNotLoggedIn'
              : 'createPrDialog.errors.gitCliNotInstalled';

          setError(result.message || t(gitCliErrorKey));
          setGhCliHelp(null);
          return;
        } else if (result.error.type === 'target_branch_not_found') {
          setError(
            t('createPrDialog.errors.targetBranchNotFound', {
              branch: result.error.branch,
            })
          );
          setGhCliHelp(null);
          return;
        }
      }

      if (result.message) {
        setError(result.message);
        setGhCliHelp(null);
      } else {
        setError(t('createPrDialog.errors.failedToCreate'));
        setGhCliHelp(null);
      }
    }, [
      attempt,
      repoId,
      prBaseBranch,
      prBody,
      prTitle,
      isDraft,
      modal,
      isMacEnvironment,
      t,
    ]);

    const handleCancelCreatePR = useCallback(() => {
      // Abort any in-progress AI generation
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      // Return error if one was set, otherwise just canceled
      const result: CreatePRDialogResult = error
        ? { success: false, error }
        : { success: false };
      modal.resolve(result);
      modal.hide();
      // Reset form to empty state
      setPrTitle('');
      setPrBody('');
      setPrBaseBranch('');
      setIsDraft(false);
      setSummaryGenerated(false);
      setIsGeneratingSummary(false);
      initializedRef.current = false;
    }, [modal, error]);

    return (
      <>
        <Dialog
          open={modal.visible}
          onOpenChange={() => handleCancelCreatePR()}
        >
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>{t('createPrDialog.title')}</DialogTitle>
              <DialogDescription>
                {t('createPrDialog.description')}
              </DialogDescription>
            </DialogHeader>
            {!isLoaded ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="pr-title">
                    {t('createPrDialog.titleLabel')}
                  </Label>
                  <Input
                    id="pr-title"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    placeholder={t('createPrDialog.titlePlaceholder')}
                    disabled={isGeneratingSummary}
                    className={
                      isGeneratingSummary
                        ? 'opacity-50 cursor-not-allowed'
                        : ''
                    }
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pr-body">
                      {t('createPrDialog.descriptionLabel')}
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateSummary}
                      disabled={isGeneratingSummary || !prBaseBranch}
                      className="h-7 gap-1 text-xs"
                    >
                      {isGeneratingSummary ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      {isGeneratingSummary
                        ? t('createPrDialog.generatingSummary', 'Generating...')
                        : t('createPrDialog.generateSummary', 'Generate Summary')}
                    </Button>
                  </div>
                  <Textarea
                    id="pr-body"
                    value={prBody}
                    onChange={(e) => setPrBody(e.target.value)}
                    placeholder={t('createPrDialog.descriptionPlaceholder')}
                    rows={summaryGenerated || isGeneratingSummary ? 10 : 4}
                    readOnly={isGeneratingSummary}
                    className={
                      isGeneratingSummary
                        ? 'opacity-70'
                        : ''
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pr-base">
                    {t('createPrDialog.baseBranchLabel')}
                  </Label>
                  <BranchSelector
                    branches={branches}
                    selectedBranch={prBaseBranch}
                    onBranchSelect={setPrBaseBranch}
                    placeholder={
                      branchesLoading
                        ? t('createPrDialog.loadingBranches')
                        : t('createPrDialog.selectBaseBranch')
                    }
                    className={
                      branchesLoading ? 'opacity-50 cursor-not-allowed' : ''
                    }
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="pr-draft"
                    checked={isDraft}
                    onCheckedChange={setIsDraft}
                    className="h-5 w-5"
                  />
                  <Label htmlFor="pr-draft" className="cursor-pointer text-sm">
                    {t('createPrDialog.draftLabel')}
                  </Label>
                </div>
                {ghCliHelp?.variant && (
                  <Alert variant="default">
                    <AlertTitle>
                      {getGhCliHelpTitle(ghCliHelp.variant)}
                    </AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>{ghCliHelp.message}</p>
                      <GhCliHelpInstructions
                        variant={ghCliHelp.variant}
                        t={t}
                        hostname={ghCliHelp.hostname}
                      />
                    </AlertDescription>
                  </Alert>
                )}
                {error && <Alert variant="destructive">{error}</Alert>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelCreatePR}>
                {t('common:buttons.cancel')}
              </Button>
              <Button
                onClick={handleConfirmCreatePR}
                disabled={creatingPR || isGeneratingSummary || !prTitle.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {creatingPR ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('createPrDialog.creating')}
                  </>
                ) : (
                  t('createPrDialog.createButton')
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

export const CreatePRDialog = defineModal<
  CreatePRDialogProps,
  CreatePRDialogResult
>(CreatePRDialogImpl);
