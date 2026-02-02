import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { SplitTaskItemProps } from './types';

export function SplitTaskItem({
  task,
  onToggle,
  onUpdate,
  onDelete,
  disabled = false,
}: SplitTaskItemProps) {
  const { t } = useTranslation(['dooray', 'common']);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(task.id, { title: e.target.value });
    },
    [task.id, onUpdate]
  );

  const handleDescriptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onUpdate(task.id, { description: e.target.value });
    },
    [task.id, onUpdate]
  );

  return (
    <div
      className={`border rounded-md p-3 transition-colors ${
        task.selected ? 'bg-background' : 'bg-muted/30 opacity-60'
      }`}
    >
      <div className="flex items-start gap-3">
        {/* 체크박스 */}
        <Checkbox
          id={`task-${task.id}`}
          checked={task.selected}
          onCheckedChange={() => onToggle(task.id)}
          disabled={disabled}
          className="mt-1"
        />

        {/* 내용 */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* 제목 */}
          <Input
            value={task.title}
            onChange={handleTitleChange}
            disabled={disabled || !task.selected}
            placeholder={t('dooray:ai.splitTaskTitle', '태스크 제목')}
            className="h-8 text-sm"
          />

          {/* 설명 (접힘/펼침) */}
          {isExpanded && (
            <Textarea
              value={task.description}
              onChange={handleDescriptionChange}
              disabled={disabled || !task.selected}
              placeholder={t('dooray:ai.splitTaskDescription', '태스크 설명 (선택)')}
              className="min-h-[60px] text-sm resize-none"
            />
          )}
        </div>

        {/* 버튼들 */}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsExpanded(!isExpanded)}
            disabled={disabled}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(task.id)}
            disabled={disabled}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
