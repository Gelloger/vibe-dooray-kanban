import { useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { SpinnerGapIcon } from '@phosphor-icons/react';
import { useDoorayCreateComment } from '@/hooks/useDooray';
import { useChangelogGenerator } from '@/hooks/useChangelogGenerator';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { CreateDoorayCommentResult } from 'shared/types';

export interface UpdateChangelogDialogProps {
  taskId: string;
  sessionId?: string;
  workspaceId?: string;
  doorayTaskId: string;
  doorayProjectId: string;
  doorayTaskNumber: string;
}

const UpdateChangelogDialogImpl =
  NiceModal.create<UpdateChangelogDialogProps>(
    ({
      taskId,
      sessionId,
      workspaceId,
      doorayTaskId,
      doorayProjectId,
      doorayTaskNumber,
    }) => {
      const modal = useModal();
      const { t } = useTranslation('tasks');
      const [result, setResult] = useState<CreateDoorayCommentResult | null>(
        null
      );
      const { createComment, isCreating } = useDoorayCreateComment();

      const {
        generate,
        isGenerating,
        currentStep,
        changelog,
        error,
      } = useChangelogGenerator({
        taskId,
        sessionId,
        workspaceId,
        doorayTaskId,
        doorayProjectId,
      });

      // Auto-generate on mount
      useEffect(() => {
        generate();
      }, []); // eslint-disable-line react-hooks/exhaustive-deps

      const stepLabel = currentStep
        ? t(`changelog.step${currentStep}`)
        : '';

      const handleSave = async () => {
        if (!changelog) return;
        try {
          const res = await createComment({
            dooray_task_id: doorayTaskId,
            dooray_project_id: doorayProjectId,
            content: changelog,
          });
          setResult(res);
          if (res.success) {
            setTimeout(() => modal.hide(), 1500);
          }
        } catch {
          setResult({
            success: false,
            message: t('changelog.error'),
          });
        }
      };

      return (
        <Dialog open={modal.visible} onOpenChange={() => modal.hide()}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{t('changelog.dialogTitle')}</DialogTitle>
              <DialogDescription>
                {t('changelog.dialogDescription', {
                  taskNumber: doorayTaskNumber,
                })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {isGenerating && (
                <div className="flex items-center gap-3 p-4 bg-muted rounded-md">
                  <SpinnerGapIcon className="h-5 w-5 animate-spin text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      {t('changelog.generating')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {stepLabel} ({currentStep}/4)
                    </p>
                  </div>
                </div>
              )}

              {error === 'no_changes' && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  {t('changelog.noChanges')}
                </p>
              )}

              {error && error !== 'no_changes' && (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generate()}
                  >
                    {t('common:buttons.retry', '다시 시도')}
                  </Button>
                </div>
              )}

              {changelog && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t('changelog.preview')}
                  </p>
                  <Textarea
                    value={changelog}
                    readOnly
                    className="h-64 font-mono text-sm"
                  />
                </div>
              )}

              {result && (
                <p
                  className={`text-sm ${result.success ? 'text-green-600' : 'text-red-500'}`}
                >
                  {result.success
                    ? t('changelog.success')
                    : result.message}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => modal.hide()}>
                {t('common:buttons.cancel', '취소')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  isGenerating || isCreating || !changelog?.trim()
                }
              >
                {isCreating ? (
                  <>
                    <SpinnerGapIcon className="mr-2 h-4 w-4 animate-spin" />
                    {t('changelog.saving')}
                  </>
                ) : (
                  t('changelog.save')
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
  );

export const UpdateChangelogDialog = defineModal<
  UpdateChangelogDialogProps,
  void
>(UpdateChangelogDialogImpl);
