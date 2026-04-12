# Implementation: Host Tracking

## Data Structures

### New: Host struct (Go)
**File:** `internal/db/queries.go`

```go
type Host struct {
    ID        int64     `json:"id"`
    Label     string    `json:"label"`
    Hostname  string    `json:"hostname"`
    UserID    int64     `json:"user_id"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}
```

[req.vvpo40] [req.eo1lrm] [req.ftt1fg] [req.c17jn1] [req.bi1i36] [req.633g0p]

### Modified: Session struct (Go)
**File:** `internal/db/queries.go`

Remove `Hostname` field, add `HostID` field:
```go
type Session struct {
    ID         string     `json:"id"`
    UserID     int64      `json:"user_id"`
    HostID     int64      `json:"host_id"`
    Name       string     `json:"name"`
    StartedAt  time.Time  `json:"started_at"`
    // ... rest unchanged
}
```

[req.t9rqem] [req.6uz0es]

### Modified: Claims struct (Go)
**File:** `internal/auth/jwt.go`

Add `HostID` field to JWT claims:
```go
type Claims struct {
    UserID int64 `json:"sub"`
    HostID int64 `json:"host_id"`
    jwt.RegisteredClaims
}
```

[req.z0gkx3]

### Modified: PairingCode struct (Go)
**File:** `internal/db/queries.go`

Add `HostID` field to store selected host during pairing:
```go
type PairingCode struct {
    Code      string
    UserID    *int64
    HostID    *int64  // NEW
    Approved  bool
    Used      bool
    ExpiresAt time.Time
}
```

### New: Host interface (TypeScript)
**File:** `web/src/types/api.ts`

```typescript
export interface Host {
    id: number;
    label: string;
    hostname: string;
    user_id: number;
    created_at: string;
    updated_at: string;
}
```

### Modified: Session interface (TypeScript)
**File:** `web/src/types/api.ts`

Replace `hostname` with `host_id` and add optional `host` for joined queries:
```typescript
export interface Session {
    id: string;
    user_id: number;
    host_id: number;
    host?: Host;  // Populated by joined queries
    name: string;
    // ... rest unchanged
}
```

---

## Database Migrations

### New: `sql/00007_create_hosts_table.sql`

Create hosts table with unique constraint on (user_id, label). [req.vvpo40] [req.eo1lrm] [req.ftt1fg] [req.c17jn1] [req.bi1i36] [req.633g0p]

### New: `sql/00008_modify_sessions_for_hosts.sql`

1. Delete all existing sessions [req.y8mm4w]
2. Drop `hostname` column from sessions [req.t9rqem]
3. Add `host_id` column with foreign key to hosts [req.6uz0es]
4. Add `host_id` column to `pairing_codes` table

---

## Backend Functions

### File: `internal/db/queries.go`

#### New: `CreateHost(db, host Host) (int64, error)`
Insert a new host record. Return the new host ID. [req.nf90gj]

#### New: `GetHostByID(db, id int64) (*Host, error)`
Fetch a single host by ID. Return nil if not found. [req.nf90gj] [req.amxefx]

#### New: `GetHostsByUserID(db, userID int64) ([]Host, error)`
Fetch all hosts for a user, ordered by label. [req.nf90gj]

#### New: `UpdateHost(db, host Host) error`
Update an existing host (label, hostname). Set updated_at to now. [req.1mxp3p] [req.nf90gj]

#### New: `DeleteHost(db, id int64) error`
Delete a host by ID. Associated sessions are deleted via cascade. [req.3pb2je] [req.nf90gj]

#### New: `GetHostByLabel(db, userID int64, label string) (*Host, error)`
Fetch a host by user ID and label. Used for uniqueness validation. [req.nf90gj]

#### Modified: `CreateSession(db, s Session) error`
Update to use `host_id` instead of `hostname`. [req.6uz0es]

#### Modified: `GetSession(db, id string) (*Session, error)`
Update to return `host_id` instead of `hostname`. [req.6uz0es]

#### Modified: `GetSessionsByUserID(db, userID int64) ([]Session, error)`
Update to return `host_id` instead of `hostname`. [req.6uz0es]

#### New: `GetSessionsWithHostByUserID(db, userID int64) ([]Session, error)`
Fetch sessions with host data joined. Populates session.Host field. [req.16szve]

#### Modified: `ApprovePairingCode(db, code string, userID, hostID int64) error`
Update to also set host_id when approving. [req.z0gkx3]

#### Modified: `GetPairingCode(db, code string) (*PairingCode, error)`
Update to return host_id field.

---

### File: `internal/auth/jwt.go`

#### Modified: `GenerateToken(secret string, userID, hostID int64, expiry time.Duration) (string, error)`
Add hostID parameter to include in JWT claims. [req.z0gkx3]

#### Modified: `ValidateToken(secret, tokenStr string) (*Claims, error)`
No changes needed - will automatically parse hostID from claims.

---

### File: `internal/auth/pairing.go`

#### Modified: `PairExchangeHandler(database *sql.DB) http.HandlerFunc`
Accept `host_id` in request body. If host_id is provided, validate it exists and belongs to the user. If not provided but `new_host` object is provided, create a new host first. Pass host_id to `ApprovePairingCode`. [req.wnkwb9] [req.8f1jl1] [req.w8plh3] [req.u3eo8i]

Request body changes:
```json
{
    "code": "ABC123",
    "host_id": 1,           // Either this...
    "new_host": {           // ...or this
        "label": "My Laptop",
        "hostname": "laptop.local"
    }
}
```

#### Modified: `PairCompleteHandler(database *sql.DB, cfg config.Config) http.HandlerFunc`
Retrieve host_id from pairing code. Validate host still exists (return error if deleted). Include host_id in generated JWT. [req.z0gkx3] [req.amxefx]

---

### File: `internal/server/middleware.go`

#### Modified: `RequireJWT(secret string) func(http.Handler) http.Handler`
Extract both userID and hostID from claims. Add both to context. [req.kltodt]

#### New: `RequireValidHost(db *sql.DB) func(http.Handler) http.Handler`
Middleware that validates the host_id from JWT context still exists in the database. Returns 401 if host was deleted. [req.amxefx]

---

### File: `internal/sessions/handler.go`

#### New: `ContextKeyHostID contextKey = "hostID"`
Context key for host ID from JWT.

#### New: `HostIDFromContext(ctx context.Context) (int64, bool)`
Extract host ID from context.

#### Modified: `StartHandler(database *sql.DB, hub *Hub) http.HandlerFunc`
Read host_id from context (set by JWT middleware) instead of from request body. Use host_id when creating session. [req.kltodt]

#### Modified: `ListHandler(database *sql.DB) http.HandlerFunc`
Call `GetSessionsWithHostByUserID` to include host data in response. [req.16szve]

#### Modified: `GetSessionHandler(database *sql.DB) http.HandlerFunc`
Include host data in response by fetching host separately or using a join query.

---

### File: `internal/hosts/handler.go` (New file)

#### New: `ListHandler(db *sql.DB) http.HandlerFunc`
Return all hosts for the authenticated user. [req.nf90gj]

#### New: `CreateHandler(db *sql.DB) http.HandlerFunc`
Create a new host. Validate label is unique for user. Return 400 if duplicate. [req.nf90gj]

#### New: `GetHandler(db *sql.DB) http.HandlerFunc`
Return a single host by ID. Verify user owns host. [req.nf90gj]

#### New: `UpdateHandler(db *sql.DB) http.HandlerFunc`
Update host label and/or hostname. Validate label uniqueness if changed. [req.1mxp3p] [req.nf90gj]

#### New: `DeleteHandler(db *sql.DB) http.HandlerFunc`
Delete a host. Associated sessions are deleted via cascade. [req.3pb2je] [req.nf90gj]

---

### File: `internal/server/server.go`

#### Modified: `New(cfg, database, cs)`
Register host management endpoints:
- `GET /api/v1/hosts` - ListHandler
- `POST /api/v1/hosts` - CreateHandler
- `GET /api/v1/hosts/{id}` - GetHandler
- `PUT /api/v1/hosts/{id}` - UpdateHandler
- `DELETE /api/v1/hosts/{id}` - DeleteHandler

Apply `RequireValidHost` middleware to session endpoints. [req.nf90gj] [req.amxefx]

---

## Frontend Functions

### File: `web/src/lib/api.ts`

#### New: `listHosts(): Promise<Host[]>`
GET /api/v1/hosts [req.nf90gj]

#### New: `createHost(host: { label: string; hostname: string }): Promise<Host>`
POST /api/v1/hosts [req.nf90gj]

#### New: `getHost(id: number): Promise<Host>`
GET /api/v1/hosts/{id} [req.nf90gj]

#### New: `updateHost(id: number, host: { label: string; hostname: string }): Promise<Host>`
PUT /api/v1/hosts/{id} [req.nf90gj]

#### New: `deleteHost(id: number): Promise<void>`
DELETE /api/v1/hosts/{id} [req.nf90gj]

#### Modified: `pairExchange(code: string, hostId?: number, newHost?: { label: string; hostname: string }): Promise<{ success: boolean }>`
Add optional hostId and newHost parameters. [req.wnkwb9]

---

### File: `web/src/components/HostForm.tsx` (New file)

Reusable form component for creating/editing hosts. Props:
- `host?: Host` - existing host for edit mode
- `onSubmit: (host: { label: string; hostname: string }) => void`
- `onCancel?: () => void`
- `submitLabel?: string`

Contains inputs for label and hostname with validation. [req.lb8h97]

---

### File: `web/src/pages/HostsPage.tsx` (New file)

Host management page with:
- List of all hosts in a table
- "Add Host" button that shows HostForm inline or in a dialog
- Edit button for each host (inline editing or dialog)
- Delete button for each host with confirmation
- Link back to dashboard

[req.c5coyy] [req.1mxp3p]

---

### File: `web/src/pages/PairPage.tsx`

#### Modified: Component
Add host selection/creation UI before the pair button:
1. Dropdown to select existing host
2. "Create new host" option that shows HostForm inline
3. Require a host to be selected before pairing can proceed
4. Pass host_id or new_host to pairExchange call

[req.wnkwb9] [req.8f1jl1] [req.w8plh3] [req.u3eo8i]

---

### File: `web/src/pages/DashboardPage.tsx`

#### Modified: Component
1. Add "Hosts" button in header nav that links to /hosts [req.ocvhii]
2. Update session display to show host label instead of hostname [req.16szve]
3. Update table columns and mobile cards accordingly

---

### File: `web/src/types/api.ts`

#### Modified: Session interface
Replace `hostname: string` with `host_id: number` and optional `host?: Host`. [req.16szve]

---

### File: `web/src/App.tsx`

#### Modified: Router
Add route for hosts management page: `/hosts` -> HostsPage

---

## Testing

### Unit Tests [req.zvmenj]

**File:** `internal/db/queries_test.go`
- TestCreateHost
- TestGetHostByID
- TestGetHostsByUserID
- TestUpdateHost
- TestDeleteHost
- TestDeleteHostCascadesSessions
- TestGetHostByLabel

**File:** `internal/auth/jwt_test.go`
- TestGenerateTokenWithHostID
- TestValidateTokenWithHostID

**File:** `internal/hosts/handler_test.go`
- TestListHostsHandler
- TestCreateHostHandler
- TestCreateHostDuplicateLabel
- TestUpdateHostHandler
- TestDeleteHostHandler

**File:** `internal/auth/pairing_test.go`
- TestPairExchangeWithExistingHost
- TestPairExchangeWithNewHost
- TestPairExchangeRequiresHost
- TestPairCompleteWithDeletedHost

### Integration Tests [req.egvlji]

**File:** `integration_tests/hosts_test.sh` (or Go integration test)
- Create host, verify in list
- Update host, verify changes
- Delete host, verify sessions deleted
- Full pairing flow with host selection
- Full pairing flow with new host creation
- Session start uses host_id from JWT
- Dashboard displays host info correctly
- Deleted host returns error on API calls
