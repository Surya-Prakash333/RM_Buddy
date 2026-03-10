// ============================================================
// Type declarations for @11labs/react
// These are minimal stubs matching the v0.0.x public API.
// Remove this file once @11labs/react is installed and ships
// its own type declarations (or DefinitelyTyped types exist).
// ============================================================

declare module '@11labs/react' {
  export type ConversationStatus = 'disconnected' | 'connecting' | 'connected';

  export interface ConversationCallbacks {
    onConnect?: () => void;
    onDisconnect?: () => void;
    /** Called with a human-readable error string */
    onError?: (message: string) => void;
    onMessage?: (message: { source: string; message: string }) => void;
  }

  export interface StartSessionConfig {
    agentId: string;
    dynamicVariables?: Record<string, string | number | boolean>;
    overrides?: Record<string, unknown>;
  }

  export interface ConversationReturn {
    /** Current connection status */
    status: ConversationStatus;
    /** True while the agent TTS audio is playing */
    isSpeaking: boolean;
    /** Start a new conversation session */
    startSession: (config: StartSessionConfig) => Promise<void>;
    /** End the active session */
    endSession: () => Promise<void>;
  }

  /**
   * Primary hook for ElevenLabs Conversational AI.
   */
  export function useConversation(callbacks?: ConversationCallbacks): ConversationReturn;
}
