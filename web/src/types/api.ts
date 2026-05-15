export interface Host {
  id: number;
  label: string;
  hostname: string;
  ssh_user: string;
  ssh_port: number;
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