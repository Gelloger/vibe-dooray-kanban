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
import type { DoorayMember } from 'shared/types';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { useDoorayMembers, useDooraySettings } from '@/hooks/useDooray';

const DOORAY_URL_PATTERN =
  /https:\/\/[\w.-]+\.dooray\.com\/(?:project\/tasks\/\d+|task\/\d+\/\d+)/;

export interface ChangeAssigneeDialogProps {}

const ChangeAssigneeDialogImpl = NiceModal.create<ChangeAssigneeDialogProps>(
  () => {
    const modal = useModal();
    const { settings } = useDooraySettings();
    const [targetUrl, setTargetUrl] = useState('');
    const [selectedMember, setSelectedMember] =
      useState<DoorayMember | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const isValidUrl = DOORAY_URL_PATTERN.test(targetUrl);

    // Fetch members from selected project when dialog is open
    const {
      members,
      isLoading: isLoadingMembers,
      isError: isMembersError,
      error: membersError,
    } = useDoorayMembers(settings?.selected_project_id ?? null, true);

    const filteredMembers = members.filter((m) =>
      m.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleConfirm = async () => {
      if (!selectedMember || !isValidUrl) return;

      setIsSubmitting(true);
      setError(null);
      setSuccess(null);

      try {
        const result = await doorayApi.changeAssignee({
          target_url: targetUrl,
          member_id: selectedMember.id,
          member_name: selectedMember.name,
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
          err instanceof Error
            ? err.message
            : '담당자 변경에 실패했습니다.';
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
            <DialogTitle>담당자 변경</DialogTitle>
            <DialogDescription>
              대상 태스크 URL을 입력하고 담당자를 선택하세요.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <div>
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

            <div>
              <Input
                placeholder="멤버 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="max-h-60 overflow-y-auto border rounded">
              {!settings?.selected_project_id ? (
                <div className="p-4 text-center text-sm text-destructive">
                  Dooray 프로젝트가 설정되지 않았습니다.
                </div>
              ) : isLoadingMembers ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  멤버 목록을 불러오는 중...
                </div>
              ) : isMembersError ? (
                <div className="p-4 text-center text-sm text-destructive">
                  멤버 목록 조회 실패:{' '}
                  {membersError instanceof Error
                    ? membersError.message
                    : '알 수 없는 오류'}
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {searchQuery
                    ? '검색 결과가 없습니다.'
                    : '멤버가 없습니다.'}
                </div>
              ) : (
                filteredMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => setSelectedMember(member)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${
                      selectedMember?.id === member.id
                        ? 'bg-accent font-semibold'
                        : ''
                    }`}
                    disabled={isSubmitting}
                  >
                    {member.name}
                  </button>
                ))
              )}
            </div>

            {selectedMember && (
              <p className="text-sm text-muted-foreground">
                선택:{' '}
                <span className="font-semibold">
                  {selectedMember.name}
                </span>
              </p>
            )}
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              {error}
            </Alert>
          )}

          {success && <Alert className="mb-4">{success}</Alert>}

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
              disabled={isSubmitting || !selectedMember || !isValidUrl}
            >
              {isSubmitting ? '변경 중...' : '확인'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const ChangeAssigneeDialog =
  defineModal<ChangeAssigneeDialogProps, void>(ChangeAssigneeDialogImpl);
