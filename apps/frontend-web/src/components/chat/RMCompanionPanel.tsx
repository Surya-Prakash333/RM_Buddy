// ============================================================
// RMCompanionPanel.tsx — Left chat panel matching new design
// ============================================================

import {
  type ReactElement,
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { Phone, PhoneOff, Mic } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useChatStore } from '@/store/chat.store';
import { useChat } from '@/hooks/useChat';
import { useVoice } from '@/hooks/useVoice';
import { ChatMessage } from './ChatMessage';

// ── Suggested prompts ─────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  {
    title: 'Prepare Client Meeting',
    subtitle: '"Summarize Meera Patel\'s portfolio before my meeting."',
  },
  {
    title: 'Analyze Portfolio Risk',
    subtitle: '"Check risk exposure in Rajesh Shah\'s investments."',
  },
  {
    title: 'Generate Client Report',
    subtitle: '"Create a portfolio review report for Amit Sharma."',
  },
  {
    title: 'Find opportunities',
    subtitle: '"Show clients with upcoming FD maturities."',
  },
];

// ── Voice Avatar ──────────────────────────────────────────────────────────────

function VoiceAvatar({
  isActive,
  isSpeaking,
  isConnecting,
  onToggle,
}: {
  isActive: boolean;
  isSpeaking: boolean;
  isConnecting: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 pt-6 pb-2">
      {/* Outer glow ring */}
      <div className="relative">
        {isActive && (
          <div
            className="absolute inset-0 rounded-full animate-ping opacity-20"
            style={{ background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)' }}
          />
        )}

        {/* Main avatar circle */}
        <div
          className="relative w-[120px] h-[120px] rounded-full flex items-center justify-center cursor-pointer select-none"
          style={{
            background: 'radial-gradient(circle at 35% 35%, #1e40af, #1b3380 50%, #0f1f5c)',
            boxShadow: isActive
              ? '0 0 0 6px rgba(59,130,246,0.25), 0 8px 32px rgba(15,31,92,0.45)'
              : '0 4px 24px rgba(15,31,92,0.35)',
          }}
          onClick={onToggle}
        >
          {/* Waveform bars */}
          <div className="flex items-end gap-[4px]">
            {[10, 18, 26, 18, 10].map((h, i) => (
              <span
                key={i}
                className="w-[4px] rounded-full bg-white/90"
                style={{
                  height: `${h}px`,
                  ...(isActive && isSpeaking
                    ? {
                        animation: `waveBar 0.8s ease-in-out infinite alternate`,
                        animationDelay: `${i * 120}ms`,
                      }
                    : isActive
                    ? {
                        animation: `wavePulse 1.2s ease-in-out infinite`,
                        animationDelay: `${i * 100}ms`,
                      }
                    : {}),
                }}
              />
            ))}
          </div>
        </div>

        {/* Call / Hang-up button */}
        <button
          onClick={onToggle}
          disabled={isConnecting}
          className={`
            absolute -bottom-1 left-1/2 -translate-x-1/2
            w-9 h-9 rounded-full flex items-center justify-center
            text-white shadow-lg transition-all duration-200
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400
            ${
              isActive
                ? 'bg-red-500 hover:bg-red-600 focus:ring-red-400'
                : 'bg-[#1e2d6e] hover:bg-[#2a3d8f]'
            }
            ${isConnecting ? 'animate-pulse cursor-not-allowed' : 'cursor-pointer'}
          `}
          aria-label={isActive ? 'End voice call' : 'Start voice call'}
        >
          {isActive ? (
            <PhoneOff size={16} />
          ) : (
            <Phone size={16} />
          )}
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-1">
        {isConnecting
          ? 'Connecting...'
          : isActive
          ? 'Assistant responding...'
          : 'Tap to call your assistant'}
      </p>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator(): ReactElement {
  return (
    <div className="flex items-end gap-1 px-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

// ── Action chips ──────────────────────────────────────────────────────────────

function ActionChips({ chips }: { chips: string[] }): ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {chips.map((chip) => (
        <button
          key={chip}
          className="text-xs px-3 py-1 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RMCompanionPanel(): ReactElement {
  const rmIdentity = useAuthStore((s) => s.rmIdentity);
  const firstName = rmIdentity?.rm_name?.split(' ')[0] ?? 'there';
  const initials = rmIdentity
    ? rmIdentity.rm_name.split(' ').slice(0, 2).map((n) => n[0]).join('').toUpperCase()
    : 'RM';

  const { messages, sendMessage, loadSession, isLoading } = useChat();
  const { status: voiceStatus, isSpeaking, startConversation, stopConversation } = useVoice();
  const activeSessionId = useChatStore((s) => s.activeSessionId);

  // Load session messages when a past conversation is selected from the sidebar
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeSessionId && activeSessionId !== prevSessionRef.current) {
      void loadSession(activeSessionId);
    }
    prevSessionRef.current = activeSessionId;
  }, [activeSessionId, loadSession]);

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isVoiceActive = voiceStatus === 'connected' || voiceStatus === 'connecting';
  const isConnecting = voiceStatus === 'connecting';

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleVoiceToggle = useCallback(() => {
    if (isVoiceActive) void stopConversation();
    else void startConversation();
  }, [isVoiceActive, startConversation, stopConversation]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue('');
    await sendMessage(text);
  }, [inputValue, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-1.5 flex-1">
          <p className="text-sm font-semibold text-gray-800">RM Companion</p>
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
        </div>
      </div>
      <div className="px-4 pb-1 shrink-0">
        <p className="text-xs text-gray-400">
          {isVoiceActive ? 'Active Session' : 'Ready'}
        </p>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Voice avatar */}
        <VoiceAvatar
          isActive={isVoiceActive}
          isSpeaking={isSpeaking}
          isConnecting={isConnecting}
          onToggle={handleVoiceToggle}
        />

        {/* Ready state (no messages) */}
        {!hasMessages && !isVoiceActive && (
          <div className="px-5 text-center mt-1">
            <h2 className="text-base font-semibold text-gray-800 mb-2">Ready to Brief You</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              "Good morning, {firstName}. I have analysed your daily schedule. Ready for a quick
              summary of your meetings?"
            </p>
          </div>
        )}

        {/* Voice active — transcript */}
        {isVoiceActive && hasMessages && (
          <div className="px-4 mt-2 space-y-3">
            {/* Transcript label */}
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-gray-400">
                <path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M5 10a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                Transcript
              </p>
            </div>

            {/* Messages */}
            {messages.map((msg) => (
              <div key={msg.id}>
                <ChatMessage message={msg} compact />
                {msg.role === 'assistant' && (
                  <ActionChips chips={['Show allocation', 'Compare options', 'Draft email']} />
                )}
              </div>
            ))}

            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Text chat messages (non-voice) */}
        {!isVoiceActive && hasMessages && (
          <div className="px-4 mt-3 space-y-2">
            {/* Assistant label */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                Assistant
              </span>
            </div>
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} compact />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Suggested prompts (only when no messages) */}
        {!hasMessages && (
          <div className="px-4 mt-6">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
              Suggested Prompts
            </p>
            <div className="space-y-2">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p.title}
                  onClick={() => void sendMessage(p.title)}
                  className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all group"
                >
                  <p className="text-sm font-medium text-gray-800 group-hover:text-gray-900">
                    {p.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">{p.subtitle}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Input bar ───────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-2 bg-gray-50 rounded-2xl px-4 py-2 border border-gray-200 focus-within:border-blue-300 focus-within:ring-1 focus-within:ring-blue-200 transition-all">
          {/* RM initials */}
          <div className="w-7 h-7 rounded-full bg-[#2c3e6b] flex items-center justify-center shrink-0">
            <span className="text-white text-[10px] font-bold">{initials}</span>
          </div>

          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a follow-up question..."
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 focus:outline-none disabled:opacity-50"
          />

          {/* Mic / send button */}
          <button
            onClick={() => {
              if (inputValue.trim()) void handleSend();
              else handleVoiceToggle();
            }}
            disabled={isLoading && !inputValue.trim()}
            className={`
              w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors
              ${
                isVoiceActive
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-[#1e2d6e] hover:bg-[#2a3d8f] text-white'
              }
            `}
            aria-label={inputValue.trim() ? 'Send message' : 'Toggle voice'}
          >
            <Mic size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default RMCompanionPanel;
