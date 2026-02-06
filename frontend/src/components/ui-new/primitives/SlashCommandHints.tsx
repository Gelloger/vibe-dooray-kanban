import type React from 'react';
import { useEffect, useRef } from 'react';
import type { SlashCommandDescription } from 'shared/types';
import { cn } from '@/lib/utils';

interface SlashCommandHintsProps {
  commands: SlashCommandDescription[];
  query: string;
  selectedIndex: number;
  onSelect: (command: SlashCommandDescription) => void;
}

/** Short display name: strip plugin prefix for readability */
function displayName(name: string): string {
  const colonIdx = name.indexOf(':');
  return colonIdx > 0 ? name.slice(colonIdx + 1) : name;
}

/** Split text into segments with match highlighted */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-brand font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function filterSlashCommands(
  commands: SlashCommandDescription[],
  query: string
): SlashCommandDescription[] {
  if (!query) return commands;
  const lower = query.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(lower) ||
      displayName(cmd.name).toLowerCase().includes(lower)
  );
}

export function SlashCommandHints({
  commands,
  query,
  selectedIndex,
  onSelect,
}: SlashCommandHintsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = filterSlashCommands(commands, query);

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 z-50 max-h-48 overflow-y-auto rounded border bg-popover p-1 shadow-md"
    >
      {filtered.map((cmd, idx) => (
        <button
          key={cmd.name}
          type="button"
          data-active={idx === selectedIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
            idx === selectedIndex
              ? 'bg-brand/15 text-accent-foreground border-l-2 border-brand pl-1.5'
              : 'hover:bg-accent/50'
          )}
        >
          <span className="font-medium shrink-0">/{highlightMatch(displayName(cmd.name), query)}</span>
          {cmd.description && (
            <span className="text-muted-foreground truncate">
              {cmd.description}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
