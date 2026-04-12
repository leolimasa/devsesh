# Requirements Review: Hosts Tracking (Updated)

## Summary

The updated requirements address several concerns from the initial review. Most critical issues have been resolved. A few items remain for clarification.

---

## Resolved Issues

- `user_id` added to hosts table
- `created_at` and `updated_at` added
- SSH fields removed (deferred to future work)
- Migration strategy specified (delete all sessions)
- Uniqueness constraint specified (name unique per user)
- One-host-per-JWT behavior explicitly documented
- Deleted host behavior specified (return error, require re-login)

---

## Remaining Questions

### API Endpoints

The requirements still say "Create any endpoints necessary for the host management page." Recommend explicitly listing:

```
GET    /api/v1/hosts          - List all hosts for current user
POST   /api/v1/hosts          - Create a new host
GET    /api/v1/hosts/{id}     - Get a single host
PUT    /api/v1/hosts/{id}     - Update a host
DELETE /api/v1/hosts/{id}     - Delete a host
```

### IP Address Population

How is `ip_addr` populated?
- User-entered manually?
- Auto-detected from the CLI during login?
- Optional field?

### Host Deletion and Existing Sessions

The "No matching hosts" section addresses JWT validation, but what happens to existing sessions when a host is deleted?
- Are sessions with that `host_id` also deleted?
- Is `host_id` set to NULL?
- Is deletion blocked if sessions exist?

### Name vs Hostname Clarification

The table now has both `name` and `hostname`. The distinction could be clearer:
- `name` = user-friendly label (e.g., "Work Laptop")
- `hostname` = actual machine hostname/FQDN/IP

Is this correct? If so, a brief clarification in the requirements would help.

## Minor Suggestions

1. **Testing section** - Consider specifying key test scenarios:
   - Host CRUD operations
   - Pairing with new host creation vs existing host selection
   - Session start with valid/invalid/deleted host_id
   - Dashboard display with host data

2. **Pairing endpoint changes** - The `/api/v1/auth/pair/exchange` endpoint will need to accept a `host_id` parameter. Worth noting in the requirements.

---

## Overall Assessment

The requirements are now clear enough for implementation. The remaining questions are relatively minor and can be resolved during implementation if needed.
