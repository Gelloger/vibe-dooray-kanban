import { BookmarkSimpleIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEntries } from '@/contexts/EntriesContext';
import { useTask } from '@/hooks/useTask';
import { SaveToDoorayDialog } from '../dialogs/SaveToDoorayDialog';
import { extractConversationFromEntries } from '@/utils/conversationUtils';

interface SaveToDoorayButtonProps {
  taskId: string | undefined;
}

export function SaveToDoorayButton({ taskId }: SaveToDoorayButtonProps) {
  const { entries } = useEntries();
  const { data: task } = useTask(taskId);

  // Only show if task has dooray_task_id
  if (!task?.dooray_task_id || !task?.dooray_project_id) {
    return null;
  }

  const handleClick = async () => {
    const { conversationContent, summaryContent } = extractConversationFromEntries(entries);

    await SaveToDoorayDialog.show({
      doorayTaskId: task.dooray_task_id!,
      doorayProjectId: task.dooray_project_id!,
      doorayTaskNumber: task.dooray_task_number || '',
      conversationContent,
      summaryContent,
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
            <BookmarkSimpleIcon className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>두레이에 기록</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
