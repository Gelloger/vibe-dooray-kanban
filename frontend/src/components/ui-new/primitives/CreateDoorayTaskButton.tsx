import { PlusCircleIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEntries } from '@/contexts/EntriesContext';
import { useDooraySettings } from '@/hooks/useDooray';
import { useTask } from '@/hooks/useTask';
import { CreateDoorayTaskDialog } from '@/components/dialogs/tasks/CreateDoorayTaskDialog';
import { extractBmadOutput } from '@/utils/conversationUtils';

interface CreateDoorayTaskButtonProps {
  taskId: string | undefined;
  projectId: string | undefined;
}

export function CreateDoorayTaskButton({ taskId, projectId }: CreateDoorayTaskButtonProps) {
  const { entries } = useEntries();
  const { isConnected, settings } = useDooraySettings();
  const { data: task } = useTask(taskId);

  // Don't show if:
  // 1. Dooray is not connected
  // 2. No Dooray project is selected
  // 3. Task already has a dooray_task_id (already synced)
  if (!isConnected || !settings?.selected_project_id || task?.dooray_task_id) {
    return null;
  }

  const handleClick = async () => {
    // Extract title and body from BMAD-style output in conversation
    const { title, body } = extractBmadOutput(entries);

    await CreateDoorayTaskDialog.show({
      initialTitle: title,
      initialBody: body,
      localProjectId: projectId,
    });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClick}
            className="h-8 w-8"
          >
            <PlusCircleIcon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>두레이 태스크 생성</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
