import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SlashCommandDescription } from 'shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface SkillChipsProps {
  commands: SlashCommandDescription[];
  onSelect: (command: string) => void;
}

interface CommandCategory {
  label: string;
  commands: SlashCommandDescription[];
}

const BUILTIN_NAMES = new Set([
  'compact',
  'review',
  'security-review',
  'init',
  'pr-comments',
  'context',
  'cost',
  'release-notes',
]);

function categorizeCommands(
  commands: SlashCommandDescription[]
): CommandCategory[] {
  const builtin: SlashCommandDescription[] = [];
  const custom: SlashCommandDescription[] = [];
  const pluginGroups = new Map<string, SlashCommandDescription[]>();

  for (const cmd of commands) {
    const colonIdx = cmd.name.indexOf(':');
    if (colonIdx > 0) {
      const prefix = cmd.name.slice(0, colonIdx);
      const group = pluginGroups.get(prefix) ?? [];
      group.push(cmd);
      pluginGroups.set(prefix, group);
    } else if (BUILTIN_NAMES.has(cmd.name)) {
      builtin.push(cmd);
    } else {
      custom.push(cmd);
    }
  }

  const categories: CommandCategory[] = [];

  if (builtin.length > 0) {
    categories.push({ label: 'Built-in', commands: builtin });
  }
  if (custom.length > 0) {
    categories.push({ label: 'Custom', commands: custom });
  }

  for (const [prefix, cmds] of [...pluginGroups.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    categories.push({ label: prefix, commands: cmds });
  }

  return categories;
}

/** Short display name: strip plugin prefix */
function displayName(name: string): string {
  const colonIdx = name.indexOf(':');
  return colonIdx > 0 ? name.slice(colonIdx + 1) : name;
}

export function SkillChips({ commands, onSelect }: SkillChipsProps) {
  const categories = useMemo(() => categorizeCommands(commands), [commands]);

  if (categories.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-secondary px-2.5 py-0.5 text-xs text-low transition-colors hover:border-brand hover:text-normal shrink-0"
        >
          / Skills
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {categories.map((cat, catIdx) => (
          <div key={cat.label}>
            {catIdx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {cat.label}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {cat.commands.map((cmd) => (
                <DropdownMenuItem
                  key={cmd.name}
                  onClick={() => onSelect(`/${cmd.name} `)}
                  className="text-xs"
                >
                  <span className="font-medium">
                    /{displayName(cmd.name)}
                  </span>
                  {cmd.description && (
                    <span className="ml-2 text-muted-foreground truncate max-w-[200px]">
                      {cmd.description}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
