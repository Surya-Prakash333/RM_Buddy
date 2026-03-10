// ============================================================
// ChatWindow.tsx — Full right-panel chat UI (380 px wide)
// INFRA-11LABS-02
// ============================================================

import {
  type ReactElement,
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { Send, MessageCircle, Radio } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useChat } from '@/hooks/useChat';
import { useVoice } from '@/hooks/useVoice';
import { ChatMessage } from './ChatMessage';
import { VoiceButton } from './VoiceButton';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAgentName(role: string | undefined): string {
  return role === 'RM' ? 'Aria' : 'Vikram';
}

// ── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator(): ReactElement {
  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#1B4F72] flex items-center justify-center">
        <Radio className="w-4 h-4 text-white" />
      </div>
      <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm border border-gray-100">
        <span className="flex items-end gap-1 h-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

const EXAMPLE_CHIPS = [
  'Show my alerts today',
  'How many Diamond clients do I have?',
  "What's my morning briefing?",
];

function EmptyState({
  agentName,
  onChipClick,
}: {
  agentName: string;
  onChipClick: (text: string) => void;
}): ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
      <div className="w-14 h-14 rounded-full bg-[#1B4F72]/10 flex items-center justify-center">
        <MessageCircle className="w-7 h-7 text-[#1B4F72]" />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">
          Hi! I&apos;m {agentName}.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed mt-1">
          Ask me anything about your clients and portfolio.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        {EXAMPLE_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onChipClick(chip)}
            className="
              text-xs text-left px-3 py-2 rounded-xl border border-[#1B4F72]/30
              text-[#1B4F72] bg-[#1B4F72]/5 hover:bg-[#1B4F72]/10
              transition-colors duration-200 truncate
            "
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Voice status indicator (header dot) ──────────────────────────────────────

function VoiceStatusDot({ status }: { status: string }): ReactElement {
  const colorClass =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
        ? 'bg-yellow-400 animate-pulse'
        : 'bg-gray-300';

  return <span className={`w-2 h-2 rounded-full ${colorClass}`} />;
}

// ── Main component ───────────────────────────────────────────────────────────

export function ChatWindow(): ReactElement {
  const rmIdentity = useAuthStore((s) => s.rmIdentity);
  const agentName = getAgentName(rmIdentity?.role);

  const chatState = useChat();
  const { messages, sendMessage, isLoading } = chatState;
  // chatState.error surfaces inside the messages list as an assistant bubble — no extra UI needed
  const { status: voiceStatus, isSpeaking, startConversation, stopConversation } = useVoice();

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages or loading state change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSend = useCallback(async (): Promise<void> => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue('');
    await sendMessage(text);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleVoiceToggle = useCallback((): void => {
    if (voiceStatus === 'connected' || voiceStatus === 'connecting') {
      void stopConversation();
    } else {
      void startConversation();
    }
  }, [voiceStatus, startConversation, stopConversation]);

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="w-9 h-9 rounded-full bg-[#1B4F72] flex items-center justify-center text-white text-sm font-semibold select-none">
          {agentName[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">{agentName}</p>
          <p className="text-xs text-gray-500">AI Assistant</p>
        </div>
        <div className="flex items-center gap-1.5">
          <VoiceStatusDot status={voiceStatus} />
          <span className="text-xs text-gray-400 capitalize">{voiceStatus}</span>
        </div>
      </div>

      {/* ── Message list ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {messages.length === 0 ? (
          <EmptyState
            agentName={agentName}
            onChipClick={async (text) => {
              setInputValue('');
              await sendMessage(text);
            }}
          />
        ) : (
          messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
        )}

        {isLoading && <TypingIndicator />}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-t border-gray-200 px-3 py-3">
        <div className="flex items-end gap-2">
          {/* Text area */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agentName}…`}
              rows={1}
              disabled={isLoading}
              className="
                w-full resize-none rounded-xl border border-gray-200
                px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400
                focus:outline-none focus:ring-2 focus:ring-[#2E86AB] focus:border-transparent
                disabled:opacity-50 disabled:cursor-not-allowed
                leading-5 max-h-32 overflow-y-auto
              "
              style={{ minHeight: '42px' }}
            />
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!inputValue.trim() || isLoading}
            aria-label="Send message"
            className="
              flex-shrink-0 flex items-center justify-center
              w-10 h-10 rounded-xl bg-[#1B4F72] text-white
              hover:bg-[#2E86AB] transition-colors duration-200
              focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#2E86AB]
              disabled:opacity-40 disabled:cursor-not-allowed
            "
          >
            <Send className="w-4 h-4" />
          </button>

          {/* Voice button */}
          <VoiceButton
            status={voiceStatus}
            isSpeaking={isSpeaking}
            agentName={agentName}
            onToggle={handleVoiceToggle}
          />
        </div>

        {/* Hint */}
        <p className="text-[10px] text-gray-400 mt-1.5 pl-1">
          Enter to send &middot; Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

export default ChatWindow;
