import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SpinnerGapIcon } from '@phosphor-icons/react';
import { useDoorayCreateComment } from '@/hooks/useDooray';
import type { CreateDoorayCommentResult } from 'shared/types';

export interface SaveToDoorayDialogProps {
  doorayTaskId: string;
  doorayProjectId: string;
  doorayTaskNumber: string;
  conversationContent?: string; // Full conversation as markdown (optional, unused)
  summaryContent: string; // Summarized content
}

const SaveToDoorayDialogImpl = NiceModal.create<SaveToDoorayDialogProps>(
  ({ doorayTaskId, doorayProjectId, doorayTaskNumber, summaryContent }) => {
    const modal = useModal();
    const [result, setResult] = useState<CreateDoorayCommentResult | null>(null);
    const { createComment, isCreating } = useDoorayCreateComment();

    const handleSave = async () => {
      try {
        const res = await createComment({
          dooray_task_id: doorayTaskId,
          dooray_project_id: doorayProjectId,
          content: summaryContent,
        });
        setResult(res);
        if (res.success) {
          setTimeout(() => modal.hide(), 1500);
        }
      } catch (err) {
        setResult({ success: false, message: '저장에 실패했습니다.' });
      }
    };

    return (
      <Dialog open={modal.visible} onOpenChange={() => modal.hide()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>두레이에 기록</DialogTitle>
            <DialogDescription>
              {doorayTaskNumber} 태스크에 의사결정 요약을 코멘트로 추가합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>미리보기</Label>
              <Textarea
                value={summaryContent}
                readOnly
                className="h-64 font-mono text-sm"
              />
            </div>

            {result && (
              <p className={`text-sm ${result.success ? 'text-green-600' : 'text-red-500'}`}>
                {result.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => modal.hide()}>
              취소
            </Button>
            <Button onClick={handleSave} disabled={isCreating || !summaryContent.trim()}>
              {isCreating ? (
                <>
                  <SpinnerGapIcon className="mr-2 h-4 w-4 animate-spin" />
                  저장 중...
                </>
              ) : (
                '저장'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const SaveToDoorayDialog = defineModal<
  SaveToDoorayDialogProps,
  void
>(SaveToDoorayDialogImpl);
