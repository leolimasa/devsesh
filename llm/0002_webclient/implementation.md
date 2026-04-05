# Implementation Plan: Web Client

## Overview

This implementation creates a React + TypeScript web client for devsesh, embedded in the Go binary and served by the existing server. The client provides authentication via WebAuthn/FIDO2 passkeys, session management, and device pairing functionality.

---

## Data Structures

### TypeScript Types (New)

**`web/src/types/api.ts`**

```typescript
// Session from server API
interface Session {
  id: string;
  user_id: number;
  name: string;
  hostname: string;
  started_at: string;
  last_ping_at: string | null;
  ended_at: string | null;
  metadata: string | null;
}

// WebSocket session update event
interface SessionUpdate {
  event: "start" | "ping" | "end" | "meta";
  session_id: string;
  session: Session;
}

// Auth state
interface User {
  id: number;
  email: string;
  token: string;
}
```

### Database (No Changes)

The existing database schema supports all required functionality. No modifications needed.

---

## Server Modifications

### `docs/SERVER_ENDPOINTS.md` (New File) [req.8to10r]

Create documentation file listing all server endpoints:

- Document all `/api/v1/auth/*` endpoints (login, register, pairing)
- Document all `/api/v1/sessions/*` endpoints
- Document `/api/v1/ssh/*` endpoints
- Include request/response formats for each

### `web/embed.go` (Modify) [req.vdh4rk]

Update the embed directive to include the built React app's `dist/` folder instead of just `index.html`.

### `internal/server/server.go` (Modify) [req.vdh4rk]

Update the file server to serve from the embedded `dist/` folder and handle SPA routing by falling back to `index.html` for non-API routes.

### `internal/db/queries.go` (Modify)

Add two new functions:

**`DeleteStaleSessions`**: Delete sessions that haven't been pinged for over an hour and have no end time. Used by the dashboard's "remove stale sessions" button. [req.9s0lei]

**`DeleteCredential`**: Delete a WebAuthn credential by ID for the passkey management feature. [req.67jse7]

### `internal/auth/webauthn.go` (Modify)

Add endpoints for passkey management:

**`AddPasskeyBeginHandler`**: Initiate adding a new passkey to an existing user's account. Requires JWT auth. Returns WebAuthn registration options. [req.aqvd4y]

**`AddPasskeyFinishHandler`**: Complete passkey registration for an existing user. Stores the new credential. [req.aqvd4y]

**`DeletePasskeyHandler`**: Remove a passkey from the user's account. Requires at least one passkey to remain. [req.67jse7]

**`ListPasskeysHandler`**: Return list of credentials for the current user. [req.aqvd4y]

### `internal/sessions/handler.go` (Modify)

**`DeleteStaleHandler`**: HTTP handler that calls `db.DeleteStaleSessions` to remove sessions not pinged for 1+ hour. Returns count of deleted sessions. [req.9s0lei]

### `internal/server/server.go` (Modify)

Register new routes:
- `POST /api/v1/auth/passkeys/begin` - Add passkey begin [req.aqvd4y]
- `POST /api/v1/auth/passkeys/finish` - Add passkey finish [req.aqvd4y]
- `DELETE /api/v1/auth/passkeys/{id}` - Delete passkey [req.67jse7]
- `GET /api/v1/auth/passkeys` - List passkeys [req.aqvd4y]
- `DELETE /api/v1/sessions/stale` - Delete stale sessions [req.9s0lei]
- `GET /api/v1/sessions/{session_id}` - Get single session details [req.gb3lku]
- `GET /api/v1/auth/status` - Check if any users exist [req.vgcps0]

---

## Web Client Implementation

### Project Setup [req.54k42f] [req.damwg0] [req.9k224a]

**`web/package.json`** (New)

Initialize React + TypeScript project with:
- React 18
- TypeScript
- Vite as build tool
- Tailwind CSS
- shadcn/ui components
- @simplewebauthn/browser for WebAuthn client-side

**`web/tailwind.config.js`** (New)

Configure Tailwind with shadcn/ui dark mode as default. [req.9k224a]

**`web/src/index.css`** (New)

Global styles with dark theme colors from shadcn/ui.

### Routing

**`web/src/App.tsx`** (New) [req.54k42f]

Root component with React Router setup:
- `/` - Redirect to `/dashboard` if authenticated, else to `/login`
- `/login` - Login page
- `/register` - Create user page
- `/pair` - Pairing page
- `/dashboard` - Session list (protected)
- `/sessions/:id` - Session details (protected)
- `/settings/passkeys` - Passkey management (protected)

Use a protected route wrapper that checks for JWT token in localStorage.

### Authentication Context

**`web/src/contexts/AuthContext.tsx`** (New) [req.8udwqf]

Provide authentication state throughout the app:
- Store JWT token in localStorage
- Provide `login`, `logout`, `register` functions
- Track current user state
- Include `isAuthenticated` computed property

### API Client

**`web/src/lib/api.ts`** (New) [req.ygs9k9]

Centralized API client:

**`fetchApi`**: Wrapper around fetch that adds Authorization header from stored token. Handles 401 responses by clearing auth state.

**`checkUsersExist`**: Call `/api/v1/auth/status` to check if any users exist. Used to show registration prompt. [req.vgcps0]

**`loginBegin`**: Call `/api/v1/auth/login/begin` with email. [req.ybw3lj]

**`loginFinish`**: Call `/api/v1/auth/login/finish` with email and WebAuthn response. [req.5tsv4p]

**`registerBegin`**: Call `/api/v1/auth/register/begin` with email. [req.xmzin4]

**`registerFinish`**: Call `/api/v1/auth/register/finish` with email and WebAuthn response. [req.zgkk62]

**`pairExchange`**: Call `/api/v1/auth/pair/exchange` with pairing code. [req.29evhg]

**`listSessions`**: Call `/api/v1/sessions` to get user's sessions. [req.f8zgi8]

**`getSession`**: Call `/api/v1/sessions/{id}` to get single session. [req.gb3lku]

**`deleteStaleSessions`**: Call `DELETE /api/v1/sessions/stale`. [req.9s0lei]

**`listPasskeys`**: Call `/api/v1/auth/passkeys`. [req.aqvd4y]

**`addPasskeyBegin`**: Call `/api/v1/auth/passkeys/begin`. [req.aqvd4y]

**`addPasskeyFinish`**: Call `/api/v1/auth/passkeys/finish`. [req.aqvd4y]

**`deletePasskey`**: Call `DELETE /api/v1/auth/passkeys/{id}`. [req.67jse7]

### WebSocket Hook

**`web/src/hooks/useSessionUpdates.ts`** (New) [req.4lceak]

Custom hook for real-time session updates:
- Connect to `/api/v1/sessions/updates` WebSocket
- Parse incoming `SessionUpdate` messages
- Provide callback interface for components to react to updates
- Handle reconnection on disconnect
- Include JWT token in WebSocket connection URL as query param

### UI Components (shadcn/ui based)

**`web/src/components/ui/*`** (New) [req.damwg0]

Install and configure shadcn/ui components:
- Button, Input, Card, Table
- Dialog, Alert
- Form components

### Pages

**`web/src/pages/LoginPage.tsx`** (New) [req.8udwqf] [req.ybw3lj] [req.5tsv4p]

Login form with:
- Email input field
- "Login with Passkey" button that initiates WebAuthn ceremony
- Link to registration if no users exist [req.vgcps0]
- Error handling for failed authentication

Flow:
1. User enters email
2. Call `loginBegin` to get WebAuthn options
3. Use `@simplewebauthn/browser` to perform authentication
4. Call `loginFinish` with the response
5. Store token and redirect to dashboard

**`web/src/pages/RegisterPage.tsx`** (New) [req.vqmg93] [req.xmzin4] [req.zgkk62]

Registration form with:
- Email input field
- "Create Account with Passkey" button
- Redirect to login after successful registration

Flow:
1. User enters email
2. Call `registerBegin` to get WebAuthn options
3. Use `@simplewebauthn/browser` to create credential
4. Call `registerFinish` with the response
5. Redirect to login page

**`web/src/pages/PairPage.tsx`** (New) [req.29evhg] [req.xm73nc]

Pairing interface for CLI authentication:
- Input for 6-character pairing code
- "Pair Device" button
- Success message on completion

Flow:
1. User enters pairing code from CLI
2. Call `pairExchange` with the code
3. Show success message; CLI automatically receives token [req.xm73nc]

**`web/src/pages/DashboardPage.tsx`** (New) [req.f8zgi8] [req.xizyqy]

Session list dashboard:
- Table showing all user sessions with columns: [req.4eaaqa] [req.h2j29f] [req.mnocgd] [req.67f9op]
  - Session ID (truncated)
  - Name
  - Start time (formatted)
  - Last ping (formatted, relative time)
  - Status badge (active/inactive based on 5-minute threshold) [req.kebcow]
  - Metadata preview [req.85nmq5]
- Clickable rows navigate to session details [req.ncy560]
- "Remove Stale Sessions" button (sessions not pinged for 1+ hour) [req.9s0lei]
- Real-time updates via WebSocket [req.4lceak]

Status calculation: Session is inactive if `last_ping_at` is more than 5 minutes ago. [req.kebcow]

**`web/src/pages/SessionDetailPage.tsx`** (New) [req.gb3lku] [req.h1hqvu]

Session detail view:
- Display all session metadata in formatted view
- Parse and display JSON metadata nicely
- Real-time updates when metadata changes [req.gb3lku]
- Placeholder div for future terminal embed [req.h1hqvu]
- Back navigation to dashboard

**`web/src/pages/PasskeyManagementPage.tsx`** (New) [req.aqvd4y] [req.67jse7] [req.jzlryq]

Passkey management (authenticated users only):
- List of current passkeys with creation date
- "Add Passkey" button to register new credential
- Delete button on each passkey (disabled if only one remains)
- Confirmation dialog before deletion

---

## Build and Deployment

### `build.sh` (New File in project root) [req.w6ipyf]

Shell script that:
1. `cd web && npm install && npm run build` - Build React app
2. `go build -o devsesh .` - Build Go binary with embedded web client

### `flake.nix` (Modify) [req.s5z3zk]

Add to `buildInputs`:
- `nodejs` (for React build)
- `nodePackages.npm` (package management)

Update Go build to run web client build first.

---

## Responsive Design [req.9dmqy9]

All pages use Tailwind responsive utilities:
- Mobile-first design approach
- Dashboard table becomes card list on small screens
- Forms stack vertically on mobile
- Navigation adapts to screen size

---

## Summary of Files

### New Files
- `docs/SERVER_ENDPOINTS.md`
- `web/package.json`
- `web/vite.config.ts`
- `web/tsconfig.json`
- `web/tailwind.config.js`
- `web/postcss.config.js`
- `web/index.html`
- `web/src/main.tsx`
- `web/src/App.tsx`
- `web/src/index.css`
- `web/src/types/api.ts`
- `web/src/contexts/AuthContext.tsx`
- `web/src/lib/api.ts`
- `web/src/hooks/useSessionUpdates.ts`
- `web/src/components/ui/*` (shadcn components)
- `web/src/pages/LoginPage.tsx`
- `web/src/pages/RegisterPage.tsx`
- `web/src/pages/PairPage.tsx`
- `web/src/pages/DashboardPage.tsx`
- `web/src/pages/SessionDetailPage.tsx`
- `web/src/pages/PasskeyManagementPage.tsx`
- `build.sh`

### Modified Files
- `web/embed.go`
- `internal/server/server.go`
- `internal/db/queries.go`
- `internal/auth/webauthn.go`
- `internal/sessions/handler.go`
- `flake.nix`
