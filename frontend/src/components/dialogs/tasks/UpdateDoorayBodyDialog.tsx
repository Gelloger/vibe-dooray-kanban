import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { doorayApi } from '@/lib/api';
import { Loader2, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import WYSIWYGEditor from '@/components/ui/wysiwyg';

export interface UpdateDoorayBodyDialogProps {
  doorayTaskId: string;
  initialBody: string;
}

type Message = {
  type: 'success' | 'error';
  text: string;
};

const UpdateDoorayBodyDialogImpl = NiceModal.create<UpdateDoorayBodyDialogProps>(
  ({ doorayTaskId, initialBody }) => {
    const modal = useModal();
    const { t } = useTranslation(['dooray', 'common']);
    const [body, setBody] = useState(initialBody);
    const [showPreview, setShowPreview] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [message, setMessage] = useState<Message | null>(null);

    const handleClose = useCallback(
      (open: boolean) => {
        if (!open && !isUpdating) {
          modal.remove();
        }
      },
      [modal, isUpdating]
    );

    const handleSubmit = useCallback(
      async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setIsUpdating(true);

        try {
          const result = await doorayApi.updateTask(doorayTaskId, body);

          if (result.success) {
            setMessage({
              type: 'success',
              text: t('dooray:updateBody.success'),
            });
            setTimeout(() => modal.remove(), 1500);
          } else {
            setMessage({
              type: 'error',
              text: result.message || t('dooray:updateBody.failed'),
            });
          }
        } catch (error) {
          setMessage({
            type: 'error',
            text: error instanceof Error ? error.message : String(error),
          });
        } finally {
          setIsUpdating(false);
        }
      },
      [doorayTaskId, body, modal, t]
    );

    return (
      <Dialog open={modal.visible} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('dooray:updateBody.title')}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            {/* Body */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="dooray-task-body">
                  {t('dooray:updateBody.bodyLabel')}
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
              {showPreview ? (
                <div className="min-h-[400px] max-h-[500px] overflow-auto p-3 border rounded-md bg-muted/30">
                  {body ? (
                    <WYSIWYGEditor
                      value={body}
                      disabled
                      className="whitespace-pre-wrap break-words text-sm"
                    />
                  ) : (
                    <p className="text-muted-foreground italic">
                      {t('dooray:createTask.noContent')}
                    </p>
                  )}
                </div>
              ) : (
                <Textarea
                  id="dooray-task-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('dooray:updateBody.bodyPlaceholder')}
                  disabled={isUpdating}
                  className="min-h-[400px] max-h-[500px] font-mono text-sm"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {t('dooray:createTask.markdownSupported')}
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => modal.remove()}
                disabled={isUpdating}
              >
                {t('common:cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isUpdating}
                className="min-w-[120px]"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('dooray:updateBody.updating')}
                  </>
                ) : (
                  t('dooray:updateBody.update')
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
);

export const UpdateDoorayBodyDialog = defineModal<
  UpdateDoorayBodyDialogProps,
  void
>(UpdateDoorayBodyDialogImpl);
