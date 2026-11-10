// The bridge between the AI agent and the app. App.tsx builds one of these;
// getters (not values) so tools always see the latest state mid-run.
import { ConnState, Profile, Session } from '../api';
import { Avatar, Room } from '../shared';

export type AgentScreen = 'room' | 'link' | 'settings' | 'onboarding';
export const AGENT_SCREENS: AgentScreen[] = ['room', 'link', 'settings', 'onboarding'];

export interface AgentContext {
  getSession(): Session | null;
  getProfile(): Profile | null;
  /** Persist profile locally (AsyncStorage + React state). Server PATCH is done by the tool. */
  setProfile(p: Profile): Promise<void>;
  getRoom(): Room | null;
  /** serverNow - Date.now() */
  getClockSkew(): number;
  getConn(): ConnState;
  /** The screen the user opened the assistant from. */
  getFromScreen(): string;
  /** Switch screen (the assistant defers this until its reply is finished). */
  navigate(screen: AgentScreen): void;
  getAiChatterEnabled(): Promise<boolean>;
  setAiChatterEnabled(enabled: boolean): Promise<void>;
  /** Native confirmation dialog for dangerous actions; resolves true if the user taps confirm. */
  confirm(title: string, message: string, confirmText: string): Promise<boolean>;
  /** DELETE /api/me + clear local session; returns to the room gate. */
  leaveRoom(): Promise<void>;
}

/** Per-run scratch state shared by the agent loop and tool executors. */
export type RunState = {
  /** The user's message that started this run. */
  userText: string;
  /** The assistant's last text reply before this user message (for confirmations). */
  prevAssistantText: string;
  /** Navigation requested by a tool; applied after the reply finishes. */
  pendingNav: AgentScreen | null;
  /** Latest avatar set by update_avatar during this run (for the live preview). */
  avatar: Avatar | null;
  /** Share sheet requested (opened after the reply). */
  share: string | null;
};
