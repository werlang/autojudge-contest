---
name: autojudge-extension-runtime
description: Use when changing AutoJudge Contest VS Code extension runtime behavior, including login/logout flows, session restore, contest tree rendering, problem and submission actions, submission workflows, output-channel rendering, or AutoJudge API error handling.
---

# AutoJudge Contest Extension Runtime

Use this skill when a task changes how the contest extension authenticates a team, restores contest state, renders the sidebar, talks to the AutoJudge contest API, or reports contest and submission results to the user.

## Required Pairing

- Pair runtime work with `docker-vitest-tdd` so behavior changes are driven by focused Vitest coverage inside the Compose `extension` container.
- Pair runtime work with `document-touched-code` so touched commands, controllers, helpers, and tests keep accurate JSDoc and focused explanatory comments.
- Pair skeptical review with `frontend-bug-review-generalized` when the change affects tree items, command wiring, view state, focus, or other user-visible explorer behavior.
- Pair skeptical review with `backend-bug-review-generalized` when the change touches `src/services/contest-api.js`, session restore, auth contracts, polling, persistence, or other HTTP and storage boundaries.

## Ownership And Maintainability Contract

- Keep activation thin in `src/extension.js`; it should assemble the output channel, views, and disposables, not own contest business logic.
- Keep command registration and VS Code prompt glue in `src/commands/contest-commands.js`; move multi-step contest behavior into the controller or focused helpers instead of growing anonymous command bodies.
- Keep authenticated orchestration in `src/controllers/contest-controller.js`, HTTP contract details in `src/services/contest-api.js`, persisted-session rules in `src/services/contest-session.js` and `src/services/session-store.js`, contest-tree shaping in `src/providers/contest-tree-provider.js`, standings rendering in `src/providers/teams-tree-provider.js`, and formatting-only helpers in `src/presentation/contest-presentation.js` plus `src/utils/`.
- Preserve clear object ownership. Prefer a small class or helper only when it owns long-lived state, repeated transformation logic, or a stable extension boundary; avoid scattering one-off helpers that only rename a few lines.
- When adding a new explorer behavior, keep the tree item model, the command handler, and the controller transition readable as separate responsibilities.
- Reuse `normalizeBaseUrl()` from `src/services/contest-api.js` instead of rebuilding base-path logic in commands, controllers, or tests.
- Keep user-facing output concise in the `AutoJudge Contest` output channel and VS Code notifications.

## Runtime Contract

- Preserve the current command surface unless the task explicitly changes the manifest: `autojudgeContest.loginTeam`, `autojudgeContest.logoutTeam`, `autojudgeContest.refreshTree`, `autojudgeContest.openProblem`, `autojudgeContest.submitActiveFile`, `autojudgeContest.exportPublicCases`, `autojudgeContest.openSubmission`, and `autojudgeContest.openTeamStanding`.
- Preserve the login flow shape unless intentionally changing it: prompt for team code first, then prompt for password.
- Successful login must continue to store the returned token in VS Code secrets and persist the team id in global state.
- Refresh and session restore must continue to load the current team, contest details, problems, and submissions through the contest-session path instead of duplicating fetch logic elsewhere.
- If session restore receives `400` or `401`, clear the stored session and return the tree to the logged-out state.
- Preserve current interaction rules unless the task intentionally changes them: problem rows open only through the explicit action, submission rows open directly on selection, problems stay sorted by `order`, submissions stay sorted newest-first, and standings stay sorted by score descending.
- Keep post-submit polling routed through the controller and contest-session layers so `autojudgeContest.pollIntervalMs` remains the only user-configurable verdict polling interval.
- Keep the teams standings refresh cadence fixed at 15 seconds unless the manifest and docs are intentionally expanded to expose a new setting.
- Treat placeholder commands honestly until they are implemented. Do not update docs or menus to imply functionality that runtime code still does not provide.

## Security And Correctness Review Checklist

- Never log tokens, passwords, or raw secret-bearing request headers to the output channel, notifications, tests, or thrown error messages.
- Keep token persistence inside `src/session-store.js` and related session helpers. Do not add alternate secret caches in tree items, globals, temp files, or command closures.
- Treat AutoJudge API strings as untrusted input. Render them as text only; do not turn them into shell commands, file-system writes, or command ids without explicit validation.
- Guard commands against missing or stale contest state. A tree-item action should fail clearly when the session expired, the expected problem or submission no longer exists, or the active editor is unavailable.
- Keep auth and session cleanup symmetric: a failed restore, logout, or invalid token path must not leave stale logged-in context keys behind.
- Preserve explicit error mapping for network and auth failures so users see concise messages while the output channel retains enough detail for debugging.

## Implementation Workflow

1. Identify the controlling owner before editing: activation, command glue, controller orchestration, API helper, session persistence, or tree provider.
2. Add or update the narrowest Vitest coverage first when the behavior can be exercised outside the Extension Development Host.
3. Make the smallest runtime edit that fixes the root cause or adds the requested behavior without collapsing extension boundaries.
4. Update touched JSDoc and add focused comments where the ordering, state transition, or edge-case handling would otherwise be expensive to re-derive.
5. Run the skeptical review checklist above against auth, stale state, user-facing errors, ordering, and API-contract handling in the touched slice.
6. If the user-facing contract changed, update docs or manifest files that describe that behavior.

## Validation Rules

- Prefer a narrow executable check for the touched slice, then run `docker compose exec extension npm test` for the wider repository pass.
- When the change touches view wiring, command enablement, tree expansion, or VS Code-only interactions, run a manual smoke test in the Extension Development Host after the container test pass.
- Verify both the happy path and the nearest failure path for auth, refresh, or submission workflows.
- State any remaining manual validation gaps explicitly, especially for explorer interactions that Vitest cannot prove end-to-end.