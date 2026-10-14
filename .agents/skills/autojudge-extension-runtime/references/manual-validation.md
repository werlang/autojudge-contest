# Manual Validation

Use this checklist when a contest-extension runtime change cannot be fully proven with focused Vitest coverage.

## Core Sidebar Smoke Test

1. Launch the extension in an Extension Development Host.
2. Open the `AutoJudge Contest` activity-bar container and confirm the `Contest Explorer` view loads.
3. In the logged-out state, confirm the view shows the `Login Team` welcome action and the view title also exposes the same login command.
4. Run `AutoJudge Contest: Login Team`, enter a valid team code plus password, and confirm the login completes.
5. Inspect the `AutoJudge Contest` output channel and confirm login or refresh messages are helpful but do not expose passwords, tokens, or raw authorization headers.
6. Confirm the logged-in tree shows the contest header, problems sorted by `order`, and each problem's submissions nested beneath that problem and sorted newest-first.
7. Run `AutoJudge Contest: Refresh Contest Tree` and confirm the current snapshot reloads cleanly without duplicating nodes or leaving stale state behind.
8. Run `AutoJudge Contest: Logout Team` and confirm the stored session is cleared and the tree returns to the logged-out state.

## Failure-Path Checks

1. Cancel either login prompt and confirm the extension stays logged out and does not persist a partial session.
2. Point `autojudgeContest.baseUrl` at an invalid, unreachable, or unauthorized API and confirm the error is concise for the user while the output channel still avoids secret leakage.
3. Simulate an expired or invalid stored session that returns `400` or `401` during restore and confirm the extension clears the saved session and resets the tree to the logged-out state.
4. Configure a base URL that includes a base path, such as `https://example.com/api`, and confirm contest requests still resolve correctly under that path.

## Explorer Command Checks

1. Confirm problem nodes remain collapsible and submission nodes only appear beneath their owning problem.
2. Confirm problem actions stay attached to problem items and submission actions stay attached to submission items.
3. Run `Open Problem` on a problem item and confirm it writes a generated preview under `.autojudge-contest/problem-previews` and opens the clicked problem in Markdown preview.
4. Run `Submit Active File` from a problem item with a saved supported source file open and confirm the submission succeeds, both sidebar views refresh promptly, and the new submission appears under the owning problem newest-first.
5. Run `Export Public Cases` on a problem item and confirm the extension writes the selected problem's public `.in` and `.out` files through the maintained testcase-workspace flow.
6. Run `Open Submission Result` on a submission item and confirm the `AutoJudge Contest` output channel is cleared and repopulated with the formatted clicked submission details.
7. If a future task changes one of these command contracts, update only the affected check while keeping the auth, ordering, and stale-session checks above.

## Manifest Coupling Checks

If the runtime change alters commands, views, menus, or settings, also validate `package.json`, `README.md`, and `CHANGELOG.md` with the `autojudge-manifest-sync` skill so the extension docs stay aligned with the runtime.