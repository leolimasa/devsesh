import type { Session, Passkey, AuthStatus } from "@/types/api"

function getToken(): string | null {
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

  if (response.status === 204) {
    return {} as T
  }

  return response.json()
}

export async function checkUsersExist(): Promise<AuthStatus> {
  return fetchApi<AuthStatus>("/auth/status")
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

export async function registerFinish(email: string, credential: unknown): Promise<void> {
  const formData = new FormData()
  formData.append("email", email)
  formData.append("credential", JSON.stringify(credential))

  const response = await fetch(`/api/v1/auth/register/finish`, {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(error || "Registration failed")
  }
}

export async function pairStart(email: string): Promise<{ code: string }> {
  return fetchApi<{ code: string }>("/auth/pair/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  })
}

export async function pairExchange(code: string): Promise<{ token: string }> {
  return fetchApi<{ token: string }>("/auth/pair/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
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

export function getWsEndpoint(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
  const token = getToken()
  return `${protocol}//${window.location.host}/api/v1/sessions/updates?token=${token}`
}