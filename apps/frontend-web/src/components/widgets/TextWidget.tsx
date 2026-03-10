import type { ReactElement, ReactNode } from 'react';
import type { TextWidgetData, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Minimal markdown renderer
// Supports: **bold**, *italic*, `code`, - list items, numbered lists,
// blank-line paragraph breaks. No external deps.
// ---------------------------------------------------------------------------

function renderMarkdown(raw: string): ReactNode[] {
  const lines = raw.split('\n');
  const nodes: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let key = 0;

  function flushList(): void {
    if (listBuffer.length === 0) return;
    const items = listBuffer.map((text, i) => (
      <li key={i} className="ml-4 text-gray-700">
        {inlineFormat(text)}
      </li>
    ));
    nodes.push(
      listType === 'ol'
        ? <ol key={key++} className="list-decimal text-sm space-y-0.5 my-1">{items}</ol>
        : <ul key={key++} className="list-disc text-sm space-y-0.5 my-1">{items}</ul>,
    );
    listBuffer = [];
    listType = null;
  }

  for (const line of lines) {
    // Unordered list
    if (/^[-*]\s/.test(line)) {
      if (listType === 'ol') flushList();
      listType = 'ul';
      listBuffer.push(line.replace(/^[-*]\s/, ''));
      continue;
    }
    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      if (listType === 'ul') flushList();
      listType = 'ol';
      listBuffer.push(line.replace(/^\d+\.\s/, ''));
      continue;
    }
    // Flush pending list
    flushList();

    // Blank line
    if (line.trim() === '') {
      nodes.push(<br key={key++} />);
      continue;
    }

    nodes.push(
      <p key={key++} className="text-sm text-gray-700 leading-relaxed">
        {inlineFormat(line)}
      </p>,
    );
  }

  flushList();
  return nodes;
}

// Inline formatting: **bold**, *italic*, `code`
function inlineFormat(text: string): ReactNode[] {
  // Tokenise the string by splitting on **bold**, *italic*, `code` patterns
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    }
    if (/^\*[^*]+\*$/.test(part)) {
      return <em key={i} className="italic text-gray-700">{part.slice(1, -1)}</em>;
    }
    if (/^`[^`]+`$/.test(part)) {
      return (
        <code key={i} className="bg-gray-100 text-gray-800 rounded px-1 py-0.5 text-xs font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ---------------------------------------------------------------------------
// Action button helpers
// ---------------------------------------------------------------------------

const ACTION_VARIANT: Record<string, string> = {
  primary: 'bg-primary text-white hover:bg-primary/90',
  secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

function actionButtonClass(variant?: string): string {
  return ACTION_VARIANT[variant ?? 'secondary'] ?? ACTION_VARIANT.secondary;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TextWidgetProps {
  title: string;
  data: TextWidgetData;
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
}

export function TextWidget({ title, data, actions, onAction }: TextWidgetProps): ReactElement {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      {/* Title */}
      {title && (
        <p className="font-semibold text-gray-800 text-sm mb-3">{title}</p>
      )}

      {/* Rendered content */}
      <div className="flex flex-col gap-1">{renderMarkdown(data.content)}</div>

      {/* Action buttons */}
      {actions && actions.length > 0 && (
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => onAction?.(action)}
              className={[
                'text-xs font-medium px-3 py-1.5 rounded-lg transition-colors',
                actionButtonClass(action.variant),
              ].join(' ')}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TextWidget;
