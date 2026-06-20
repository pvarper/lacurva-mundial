# Audit Log Date Filtering Specification

## Purpose

Let the audit log endpoint and bitácora view scope results to a single Bolivia-local calendar day by default, reducing payload size and avoiding full-history client-side filtering on every load.

## Requirements

### Requirement: Server-Side Date Query Parameter

`GET /api/audit-log` MUST accept an optional `date` query parameter in `YYYY-MM-DD` format, interpreted as a calendar day in the `America/La_Paz` timezone.

#### Scenario: Filtering by an explicit date

- GIVEN the audit log contains entries from multiple calendar days (Bolivia time)
- WHEN a request is made to `GET /api/audit-log?date=2026-06-19`
- THEN the response MUST contain only entries whose `timestamp`, converted to `America/La_Paz`, falls on `2026-06-19`
- AND entries from other days MUST be excluded

#### Scenario: Omitting the date parameter returns full history

- GIVEN the audit log contains entries spanning many days
- WHEN a request is made to `GET /api/audit-log` with no `date` parameter
- THEN the response MUST contain all entries, unfiltered by date
- AND this supports an admin explicitly clearing the date filter to view full history

#### Scenario: Entries near day boundary respect Bolivia timezone, not UTC

- GIVEN an entry with a UTC timestamp that falls on a different calendar date in UTC than in `America/La_Paz`
- WHEN a request is made with `date` set to the Bolivia-local date of that entry
- THEN that entry MUST be included in the filtered results

### Requirement: Bitácora Default Date On Load

The frontend bitácora view MUST request today's entries (Bolivia time) by default when the view loads, without requiring the admin to manually pick a date first.

#### Scenario: Loading bitácora view with no prior date selection

- GIVEN an admin navigates to the bitácora view for the first time in a session
- WHEN `loadAuditLog()` is called
- THEN it MUST request `GET /api/audit-log?date=<todayBoliviaDate()>`
- AND the date filter input MUST be pre-populated with today's date (Bolivia time)

#### Scenario: Admin selects a different date

- GIVEN the bitácora view is showing today's entries by default
- WHEN the admin changes the date filter UI to a past date
- THEN `loadAuditLog()` MUST request `GET /api/audit-log?date=<selected-date>`
- AND the response MUST reflect only that day's entries

### Requirement: Client-Side Filters Remain Independent of Date

Existing client-side `username`/`action` filters in `filteredAuditLogs()` MUST continue to operate on top of the server-filtered day's entries, without re-implementing date filtering client-side.

#### Scenario: Username filter applied after server-side date filter

- GIVEN the server has returned entries for the selected date
- WHEN the admin types a username into the existing username filter
- THEN the displayed list MUST narrow to entries matching that username within the already date-filtered set

#### Scenario: Date filtering logic removed from filteredAuditLogs

- GIVEN the implementation of `filteredAuditLogs()` in `public/js/app.js`
- WHEN it filters the in-memory audit log array
- THEN it MUST NOT independently re-check or re-filter by date, since the server already scoped the data to the selected day
