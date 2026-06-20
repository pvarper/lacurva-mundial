# Spec: Prediction Lock Status

## REQUIREMENTS

### Requirement: Prediction lock MUST consider match status
`isPredictionLocked(match)` MUST return `true` when `match.status !== 'scheduled'`
(i.e. status is `'live'` or `'final'`), regardless of `match.date`.

#### Scenario: Match is live with a future date
- **Given** a match with `status: 'live'` and `date` more than 60 seconds in the future
- **When** `isPredictionLocked(match)` is called
- **Then** it returns `true`

#### Scenario: Match is final with a future date
- **Given** a match with `status: 'final'` and `date` more than 60 seconds in the future
- **When** `isPredictionLocked(match)` is called
- **Then** it returns `true`

### Requirement: Prediction lock MUST preserve existing date-buffer behavior for scheduled matches
When `match.status === 'scheduled'`, `isPredictionLocked(match)` MUST continue to
lock based on the existing 60-second pre-kickoff buffer (`PREDICTION_LOCK_MS`),
unchanged from current behavior.

#### Scenario: Scheduled match with kickoff more than 60 seconds away
- **Given** a match with `status: 'scheduled'` and `date` more than 60 seconds in the future
- **When** `isPredictionLocked(match)` is called
- **Then** it returns `false`

#### Scenario: Scheduled match with kickoff within 60 seconds or in the past
- **Given** a match with `status: 'scheduled'` and `date` within 60 seconds of now or already past
- **When** `isPredictionLocked(match)` is called
- **Then** it returns `true`

### Requirement: Lock result MUST propagate to prediction submission
`POST /api/predictions` MUST return HTTP 423 for any match where
`isPredictionLocked(match)` evaluates to `true`, including matches locked
solely due to `status` being `'live'` or `'final'`.

#### Scenario: Submitting a prediction for a live match
- **Given** a match with `status: 'live'`
- **When** a user submits `POST /api/predictions` for that match
- **Then** the response status is 423

## Constraints

- No changes to call sites consuming `isPredictionLocked`'s boolean return value.
- No frontend files are modified.
- No new fixture status values are introduced; only `scheduled`, `live`, `final` are handled.
