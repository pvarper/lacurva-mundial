# Audit Log Retention Specification

## Purpose

Ensure the audit trail is a durable compliance record by removing the entry cap so historical audit data is never silently discarded.

## Requirements

### Requirement: Unbounded Audit Log Persistence

The system MUST persist all audit log entries written via `recordAuditLog()` to `data/audit-log.json` without any maximum entry count or truncation.

#### Scenario: Log grows past 1000 entries without truncation

- GIVEN the audit log file already contains 1000 or more entries
- WHEN a new action triggers `recordAuditLog()`
- THEN the new entry is appended to the existing entries
- AND no entries from the existing 1000+ are removed or truncated

#### Scenario: Concurrent writes remain safe

- GIVEN two actions trigger `recordAuditLog()` at nearly the same time
- WHEN both writes are processed
- THEN both entries are persisted in `data/audit-log.json`
- AND the existing `writeJson` write-serialization mechanism prevents data loss or corruption

#### Scenario: No slice/cap logic remains in code

- GIVEN the implementation of `recordAuditLog()` in `server.js`
- WHEN the function writes the updated log array
- THEN it MUST NOT call `.slice(-N)` or any equivalent size-limiting operation before calling `writeJson`
