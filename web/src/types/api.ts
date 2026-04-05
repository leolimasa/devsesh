export interface Session {
  id: string;
  user_id: number;
  name: string;
  hostname: string;
  started_at: string;
  last_ping_at: string | null;
  ended_at: string | null;
  metadata: string | null;
}

export interface SessionUpdate {
  event: "start" | "ping" | "end" | "meta";
  session_id: string;
  session: Session;
}

export interface User {
  id: number;
  email: string;
  token: string;
}

export interface Passkey {
  id: string;
  created_at: string;
}

export interface AuthStatus {
  exists: boolean;
}