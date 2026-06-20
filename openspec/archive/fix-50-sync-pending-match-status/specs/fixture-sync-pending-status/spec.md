# Fixture Sync Pending Status Specification

## Purpose

Ensure fixtures whose computed status is `scheduled` (not yet started) never carry a non-null score, so the frontend's existing `homeScore !== null` display convention correctly shows "Pendiente" instead of a misleading "0 - 0".

## Requirements

### Requirement: Scheduled Fixtures Persist Null Scores

`applyFixtureSync()` in `lib/worldcup-sync.js` MUST force `homeScore` and `awayScore` to `null` whenever the computed `status` for that sync pass is `scheduled`, before the unchanged-check and before writing to `data/fixtures.json`.

#### Scenario: Provider sends placeholder score for not-yet-started match

- GIVEN a fixture whose provider record has `time_elapsed: "notstarted"` (computed `status === 'scheduled'`)
- AND the provider's raw score fields parse to `0`/`0` via `parseScore()`
- WHEN `applyFixtureSync()` processes that fixture
- THEN the fixture's persisted `homeScore` and `awayScore` in `data/fixtures.json` MUST both be `null`
- AND no `0 - 0` score MUST be written for that fixture

#### Scenario: Unchanged-check still short-circuits correctly for scheduled fixtures

- GIVEN a fixture already persisted with `status: "scheduled"`, `homeScore: null`, `awayScore: null`
- WHEN a subsequent sync cycle computes the same `status: "scheduled"` for that fixture
- THEN `applyFixtureSync()` MUST treat the fixture as unchanged
- AND MUST NOT perform a write to `data/fixtures.json`

#### Scenario: Scheduled-to-live transition still flows real scores through

- GIVEN a fixture currently persisted with `status: "scheduled"`, `homeScore: null`, `awayScore: null`
- WHEN the provider reports a non-`notstarted` status (e.g. live or final) with real numeric scores
- THEN `applyFixtureSync()` MUST persist the computed non-`scheduled` status
- AND MUST persist the real `homeScore`/`awayScore` values unmodified by the scheduled-null guard

#### Scenario: Guard does not affect non-scheduled statuses

- GIVEN a fixture whose computed `status` is `live` or `final`
- WHEN `applyFixtureSync()` processes that fixture
- THEN the scheduled-null guard MUST NOT alter the `homeScore`/`awayScore` values computed by `parseScore()`

### Requirement: Existing Scheduled Fixtures With Polluted Scores Are Backfilled

`data/fixtures.json` MUST NOT contain any fixture with `status: "scheduled"` and a non-null `homeScore` or `awayScore` after this change is applied.

#### Scenario: Known polluted fixtures corrected

- GIVEN fixtures `m-033` and `m-034` exist in `data/fixtures.json` with `status: "scheduled"` and non-null `homeScore`/`awayScore`
- WHEN the one-time backfill is applied
- THEN `m-033` and `m-034` MUST have `homeScore: null` and `awayScore: null`
- AND all other fields on those fixture records MUST remain unchanged

#### Scenario: Frontend renders backfilled fixtures as pending

- GIVEN `m-033` and `m-034` have `homeScore: null` and `awayScore: null` with `status: "scheduled"`
- WHEN the frontend (`public/js/app.js`) renders these fixtures
- THEN it MUST display "Pendiente" for both, using its existing `homeScore !== null` convention
- AND no frontend code change is required to achieve this
