import { create } from 'zustand';

export interface SessionSummary {
  session_id: string;
  title: string;
  updated_at: string;
  created_at: string;
  message_count: number;
}

interface ChatState {
  /** Currently active session ID (null = new conversation) */
  activeSessionId: string | null;
  /** List of recent sessions for sidebar */
  recentSessions: SessionSummary[];
  /** Set the active session */
  setActiveSession: (sessionId: string | null) => void;
  /** Update the recent sessions list */
  setRecentSessions: (sessions: SessionSummary[]) => void;
  /** Start a new conversation */
  startNewConversation: () => void;
  /** Remove a session from the list */
  removeSession: (sessionId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeSessionId: null,
  recentSessions: [],
  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setRecentSessions: (sessions) => set({ recentSessions: sessions }),
  startNewConversation: () => set({ activeSessionId: null }),
  removeSession: (sessionId) =>
    set((state) => ({
      recentSessions: state.recentSessions.filter((s) => s.session_id !== sessionId),
      // If the deleted session was active, switch to new conversation
      activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
    })),
}));
