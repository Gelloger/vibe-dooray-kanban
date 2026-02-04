import { useState } from 'react';
import { MessageSquare, Loader2, RefreshCw, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui-new/primitives/Dialog';
import WYSIWYGEditor from '@/components/ui/wysiwyg';
import { useDoorayComments } from '@/hooks/useDooray';

interface DoorayCommentsSectionProps {
  doorayProjectId: string | null | undefined;
  doorayTaskId: string | null | undefined;
  taskTitle?: string;
}

// Format relative time (e.g., "2시간 전", "어제")
function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay === 1) return '어제';
    if (diffDay < 7) return `${diffDay}일 전`;

    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

// Get initials from name
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Generate consistent color from name
function getAvatarColor(name: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-rose-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function DoorayCommentsSection({
  doorayProjectId,
  doorayTaskId,
  taskTitle,
}: DoorayCommentsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { comments, isLoading, isError, refetch } = useDoorayComments(
    doorayProjectId,
    doorayTaskId,
    isOpen
  );

  if (!doorayProjectId || !doorayTaskId) {
    return null;
  }

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground hover:bg-blue-50 dark:hover:bg-blue-950 mt-2 transition-colors"
      >
        <MessageSquare className="h-4 w-4" />
        <span className="text-xs">댓글 보기</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="max-h-[80vh] flex flex-col bg-background p-6"
          style={{ maxWidth: '900px' }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => e.stopPropagation()}
          onInteractOutside={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-500" />
              댓글
              {!isLoading && !isError && (
                <span className="text-sm font-normal text-muted-foreground">
                  {comments.length}개
                </span>
              )}
            </DialogTitle>
            {taskTitle && (
              <DialogDescription className="truncate">
                {taskTitle}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="flex-1 overflow-y-auto mt-4">
            {isLoading && (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                <span className="text-sm text-muted-foreground">
                  댓글을 불러오는 중...
                </span>
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-4 py-12">
                <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-3">
                  <MessageSquare className="h-6 w-6 text-red-500" />
                </div>
                <span className="text-sm text-muted-foreground">
                  댓글을 불러올 수 없습니다
                </span>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  다시 시도
                </Button>
              </div>
            )}

            {!isLoading && !isError && comments.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-12">
                <div className="rounded-full bg-gray-100 dark:bg-gray-800 p-3">
                  <MessageSquare className="h-6 w-6 text-gray-400" />
                </div>
                <span className="text-sm text-muted-foreground">
                  아직 댓글이 없습니다
                </span>
              </div>
            )}

            {!isLoading && !isError && comments.length > 0 && (
              <div className="space-y-4">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="group rounded-lg border border-border/50 bg-muted/30 p-4 hover:border-border transition-colors"
                  >
                    {/* Author & Time */}
                    <div className="flex items-center gap-3 mb-3">
                      {/* Avatar */}
                      <div
                        className={`flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-medium ${getAvatarColor(comment.author_name)}`}
                      >
                        {getInitials(comment.author_name) || (
                          <User className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">
                          {comment.author_name}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {formatRelativeTime(comment.created_at)}
                        </span>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="pl-11">
                      <WYSIWYGEditor
                        value={comment.content}
                        disabled
                        className="text-sm text-foreground/90 break-words leading-relaxed [&_.wysiwyg-content]:p-0"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
