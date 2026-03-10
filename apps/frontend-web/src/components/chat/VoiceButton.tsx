// ============================================================
// VoiceButton.tsx — Floating mic toggle for ElevenLabs voice
// INFRA-11LABS-02
// ============================================================

import type { ReactElement } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import type { VoiceStatus } from '@/hooks/useVoice';

// ── Types ────────────────────────────────────────────────────────────────────

interface VoiceButtonProps {
  status: VoiceStatus;
  isSpeaking: boolean;
  agentName: string;
  onToggle: () => void;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Animated waveform bars shown while the agent is speaking */
function WaveformIcon(): ReactElement {
  return (
    <span className="flex items-end gap-[3px] h-5">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-white animate-bounce"
          style={{
            height: `${8 + (i % 2) * 8}px`,
            animationDelay: `${i * 80}ms`,
            animationDuration: '600ms',
          }}
        />
      ))}
    </span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function VoiceButton({
  status,
  isSpeaking,
  agentName,
  onToggle,
}: VoiceButtonProps): ReactElement {
  // ── Derive visual state ───────────────────────────────────────────────────

  const isConnecting = status === 'connecting';
  const isConnected = status === 'connected';
  const isListening = isConnected && !isSpeaking;
  const isAgentSpeaking = isConnected && isSpeaking;

  const buttonClasses = (() => {
    if (isConnecting) return 'bg-yellow-500 hover:bg-yellow-600 shadow-yellow-200';
    if (isAgentSpeaking) return 'bg-red-500 hover:bg-red-600 shadow-red-200';
    if (isListening) return 'bg-green-500 hover:bg-green-600 shadow-green-200';
    return 'bg-gray-400 hover:bg-gray-500 shadow-gray-200';
  })();

  const statusText = (() => {
    if (isConnecting) return 'Connecting...';
    if (isAgentSpeaking) return `${agentName} is speaking...`;
    if (isListening) return 'Listening...';
    return `Tap to speak with ${agentName}`;
  })();

  // ── Pulse ring for listening state ───────────────────────────────────────

  const showPulse = isListening;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        {/* Pulse ring */}
        {showPulse && (
          <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-60" />
        )}

        <button
          type="button"
          onClick={onToggle}
          disabled={isConnecting}
          aria-label={isConnected ? 'Stop voice conversation' : 'Start voice conversation'}
          className={`
            relative flex items-center justify-center
            w-12 h-12 rounded-full text-white
            transition-all duration-200 shadow-lg
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2E86AB]
            disabled:cursor-not-allowed
            ${buttonClasses}
          `}
        >
          {isConnecting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isAgentSpeaking ? (
            <WaveformIcon />
          ) : isListening ? (
            <Mic className="w-5 h-5" />
          ) : (
            <MicOff className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Status label */}
      <span className="text-[10px] text-gray-500 text-center max-w-[90px] leading-tight">
        {statusText}
      </span>
    </div>
  );
}

export default VoiceButton;
