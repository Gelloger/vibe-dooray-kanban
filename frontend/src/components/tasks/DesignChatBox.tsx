import { useCallback, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface DesignChatBoxProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
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
}: DesignChatBoxProps) {
  const { t } = useTranslation('tasks');
  const [message, setMessage] = useState('');

  const canSend = message.trim().length > 0 && !disabled && !isLoading;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const trimmedMessage = message.trim();
    setMessage('');
    await onSend(trimmedMessage);
  }, [canSend, message, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          placeholder ?? t('design.chatPlaceholder', 'Describe your design...')
        }
        disabled={disabled || isLoading}
        className="min-h-[80px] resize-none"
        rows={3}
      />
      <div className="flex justify-end">
        <Button
          onClick={handleSend}
          disabled={!canSend}
          size="sm"
          className="gap-2"
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
