// ============================================================
// useChat.ts — Text-based chat with the RM Buddy agent API
// INFRA-11LABS-02
// ============================================================

import { useState, useCallback } from 'react';
import axios from 'axios';
import { useAuthStore } from '@/store/auth.store';
import type { WidgetPayload } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  widgets?: WidgetPayload[];
  timestamp: Date;
}

interface AgentChatResponse {
  status: 'success' | 'error';
  data: {
    response: string;
    widgets: WidgetPayload[];
    intent: string;
  };
}

export interface UseChatReturn {
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem('rm-buddy-auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string } };
    return parsed?.state?.token ?? null;
  } catch {
    return null;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rmIdentity = useAuthStore((s) => s.rmIdentity);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Append user message immediately
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setError(null);

      const token = getAuthToken();
      const sessionId = rmIdentity?.session_id ?? '';
      const apiUrl = import.meta.env.VITE_API_URL ?? '';

      try {
        const response = await axios.post<AgentChatResponse>(
          `${apiUrl}/api/v1/agent/chat`,
          { message: trimmed, session_id: sessionId },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );

        const { response: agentText, widgets } = response.data.data;

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: agentText,
          widgets: widgets?.length ? widgets : undefined,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        const message =
          axios.isAxiosError(err) && err.response?.data
            ? String(
                (err.response.data as Record<string, unknown>)?.error ??
                  err.message,
              )
            : 'Something went wrong. Please try again.';

        setError(message);

        // Surface the error as an assistant message so it appears in chat
        const errorMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: message,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsLoading(false);
      }
    },
    [rmIdentity],
  );

  return { messages, sendMessage, isLoading, error };
}
