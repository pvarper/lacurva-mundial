# Audit Log Sync Noise Suppression Specification

## Purpose

Keep the audit trail focused on admin/user actions by excluding automated World Cup fixture sync events, which currently flood the bitácora with repeated, low-value entries.

## Requirements

### Requirement: Fixture Sync Events Excluded From Audit Log

The World Cup fixture sync job (`lib/worldcup-sync.js`) MUST NOT call `recordAuditLog()` for `fixture_synced` or `fixture_sync_unmatched` actions.

#### Scenario: Successful fixture sync does not write audit entry

- GIVEN the sync job successfully matches and updates a fixture
- WHEN `applyFixtureSync` completes processing that fixture
- THEN no `fixture_synced` entry MUST appear in `data/audit-log.json`

#### Scenario: Unmatched fixture sync does not write audit entry

- GIVEN the sync job encounters a fixture it cannot match
- WHEN `recordUnmatched` processes that fixture
- THEN no `fixture_sync_unmatched` entry MUST appear in `data/audit-log.json`
- AND the existing `console.warn` operator-visibility logging MUST remain unchanged

#### Scenario: Repeated identical syncs still produce no audit noise

- GIVEN the sync job polls and detects what it considers a change on the same fixture multiple times in a row (regardless of whether the underlying dedup bug has been fixed)
- WHEN each poll triggers `applyFixtureSync` or `recordUnmatched`
- THEN none of those polls MUST write any audit log entry
- AND this scenario explicitly does NOT require fixing the underlying "unchanged" dedup bug in `applyFixtureSync` — that bug is out of scope for this change

#### Scenario: Admin and user actions still recorded normally

- GIVEN a user submits a prediction or an admin edits a user
- WHEN the corresponding handler calls `recordAuditLog()`
- THEN that entry MUST be persisted as before, unaffected by the sync-noise suppression change
