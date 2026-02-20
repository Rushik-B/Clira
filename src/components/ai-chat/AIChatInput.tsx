'use client';

import React, { useCallback, useRef, useState } from 'react';
import { LiquidButton, LIQUID_BUTTON_BASE_CLASS } from '@/components/ui/buttons';
import { PaperPlane } from '@/components/icons/icons';
import { Paperclip, X, FileText, Image as ImageIcon, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileAttachment } from './types';

interface AIChatInputProps {
  value: string;
  isSending: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper to get file icon based on type
function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon className="h-3.5 w-3.5" />;
  if (type.includes('pdf') || type.includes('document')) return <FileText className="h-3.5 w-3.5" />;
  return <File className="h-3.5 w-3.5" />;
}

export const AIChatInput: React.FC<AIChatInputProps> = ({
  value,
  isSending,
  onChange,
  onSend,
}) => {
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isSending;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  const handleAttachClick = useCallback(() => {
    alert('Sorry, still figuring this one out :(');
  }, []);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newAttachments: FileAttachment[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      file,
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);

    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <div className="border-t border-white/5 px-5 py-4">
      <div className="flex flex-col gap-3">
        {/* File attachments preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-2.5 py-1.5 text-sm"
              >
                <span className="text-slate-400">{getFileIcon(attachment.type)}</span>
                <span className="text-slate-200 max-w-[120px] truncate">{attachment.name}</span>
                <span className="text-slate-500 text-xs">{formatFileSize(attachment.size)}</span>
                <button
                  onClick={() => handleRemoveAttachment(attachment.id)}
                  className="text-slate-400 hover:text-red-400 transition-colors cursor-pointer ml-1"
                  title="Remove attachment"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea container */}
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur-none sm:backdrop-blur-sm">
          <textarea
            className="min-h-[84px] w-full resize-none bg-transparent text-base text-white outline-none placeholder:text-slate-400"
            placeholder="Ask Clira about your inbox..."
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
        </div>

        {/* Footer with actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 font-medium">
          <div className="flex items-center gap-2">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              accept="image/*,.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
            />

            {/* Attach button */}
            <button
              onClick={handleAttachClick}
              disabled={isSending}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer',
                'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-transparent hover:border-slate-700',
                isSending && 'opacity-50 cursor-not-allowed',
              )}
              title="Attach files... {coming soon, Sorry I have some assignments due :( } )"
            >
              <Paperclip className="h-4 w-4" />
              <span>Attach</span>
            </button>

            <span className="text-slate-500 hidden sm:inline">Enter to send · Shift + Enter for new line</span>
          </div>

          <LiquidButton
            onClick={onSend}
            minWidth="none"
            size="sm"
            variant="default"
            type="button"
            disabled={!canSend}
            className={cn(
              LIQUID_BUTTON_BASE_CLASS,
              'h-9 !rounded-full bg-emerald-500/20 text-emerald-100 border border-emerald-400/30 hover:bg-emerald-500/30 hover:border-emerald-300/50 transition-all duration-200 cursor-pointer font-medium',
              !canSend && 'cursor-not-allowed opacity-60 hover:bg-emerald-500/20 hover:border-emerald-400/30',
            )}
          >
            <span className="flex items-center text-sm font-medium">
              <span
                style={{ '--icon-color': 'rgb(209 250 229)' } as React.CSSProperties}
                className="flex items-center"
              >
                <PaperPlane />
              </span>
              {isSending ? 'Sending...' : 'Send'}
            </span>
          </LiquidButton>
        </div>
      </div>
    </div>
  );
};
