import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { tasksApi } from '@/lib/api';
import type { TaskWithAttemptStatus } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { taskKeys } from '@/hooks/useTask';
import { workspaceSummaryKeys } from '@/components/ui-new/hooks/useWorkspaces';

export interface ResetToTodoDialogProps {
  task: TaskWithAttemptStatus;
  projectId: string;
}

const ResetToTodoDialogImpl = NiceModal.create<ResetToTodoDialogProps>(
  ({ task }) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const [isResetting, setIsResetting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const hasWorkspaces = Number(task.workspace_count) > 0;

    const handleConfirm = async () => {
      setIsResetting(true);
      setError(null);

      try {
        await tasksApi.resetToTodo(task.id);
        queryClient.invalidateQueries({ queryKey: taskKeys.all });
        queryClient.invalidateQueries({ queryKey: taskKeys.byId(task.id) });
        queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all });
        modal.resolve();
        modal.hide();
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : 'Failed to reset task';
        setError(errorMessage);
      } finally {
        setIsResetting(false);
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
            <DialogTitle>Reset to Todo</DialogTitle>
            <DialogDescription>
              <span className="font-semibold">"{task.title}"</span>을(를) Todo
              상태로 되돌리시겠습니까?
            </DialogDescription>
          </DialogHeader>

          {hasWorkspaces && (
            <Alert variant="destructive" className="mb-4">
              <strong>주의:</strong> 이 태스크에 연결된 워크스페이스(
              {Number(task.workspace_count)}개)가 있습니다. Todo로 전환하면
              worktree와 브랜치가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="mb-4">
              {error}
            </Alert>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isResetting}
              autoFocus
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isResetting}
            >
              {isResetting ? 'Resetting...' : 'Reset to Todo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const ResetToTodoDialog = defineModal<ResetToTodoDialogProps, void>(
  ResetToTodoDialogImpl
);
