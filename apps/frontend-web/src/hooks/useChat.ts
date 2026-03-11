// ============================================================
// useChat.ts — Text-based chat with the RM Buddy agent API
// INFRA-11LABS-02
// ============================================================

import { useState, useCallback } from 'react';
import axios from 'axios';
import { useAuthStore } from '@/store/auth.store';
import { useWidgetStore } from '@/store/widget.store';
import type { WidgetPayload } from '@/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  widgets?: WidgetPayload[];
  timestamp: Date;
}

// Orchestrator returns this shape directly (no data wrapper)
interface AgentChatResponse {
  text: string;
  widgets: WidgetPayload[];
  response_type: string;
  session_id: string;
  message_id: string;
  metadata?: { intent?: string };
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
  const setWidgets = useWidgetStore((s) => s.setWidgets);

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
        const rmId = rmIdentity?.rm_id ?? '';
        const response = await axios.post<AgentChatResponse>(
          `${apiUrl}/api/v1/agent/chat`,
          { message: trimmed, session_id: sessionId, rm_id: rmId },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );

        const raw = response.data;
        // Support both direct shape { text, widgets } and wrapped { data: { response, widgets } }
        const agentText = (raw as unknown as { data?: { response?: string } }).data?.response ?? raw.text ?? '';
        const widgets = raw.widgets;

        // Push widgets to the global store for the right-side panel
        if (widgets?.length) {
          setWidgets(widgets);
        }

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
