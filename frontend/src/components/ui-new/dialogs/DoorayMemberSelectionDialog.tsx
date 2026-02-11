import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal } from '@/lib/modals';
import { CommandDialog } from '@/components/ui-new/primitives/Command';
import {
  MultiSelectCommandBar,
  type MultiSelectOption,
} from '@/components/ui-new/primitives/MultiSelectCommandBar';
import { useDoorayMembers, useDooraySettings } from '@/hooks/useDooray';

export interface DoorayMemberSelectionDialogProps {
  issueIds: string[];
  isCreateMode?: boolean;
}

function DoorayMemberSelectionContent() {
  const modal = useModal();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { settings } = useDooraySettings();
  const doorayProjectId = settings?.selected_project_id ?? null;

  const { members, isLoading } = useDoorayMembers(doorayProjectId, true);

  // Capture focus when dialog opens and reset search
  useEffect(() => {
    if (modal.visible) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setSearch('');
    }
  }, [modal.visible]);

  const options: MultiSelectOption<string>[] = useMemo(
    () =>
      members.map((member) => ({
        value: member.id,
        label: member.name,
        searchValue: `${member.id} ${member.name}`,
      })),
    [members]
  );

  const handleToggle = useCallback(
    (memberId: string) => {
      setSelectedIds((prev) =>
        prev.includes(memberId)
          ? prev.filter((id) => id !== memberId)
          : [...prev, memberId]
      );
    },
    []
  );

  const handleClose = useCallback(() => {
    modal.resolve(selectedIds);
    modal.hide();
  }, [modal, selectedIds]);

  // Restore focus when dialog closes
  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    previousFocusRef.current?.focus();
  }, []);

  const title = isLoading
    ? 'Dooray 멤버 로딩 중...'
    : !doorayProjectId
      ? 'Dooray 프로젝트가 설정되지 않았습니다'
      : '담당자 선택 (Dooray)';

  return (
    <CommandDialog
      open={modal.visible}
      onOpenChange={(open) => !open && handleClose()}
      onCloseAutoFocus={handleCloseAutoFocus}
    >
      <MultiSelectCommandBar
        title={title}
        options={options}
        selectedValues={selectedIds}
        onToggle={handleToggle}
        onClose={handleClose}
        search={search}
        onSearchChange={setSearch}
      />
    </CommandDialog>
  );
}

const DoorayMemberSelectionDialogImpl =
  NiceModal.create<DoorayMemberSelectionDialogProps>(
    () => {
      return <DoorayMemberSelectionContent />;
    }
  );

export const DoorayMemberSelectionDialog = defineModal<
  DoorayMemberSelectionDialogProps,
  string[]
>(DoorayMemberSelectionDialogImpl);
