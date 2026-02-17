import { useCallback, useMemo, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BaseCodingAgent } from 'shared/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { SkillChips } from '@/components/ui-new/primitives/SkillChips';
import {
  SlashCommandHints,
  filterSlashCommands,
} from '@/components/ui-new/primitives/SlashCommandHints';
import { useSlashCommands } from '@/hooks/useSlashCommands';

interface DesignChatBoxProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  repoId?: string;
}

/** Extract the slash query when the message starts with `/` and has no space yet */
function getSlashQuery(message: string): string | null {
  if (!message.startsWith('/')) return null;
  const spaceIdx = message.indexOf(' ');
  // still typing the command name (no space yet)
  if (spaceIdx === -1) return message.slice(1);
  return null;
}

/**
 * Simple chat input box for design sessions.
 * Allows users to send messages to Claude for design planning.
 */
export function DesignChatBox({
  onSend,
  disabled = false,
  isLoading = false,
  placeholder,
  className,
  repoId,
}: DesignChatBoxProps) {
  const { t } = useTranslation('tasks');
  const [message, setMessage] = useState('');
  const { commands } = useSlashCommands(BaseCodingAgent.CLAUDE_CODE, { repoId });
  const [hintIndex, setHintIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const slashQuery = getSlashQuery(message);
  const showHints = slashQuery !== null;
  const filtered = useMemo(
    () => (showHints ? filterSlashCommands(commands, slashQuery) : []),
    [commands, slashQuery, showHints]
  );

  const canSend = message.trim().length > 0 && !disabled && !isLoading;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const trimmedMessage = message.trim();
    setMessage('');
    await onSend(trimmedMessage);
  }, [canSend, message, onSend]);

  const selectCommand = useCallback(
    (name: string) => {
      setMessage(`/${name} `);
      setHintIndex(0);
      textareaRef.current?.focus();
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showHints && filtered.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHintIndex((prev) => (prev + 1) % filtered.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHintIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          selectCommand(filtered[hintIndex].name);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMessage('');
          setHintIndex(0);
          return;
        }
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [showHints, filtered, hintIndex, handleSend, selectCommand]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);
      setHintIndex(0);
    },
    []
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            placeholder ?? t('design.chatPlaceholder', 'Describe your design...')
          }
          disabled={disabled || isLoading}
          className="min-h-[80px] resize-none"
          rows={3}
        />
        {showHints && (
          <SlashCommandHints
            commands={commands}
            query={slashQuery}
            selectedIndex={hintIndex}
            onSelect={(cmd) => selectCommand(cmd.name)}
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 overflow-x-auto">
          <SkillChips
            commands={commands}
            onSelect={(cmd) => setMessage(cmd)}
          />
        </div>
        <Button
          onClick={handleSend}
          disabled={!canSend}
          size="sm"
          className="gap-2 shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {t('design.send', 'Send')}
        </Button>
      </div>
    </div>
  );
}
