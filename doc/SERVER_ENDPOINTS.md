# Server Endpoints

This document describes all API endpoints available in the devsesh server.

## Base URL
`/api/v1`

## Authentication Endpoints

### Check if users exist
- **Endpoint:** `GET /api/v1/auth/status`
- **Description:** Check if any users exist in the database. Used to determine if registration should be offered.
- **Response:**
```json
{
  "exists": true
}
```

### Login - Begin
- **Endpoint:** `POST /api/v1/auth/login/begin`
- **Description:** Initiate WebAuthn login flow.
- **Request Body:**
```json
{
  "email": "user@example.com"
}
```
- **Response:** WebAuthn credential request options (PackedCredentialOptions)

### Login - Finish
- **Endpoint:** `POST /api/v1/auth/login/finish`
- **Description:** Complete WebAuthn login flow.
- **Request Body:**
```json
{
  "email": "user@example.com"
}
```
- **Request Body (Form):** The WebAuthn response is sent as form data with the key `credential`
- **Response:**
```json
{
  "token": "jwt-token-here"
}
```

### Register - Begin
- **Endpoint:** `POST /api/v1/auth/register/begin`
- **Description:** Initiate WebAuthn registration flow (create new user).
- **Request Body:**
```json
{
  "email": "user@example.com"
}
```
- **Response:** WebAuthn credential creation options (PublicKeyCredentialCreationOptions)

### Register - Finish
- **Endpoint:** `POST /api/v1/auth/register/finish`
- **Description:** Complete WebAuthn registration flow.
- **Request Body:**
```json
{
  "email": "user@example.com"
}
```
- **Request Body (Form):** The WebAuthn response is sent as form data with the key `credential`
- **Response:** HTTP 201 Created on success

### Pairing - Start
- **Endpoint:** `POST /api/v1/auth/pair/start`
- **Description:** Generate a pairing code for CLI authentication.
- **Request Body:**
```json
{
  "email": "user@example.com"
}
```
- **Response:**
```json
{
  "code": "ABC123"
}
```
- **Notes:** Pairing codes expire in 5 minutes and are single-use.

### Pairing - Exchange
- **Endpoint:** `POST /api/v1/auth/pair/exchange`
- **Description:** Approve a pairing code from the web client (after user enters the code).
- **Authentication:** Requires JWT token
- **Request Body:**
```json
{
  "code": "ABC123"
}
```
- **Response:** HTTP 200 OK
- **Notes:** After calling this, the CLI can poll `/pair/complete` to get the JWT token.

### Pairing - Complete
- **Endpoint:** `POST /api/v1/auth/pair/complete`
- **Description:** Complete the pairing process (called from CLI).
- **Request Body:**
```json
{
  "code": "ABC123"
}
```
- **Response:**
```json
{
  "token": "jwt-token-here",
  "url": "https://server.url"
}
```

## Passkey Management Endpoints

### List Passkeys
- **Endpoint:** `GET /api/v1/auth/passkeys`
- **Authentication:** Requires JWT token
- **Description:** Get all passkeys for the current user.
- **Response:**
```json
[
  {
    "id": "credential-id",
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

### Add Passkey - Begin
- **Endpoint:** `POST /api/v1/auth/passkeys/begin`
- **Authentication:** Requires JWT token
- **Description:** Initiate adding a new passkey to the user's account.
- **Response:** WebAuthn credential creation options

### Add Passkey - Finish
- **Endpoint:** `POST /api/v1/auth/passkeys/finish`
- **Authentication:** Requires JWT token
- **Description:** Complete adding a new passkey.
- **Request Body (Form):** The WebAuthn response is sent as form data with the key `credential`
- **Response:** HTTP 201 Created on success

### Delete Passkey
- **Endpoint:** `DELETE /api/v1/auth/passkeys/{id}`
- **Authentication:** Requires JWT token
- **Description:** Remove a passkey from the user's account.
- **Response:** HTTP 204 No Content
- **Notes:** At least one passkey must remain.

## Session Endpoints

### List Sessions
- **Endpoint:** `GET /api/v1/sessions`
- **Authentication:** Requires JWT token
- **Description:** Get all sessions for the current user.
- **Response:**
```json
[
  {
    "id": "session-uuid",
    "user_id": 1,
    "name": "Session Name",
    "hostname": "hostname",
    "started_at": "2024-01-01T00:00:00Z",
    "last_ping_at": "2024-01-01T00:05:00Z",
    "ended_at": null,
    "metadata": "{\"key\": \"value\"}"
  }
]
```

### Get Session by ID
- **Endpoint:** `GET /api/v1/sessions/{session_id}`
- **Authentication:** Requires JWT token
- **Description:** Get a single session by ID.
- **Response:** Same as List Sessions but returns a single object

### Start Session
- **Endpoint:** `POST /api/v1/sessions/{session_id}/start`
- **Authentication:** Requires JWT token
- **Request Body:**
```json
{
  "name": "Session Name",
  "hostname": "hostname",
  "start_time": "2024-01-01T00:00:00Z"
}
```
- **Response:** HTTP 201 Created

### Ping Session
- **Endpoint:** `POST /api/v1/sessions/{session_id}/ping`
- **Authentication:** Requires JWT token (must own session)
- **Description:** Update the last ping time for a session.
- **Response:** HTTP 200 OK

### End Session
- **Endpoint:** `POST /api/v1/sessions/{session_id}/end`
- **Authentication:** Requires JWT token (must own session)
- **Description:** Mark a session as ended.
- **Response:** HTTP 200 OK

### Update Session Metadata
- **Endpoint:** `POST /api/v1/sessions/{session_id}/meta`
- **Authentication:** Requires JWT token (must own session)
- **Request Body:** JSON object with metadata key-value pairs
- **Response:** HTTP 200 OK

### Delete Stale Sessions
- **Endpoint:** `DELETE /api/v1/sessions/stale`
- **Authentication:** Requires JWT token
- **Description:** Delete all sessions that haven't been pinged for at least 1 hour and haven't ended.
- **Response:**
```json
{
  "deleted": 5
}
```

### Session Updates (WebSocket)
- **Endpoint:** `GET /api/v1/sessions/updates`
- **Authentication:** Requires JWT token
- **Description:** WebSocket endpoint for real-time session updates.
- **Query Parameters:** `token` - JWT token passed as query parameter
- **Message Format:**
```json
{
  "event": "start|ping|end|meta",
  "session_id": "session-uuid",
  "session": { ... }
}
```

## SSH Endpoints

### SSH Connect
- **Endpoint:** `GET /api/v1/ssh/connect/{session_id}`
- **Authentication:** Requires JWT token
- **Description:** WebSocket endpoint to connect to a session via SSH.
- **Response:** JSON with hostname for the session

### SSH WebAuthn Begin
- **Endpoint:** `POST /api/v1/ssh/webauthn/begin`
- **Authentication:** Requires JWT token
- **Description:** Begin WebAuthn authentication for SSH key authorization.

### SSH WebAuthn Complete
- **Endpoint:** `POST /api/v1/ssh/webauthn/complete`
- **Authentication:** Requires JWT token
- **Description:** Complete WebAuthn authentication for SSH key authorization.

## Static Files

### Root
- **Endpoint:** `GET /`
- **Description:** Serves the web client (React SPA).

## Error Responses

All endpoints may return the following error responses:
- `400 Bad Request` - Invalid request body
- `401 Unauthorized` - Missing or invalid JWT token
- `403 Forbidden` - Access denied
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error