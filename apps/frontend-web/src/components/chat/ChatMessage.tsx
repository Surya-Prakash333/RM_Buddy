// ============================================================
// ChatMessage.tsx — Single message bubble in the chat thread
// INFRA-11LABS-02
// ============================================================

import type { ReactElement } from 'react';
import { Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType } from '@/hooks/useChat';
import { WidgetRenderer } from '../widgets/WidgetRenderer';

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessageProps {
  message: ChatMessageType;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ChatMessage({ message }: ChatMessageProps): ReactElement {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {/* Avatar — only for assistant */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#1B4F72] flex items-center justify-center mr-2 mt-1">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}

      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[85%] overflow-hidden`}>
        {/* Bubble */}
        <div
          className={
            isUser
              ? 'bg-[#2E86AB] text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm'
              : 'bg-white text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed shadow-sm border border-gray-100 overflow-x-auto w-full'
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none text-current">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                  th: ({ node, ...props }) => <th className="px-3 py-2 bg-gray-50 border border-gray-200 text-left font-semibold" {...props} />,
                  td: ({ node, ...props }) => <td className="px-3 py-2 border border-gray-200" {...props} />,
                  table: ({ node, ...props }) => (
                    <div className="overflow-x-auto mb-2">
                      <table className="min-w-full border-collapse border border-gray-200 my-2" {...props} />
                    </div>
                  ),
                  a: ({ node, ...props }) => <a className="text-[#2E86AB] hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
                  li: ({ node, ...props }) => <li className="ml-4 list-disc marker:text-gray-400" {...props} />,
                  ul: ({ node, ...props }) => <ul className="mb-2 last:mb-0 space-y-1" {...props} />,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Widgets rendered below the bubble (assistant only) */}
        {!isUser && message.widgets && message.widgets.length > 0 && (
          <div className="mt-2 w-full space-y-2">
            {message.widgets.map((widget, i) => (
              <WidgetRenderer widget={widget} key={i} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-gray-400 mt-1 px-1">
          {message.timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}

export default ChatMessage;
