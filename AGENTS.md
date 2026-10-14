# AGENTS.md

## Project Scope

- This repository is a VS Code extension for browsing AutoJudge contest data with team credentials.
- The implemented runtime currently covers team login, logout, session restore, contest explorer rendering, formatted submission-detail output, persisted problem previews, active-file submission with verdict polling, public testcase export, teams standings refresh, and team-detail output.
- The sidebar surface includes `Contest Explorer` and `Teams Standings` under the same `AutoJudge Contest` activity-bar container.
- Keep changes focused on the extension, its docs, and its agent customizations. Do not add unrelated app or backend patterns.

## Key Files

- [package.json](package.json): extension manifest, `Contest Explorer` and `Teams Standings` views, contributed commands and menus, and the `autojudgeContest.baseUrl` and `autojudgeContest.pollIntervalMs` settings.
- [src/extension.js](src/extension.js): activation entrypoint that creates the `AutoJudge Contest` output channel, both sidebar views, and the command registrations.
- [src/constants.js](src/constants.js): shared view ids, command ids, and tree context values used by the manifest and runtime.
- [src/commands/contest-commands.js](src/commands/contest-commands.js): command wiring, login prompt flow, base URL resolution, polling-interval resolution, and controller-backed registrations.
- [src/controllers/contest-controller.js](src/controllers/contest-controller.js): login, logout, refresh, error handling, persisted problem preview generation, submission-detail rendering, submission polling, public-case export, standings output, and shared snapshot orchestration.
- [src/presentation/contest-presentation.js](src/presentation/contest-presentation.js): problem preview and submission formatting helpers.
- [src/providers/contest-tree-provider.js](src/providers/contest-tree-provider.js): visible contest explorer structure and submission click behavior.
- [src/providers/teams-tree-provider.js](src/providers/teams-tree-provider.js): score-sorted team standings rows and output-opening commands.
- [src/services/contest-api.js](src/services/contest-api.js): AutoJudge contest HTTP contract for team login, current-team lookup, contest details, contest problems, submissions, and solution upload.
- [src/services/contest-session.js](src/services/contest-session.js): session persistence, snapshot loading, standings refresh, and submission-result polling.
- [src/services/session-store.js](src/services/session-store.js): VS Code secrets and global-state storage for the team session.
- [src/workspace/contest-public-cases.js](src/workspace/contest-public-cases.js): public testcase extraction helpers for contest problems.
- [src/workspace/contest-submission-workspace.js](src/workspace/contest-submission-workspace.js): active-file validation plus testcase export file-system workflows.
- [src/utils/config.js](src/utils/config.js), [src/utils/public-id.js](src/utils/public-id.js), [src/utils/standings.js](src/utils/standings.js), [src/utils/submission-status.js](src/utils/submission-status.js): shared extension configuration, public-id route and identity helpers, standings, and submission-state helpers.
- [tests/activation.test.js](tests/activation.test.js), [tests/contest-controller.test.js](tests/contest-controller.test.js), [tests/contest-public-cases.test.js](tests/contest-public-cases.test.js), [tests/contest-session.test.js](tests/contest-session.test.js), [tests/contest-submission-workspace.test.js](tests/contest-submission-workspace.test.js), [tests/contest-tree-provider.test.js](tests/contest-tree-provider.test.js), [tests/session-store.test.js](tests/session-store.test.js), [tests/teams-standings-provider.test.js](tests/teams-standings-provider.test.js): current coverage for activation, controller flow, testcase extraction, session persistence, explorer rendering, workspace file flows, and teams-standings behavior.
- [README.md](README.md): user-facing extension behavior and current command status.

## Project Skills

- `.agents/skills/autojudge-extension-runtime/`: use for contest runtime changes to command behavior, session restore, explorer and submission actions, output-channel messaging, API interactions, refresh behavior, or future submission polling. Pair it with the repository `docker-vitest-tdd` skill plus the global `document-touched-code` and skeptical review skills so extension changes stay maintainable, documented, and security-reviewed.
- `.agents/skills/autojudge-manifest-sync/`: use for changes to commands, views, menus, settings, context-key gating, and user-facing docs that must stay aligned with `package.json`.
- `.agents/skills/docker-container-development/`: use when repository commands should run through the Compose development container instead of the host machine.
- `.agents/skills/docker-vitest-tdd/`: use when a runtime change should be driven by Vitest coverage inside the Compose environment.
- Global skill `document-touched-code`: use by default when touching runtime code or tests so JSDoc and focused comments stay aligned with the changed behavior.
- Global skill `refactor-feature-additions`: use for maintainable feature or refactor work that should leave behind tests, documentation, and explicit validation.
- Global skills `frontend-bug-review-generalized` and `backend-bug-review-generalized`: use for skeptical correctness and vulnerability review of VS Code extension runtime work, choosing the review surface based on whether the risk is explorer or UI facing or API, auth, or storage facing.

## Working Conventions

- Use modern ESM-style JavaScript consistent with the existing `import` and named export pattern.
- Preserve the current ownership boundaries: activation in [src/extension.js](src/extension.js), command registration in [src/commands/contest-commands.js](src/commands/contest-commands.js), controller flow in [src/controllers/contest-controller.js](src/controllers/contest-controller.js), presentation helpers in [src/presentation/contest-presentation.js](src/presentation/contest-presentation.js), providers in [src/providers/contest-tree-provider.js](src/providers/contest-tree-provider.js) and [src/providers/teams-tree-provider.js](src/providers/teams-tree-provider.js), remote API helpers in [src/services/contest-api.js](src/services/contest-api.js), session persistence in [src/services/contest-session.js](src/services/contest-session.js) and [src/services/session-store.js](src/services/session-store.js), testcase/workspace helpers in [src/workspace/contest-public-cases.js](src/workspace/contest-public-cases.js) and [src/workspace/contest-submission-workspace.js](src/workspace/contest-submission-workspace.js), and neutral shared helpers in [src/utils/](src/utils).
- Prefer maintainable OOP-friendly structure: keep VS Code registration and prompt glue thin, move stateful contest behavior into the controller or focused helpers, and only introduce new classes when they own a clear long-lived responsibility.
- If you change a contributed command, menu item, view, or setting, update [package.json](package.json), [README.md](README.md), and any user-facing [CHANGELOG.md](CHANGELOG.md) entry that describes the change.
- Treat [README.md](README.md) as a VS Code extension README, not a generic library README. Keep the wording centered on extension usage and current capabilities.
- Keep output user-facing and concise in the `AutoJudge Contest` output channel and VS Code notifications.
- Start the development environment with `docker compose up -d --build` and run repository commands inside the `extension` service.
- Do not run `node`, `npm`, `npx`, or `vitest` directly on the host; use `docker compose exec extension ...` instead.
- When a task changes runtime behavior, add or update focused Vitest coverage when practical and validate with `docker compose exec extension npm test`.
- Never log passwords, bearer tokens, or other secret material to the output channel, notifications, tests, or persisted files.

## Runtime Behavior To Preserve

- The contributed commands are `autojudgeContest.loginTeam`, `autojudgeContest.logoutTeam`, `autojudgeContest.refreshTree`, `autojudgeContest.openProblem`, `autojudgeContest.submitActiveFile`, `autojudgeContest.exportPublicCases`, `autojudgeContest.openSubmission`, and `autojudgeContest.openTeamStanding`.
- Login prompts for a 13-character team code, validated in the input box, and then a password.
- Successful login stores the returned token in VS Code secrets and stores the team id in global state.
- Refresh attempts to restore the stored session, loads the current team, contest details, contest problems, and submissions, and updates both sidebar views.
- If session restore receives `400` or `401`, the stored session is cleared and the view returns to the logged-out state.
- Both views show a login action when logged out. When logged in, `Contest Explorer` shows a highlighted contest header plus problems sorted by `order`, with only that problem's submissions nested newest-first, and `Teams Standings` shows teams sorted by score.
- Problem rows do not open on selection. The explicit book action writes a markdown preview file under `.autojudge-contest/problem-previews` and opens it, while submission rows open the formatted submission output directly on selection.
- Submitting the active file works from explorer problem actions, immediately merges the optimistic submission into the in-memory snapshot, then polls until a final result arrives or times out.
- Opening a team in `Teams Standings` clears the `AutoJudge Contest` output channel and prints the team's score plus solved problem names.
- `Teams Standings` refreshes on a fixed 15-second interval through the controller's contest-details refresh path.
- Exporting public cases operates on the selected contest problem and always writes beside the active source file.
- The configured API base URL must support optional base paths; reuse [src/services/contest-api.js](src/services/contest-api.js) normalization instead of rebuilding URLs elsewhere.

## Validation

- Run automated checks through the Compose container. The default test command is `docker compose exec extension npm test`.
- For manifest and docs changes, verify that [package.json](package.json), [README.md](README.md), and [CHANGELOG.md](CHANGELOG.md) stay in sync.
- For behavior changes, favor manual validation in the Extension Development Host using both `Contest Explorer` and `Teams Standings`, including login, refresh, logout, explicit problem preview, submission-detail opening, submit-plus-poll, testcase export, and team-detail output.
- Pair tree, controller, standings-provider, or testcase-workspace changes with focused Vitest coverage when the touched code can be exercised outside VS Code.

## Pitfalls

- Do not assume the public site URL and API URL are the same; the extension targets the API base URL configured by `autojudgeContest.baseUrl`.
- The login flow uses `POST teams/{teamId}/login` with the password in the `Authorization: Bearer ...` header, then restores the contest snapshot with `GET teams`, `GET contests/{contestId}/problems`, and `GET submissions` before later submission actions reuse the stored contest token.
- `autojudgeContest.pollIntervalMs` is only for post-submit verdict polling; the standings refresh cadence stays fixed at 15 seconds.
- Public-case export ignores `autojudge.testcasePath` and writes beside the active source file.