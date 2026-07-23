import type { Session, Passkey, AuthStatus, Host, PasskeyEnrollment, SSHCAConfig, QuickKey } from "@/types/api"

export function getToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem("token")
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken()
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  }
  if (token) {
    ;(headers as Record<string, string>)["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`/api/v1${endpoint}`, {
    ...options,
    headers,
  })

  if (response.status === 401) {
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    window.location.href = "/login"
    throw new Error("Unauthorized")
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || `HTTP error ${response.status}`)
  }

  // Handle responses with no body (204 No Content, 201 Created with no body)
  const contentLength = response.headers.get('content-length')
  if (response.status === 204 || contentLength === '0' || contentLength === null) {
    const text = await response.text()
    if (!text) {
      return {} as T
    }
    return JSON.parse(text)
  }

  return response.json()
}

export async function checkUsersExist(): Promise<AuthStatus> {
  return fetchApi<AuthStatus>("/auth/status")
}

// Best-effort debug logging: ships client-side diagnostics (e.g. iOS Safari
// WebAuthn errors that can't be seen without devtools) to the server journal.
// Never throws — failures here must not mask the original error.
export async function clientLog(data: Record<string, unknown>): Promise<void> {
  try {
    await fetch("/api/v1/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true,
    })
  } catch {
    // ignore
  }
}

export async function loginBegin(email: string): Promise<unknown> {
  return fetchApi<unknown>("/auth/login/begin", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export async function loginFinish(email: string, credential: unknown): Promise<{ token: string }> {
  const response = await fetch(`/api/v1/auth/login/finish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, credential }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || "Login failed")
  }

  return response.json()
}

export async function registerBegin(email: string): Promise<unknown> {
  return fetchApi<unknown>("/auth/register/begin", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export interface RegisterFinishResponse {
  client_share?: string // Base64-encoded FROST client share (returned for new users)
  token?: string // JWT token for auto-login after registration
}

export async function registerFinish(email: string, credential: unknown, encryptedMasterKey?: string): Promise<RegisterFinishResponse> {
  const response = await fetch(`/api/v1/auth/register/finish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, credential, encrypted_master_key: encryptedMasterKey || "" }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || "Registration failed")
  }

  // Parse the response which may contain the client share
  const text = await response.text()
  if (!text) {
    return {}
  }
  return JSON.parse(text)
}

export async function pairStart(email: string): Promise<{ code: string }> {
  return fetchApi<{ code: string }>("/auth/pair/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export async function pairComplete(code: string): Promise<{ token: string; url: string }> {
  return fetchApi<{ token: string; url: string }>("/auth/pair/complete", {
    method: "POST",
    body: JSON.stringify({ code }),
  })
}

export async function listSessions(): Promise<Session[]> {
  return fetchApi<Session[]>("/sessions")
}

export async function getSession(id: string): Promise<Session> {
  return fetchApi<Session>(`/sessions/${id}`)
}

export async function deleteStaleSessions(): Promise<{ deleted: number }> {
  return fetchApi<{ deleted: number }>("/sessions/stale", {
    method: "DELETE",
  })
}

export async function listPasskeys(): Promise<Passkey[]> {
  return fetchApi<Passkey[]>("/auth/passkeys")
}

export async function addPasskeyBegin(): Promise<unknown> {
  return fetchApi<unknown>("/auth/passkeys/begin", {
    method: "POST",
  })
}

export async function addPasskeyFinish(credential: unknown): Promise<void> {
  const response = await fetch(`/api/v1/auth/passkeys/finish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ credential }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || "Failed to add passkey")
  }
}

export async function deletePasskey(id: string): Promise<void> {
  return fetchApi<void>(`/auth/passkeys/${id}`, {
    method: "DELETE",
  })
}

export async function createPasskeyEnrollment(): Promise<PasskeyEnrollment> {
  return fetchApi<PasskeyEnrollment>("/auth/passkeys/enrollment", {
    method: "POST",
  })
}

export async function enrollmentBegin(code: string): Promise<unknown> {
  return fetchApi<unknown>(`/auth/passkeys/enrollment/${code}/begin`, {
    method: "POST",
  })
}

export async function enrollmentComplete(
  code: string,
  credential: unknown,
  encryptedMasterKey: string
): Promise<void> {
  return fetchApi<void>(`/auth/passkeys/enrollment/${code}/complete`, {
    method: "POST",
    body: JSON.stringify({ credential, encrypted_master_key: encryptedMasterKey }),
  })
}

// Fetch the encrypted master key. Pass the base64url-encoded credential id of the
// passkey that just authenticated: each passkey wraps the master key with its own
// PRF output, so the server must return that specific credential's blob (omitting
// it falls back to the first credential, which only decrypts on one device).
export async function getMasterKey(credentialId?: string): Promise<{ encrypted_master_key: string }> {
  const query = credentialId ? `?credential_id=${encodeURIComponent(credentialId)}` : ""
  return fetchApi<{ encrypted_master_key: string }>(`/auth/master-key${query}`)
}

export function getEnrollmentWebSocketURL(code: string, token?: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const base = `${protocol}//${window.location.host}/api/v1/auth/passkeys/enrollment/${code}`
  if (token) {
    return `${base}?token=${encodeURIComponent(token)}`
  }
  return base
}

export function getWsEndpoint(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/api/v1/sessions/updates`
}

export async function listHosts(): Promise<Host[]> {
  return fetchApi<Host[]>("/hosts")
}

export async function createHost(host: { label: string; hostname: string; ssh_user?: string; ssh_port?: number; ssh_principal?: string }): Promise<Host> {
  return fetchApi<Host>("/hosts", {
    method: "POST",
    body: JSON.stringify(host),
  })
}

export async function getHost(id: number): Promise<Host> {
  return fetchApi<Host>(`/hosts/${id}`)
}

export async function updateHost(id: number, host: { label?: string; hostname?: string; ssh_user?: string; ssh_port?: number; ssh_principal?: string }): Promise<Host> {
  return fetchApi<Host>(`/hosts/${id}`, {
    method: "PUT",
    body: JSON.stringify(host),
  })
}

export async function deleteHost(id: number): Promise<void> {
  return fetchApi<void>(`/hosts/${id}`, {
    method: "DELETE",
  })
}

export async function pairExchange(
  code: string,
  hostId?: number,
  newHost?: { label: string; hostname: string }
): Promise<{ token: string }> {
  return fetchApi<{ token: string }>("/auth/pair/exchange", {
    method: "POST",
    body: JSON.stringify({ code, host_id: hostId, new_host: newHost }),
  })
}

export function getSSHWebSocketURL(hostId: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/api/v1/hosts/${hostId}/ssh`
}

export async function getSSHCAConfig(): Promise<SSHCAConfig> {
  return fetchApi<SSHCAConfig>("/sshca/config")
}

export async function getSSHCAPublicKey(): Promise<{ public_key: string }> {
  return fetchApi<{ public_key: string }>("/sshca/public-key")
}

export async function updateSSHCAClientShare(encryptedShare: string): Promise<void> {
  await fetchApi<void>("/sshca/client-share", {
    method: "PUT",
    body: JSON.stringify({ encrypted_share: encryptedShare }),
  })
}

export function getSSHCASigningWebSocketURL(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${window.location.host}/api/v1/sshca/sign`
}

export async function listQuickKeys(): Promise<QuickKey[]> {
  return fetchApi<QuickKey[]>("/quick-keys")
}

export async function createQuickKey(qk: {
  name: string
  display_token: string
  spec: string
  pinned: boolean
  sort_order: number
}): Promise<QuickKey> {
  return fetchApi<QuickKey>("/quick-keys", {
    method: "POST",
    body: JSON.stringify(qk),
  })
}

export async function updateQuickKey(
  id: number,
  qk: {
    name?: string
    display_token?: string
    spec?: string
    pinned?: boolean
    sort_order?: number
  }
): Promise<QuickKey> {
  return fetchApi<QuickKey>(`/quick-keys/${id}`, {
    method: "PUT",
    body: JSON.stringify(qk),
  })
}

export async function deleteQuickKey(id: number): Promise<void> {
  return fetchApi<void>(`/quick-keys/${id}`, {
    method: "DELETE",
  })
}
