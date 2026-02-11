import { useState } from 'react';
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
import { Alert } from '@/components/ui/alert';
import { doorayApi } from '@/lib/api';
import type { TaskWithAttemptStatus } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';

const DOORAY_URL_PATTERN =
  /https:\/\/[\w.-]+\.dooray\.com\/(?:project\/tasks\/\d+|task\/\d+\/\d+)/;

export interface CrossReferenceDialogProps {
  task: TaskWithAttemptStatus;
}

const CrossReferenceDialogImpl = NiceModal.create<CrossReferenceDialogProps>(
  ({ task }) => {
    const modal = useModal();
    const [targetUrl, setTargetUrl] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const isValidUrl = DOORAY_URL_PATTERN.test(targetUrl);

    const handleConfirm = async () => {
      if (!isValidUrl) return;

      setIsSubmitting(true);
      setError(null);
      setSuccess(null);

      try {
        const result = await doorayApi.crossReference({
          target_url: targetUrl,
          source_task_id: task.id,
        });

        if (result.success) {
          setSuccess(result.message);
          setTimeout(() => {
            modal.resolve();
            modal.hide();
          }, 1500);
        } else {
          setError(result.message);
        }
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : '참조 등록에 실패했습니다.';
        setError(errorMessage);
      } finally {
        setIsSubmitting(false);
      }
    };

    const handleCancel = () => {
      modal.reject();
      modal.hide();
    };

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>태스크 참조 남기기</DialogTitle>
            <DialogDescription>
              현재 태스크{' '}
              <span className="font-semibold">
                "{task.dooray_task_number || task.title}"
              </span>
              의 참조를 대상 태스크에 댓글로 등록합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            <Input
              placeholder="https://nhnent.dooray.com/project/tasks/..."
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
            {targetUrl && !isValidUrl && (
              <p className="text-sm text-destructive mt-1">
                유효한 Dooray 태스크 URL을 입력해주세요.
              </p>
            )}
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              {error}
            </Alert>
          )}

          {success && (
            <Alert className="mb-4">
              {success}
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isSubmitting || !isValidUrl}
            >
              {isSubmitting ? '등록 중...' : '확인'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CrossReferenceDialog =
  defineModal<CrossReferenceDialogProps, void>(CrossReferenceDialogImpl);
