// ============================================================
// useVoice.ts — ElevenLabs conversational AI voice hook
// INFRA-11LABS-02
// ============================================================

import { useCallback, useMemo } from 'react';
import { useConversation } from '@11labs/react';
import { useAuthStore } from '@/store/auth.store';

// ── Types ────────────────────────────────────────────────────────────────────

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface UseVoiceReturn {
  status: VoiceStatus;
  isSpeaking: boolean;
  startConversation: () => Promise<void>;
  stopConversation: () => Promise<void>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useVoice(): UseVoiceReturn {
  const rmIdentity = useAuthStore((s) => s.rmIdentity);

  // Select agent ID based on role
  const agentId: string | undefined =
    rmIdentity?.role === 'RM'
      ? import.meta.env.VITE_ELEVENLABS_ARIA_AGENT_ID
      : import.meta.env.VITE_ELEVENLABS_VIKRAM_AGENT_ID;

  if (!agentId) {
    console.warn(
      '[useVoice] ElevenLabs agent ID is not set. ' +
        'Check VITE_ELEVENLABS_ARIA_AGENT_ID / VITE_ELEVENLABS_VIKRAM_AGENT_ID in your .env file.',
    );
  }

  // Dynamic variables forwarded to the ElevenLabs agent at session start.
  // Memoised so the reference is stable and doesn't recreate startConversation on every render.
  const dynamicVariables = useMemo<Record<string, string | number>>(
    () =>
      rmIdentity
        ? {
            rm_name: rmIdentity.rm_name,
            rm_id: rmIdentity.rm_id,
            client_count: rmIdentity.client_count,
            role: rmIdentity.role,
          }
        : ({} as Record<string, string | number>),
    [rmIdentity],
  );

  const conversation = useConversation({
    onConnect: () => {
      // Connection confirmed — status transitions to 'connected' via mode
    },
    onDisconnect: () => {
      // Session ended cleanly
    },
    onError: (message: string) => {
      console.error('[useVoice] ElevenLabs error:', message);
    },
  });

  // Map ElevenLabs status to our VoiceStatus type
  const status: VoiceStatus = (() => {
    switch (conversation.status) {
      case 'connected':
        return 'connected';
      case 'connecting':
        return 'connecting';
      case 'disconnected':
        return 'idle';
      default:
        return 'idle';
    }
  })();

  const startConversation = useCallback(async (): Promise<void> => {
    if (!agentId) {
      console.warn('[useVoice] Cannot start conversation — agent ID is undefined.');
      return;
    }

    try {
      // Request microphone access before starting
      await navigator.mediaDevices.getUserMedia({ audio: true });

      await conversation.startSession({
        agentId,
        dynamicVariables,
      });
    } catch (err) {
      console.error('[useVoice] Failed to start conversation:', err);
    }
  }, [agentId, conversation, dynamicVariables]);

  const stopConversation = useCallback(async (): Promise<void> => {
    try {
      await conversation.endSession();
    } catch (err) {
      console.error('[useVoice] Failed to stop conversation:', err);
    }
  }, [conversation]);

  return {
    status,
    isSpeaking: conversation.isSpeaking,
    startConversation,
    stopConversation,
  };
}
