export interface Host {
  id: number;
  label: string;
  hostname: string;
  ssh_user: string;
  ssh_port: number;
  ssh_principal: string;
  user_id: number;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: number;
  host_id: number;
  host?: Host;
  name: string;
  started_at: string;
  last_ping_at: string | null;
  last_activity_at: string | null;
  ended_at: string | null;
  metadata: string | null;
  // User-controlled display order (ascending). Always present from the API;
  // optional here only so older test fixtures don't need to set it.
  seq?: number;
}

export interface SessionUpdate {
  event: "start" | "ping" | "activity" | "end" | "meta";
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

export interface PasskeyEnrollment {
  code: string;
}

export interface EnrollmentMessage {
  type: 'spake2_a' | 'spake2_b' | 'encrypted_payload';
  message?: string;
  nonce?: string;
  ciphertext?: string;
}

export interface MasterKeyResponse {
  encrypted_master_key: string;
}

export interface SSHCAConfig {
  public_key: string;
  client_share: string;
  server_verifying_share: string;
  client_verifying_share: string;
}

// Shared connection status for the SSH terminal and its top bar.
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "error";

export interface QuickKeyComboStep {
  type: "combo";
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export interface QuickKeyLiteralStep {
  type: "literal";
  text: string;
  enter: boolean;
}

export type QuickKeyStep = QuickKeyComboStep | QuickKeyLiteralStep;

export interface QuickKey {
  id: number;
  user_id: number;
  name: string;
  display_token: string;
  spec: string;
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}