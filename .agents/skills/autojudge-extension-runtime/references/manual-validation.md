# Manual Validation

Use this checklist when a contest-extension runtime change cannot be fully proven with focused Vitest coverage.

## Core Sidebar Smoke Test

1. Launch the extension in an Extension Development Host.
2. Open the `AutoJudge Contest` activity-bar container and confirm the `Contest Explorer` and `Standings` views load. Each shows **Loading the contest…** briefly, then the **Log In with Browser** welcome.
3. In the logged-out state, confirm the views show no Refresh or Log Out buttons in their title bars, and that the welcome action starts the browser login.
4. Run `AutoJudge Contest: Log In`, complete the team login in the browser, confirm the connection, and confirm VS Code returns logged in with the contest header and the status bar item.
5. Inspect the `AutoJudge Contest` output channel. It should be a log with timestamps, with short login or refresh messages that do not expose passwords, tokens, or raw authorization headers.
6. Confirm the Contest Explorer shows the contest header (name, team, time left), problems labeled `A.`, `B.`, … sorted by `order`, and each problem's submissions nested beneath it, newest first.
7. Confirm the Standings view ranks teams by solved problems, then lowest total time, and marks your team with `(you)`.
8. Run `AutoJudge Contest: Refresh` (or the Refresh button in a view title) and confirm both views reload without duplicated nodes or stale state.
9. Run `AutoJudge Contest: Log Out` from the palette and from the `…` menu of each view. Confirm the stored token is cleared on this computer and the views return to the logged-out welcome.

## Failure-Path Checks

1. Cancel the browser login from its progress notification and confirm the extension stays logged out with no partial session. Run Log In again and confirm it works.
2. Open a `vscode://autojudge.autojudge-contest/auth` link with no login in progress and confirm the warning reads `No login in progress. Run Log In again.`
3. Set `autojudgeContest.baseUrl` to an invalid value such as `not a url` and confirm the extension still activates. The error offers **Open Settings** when the extension needs the server. Fix the value and confirm the next action uses it without reloading the window.
4. With a session stored, make the server unreachable (or point `autojudgeContest.baseUrl` at an unreachable host) and reload the window. Confirm both views show **Offline** with a **Retry** link and the stored token is kept. Restore the server and confirm **Retry** loads the contest.
5. Simulate a stored session that the server ended (`401` with `SESSION_ENDED`) during restore. Confirm the saved session is cleared, the views return to the logged-out state, and the session-ended prompt offers **Log In**. Simulate a `400`, or a `401` without `SESSION_ENDED`, and confirm the saved session is kept and the views show **Offline**.
6. Simulate a `403` with `CONTEST_NOT_STARTED` on the problem list during restore. Confirm the explorer shows **Contest has not started yet**, keeps the session, and loads problems after a refresh once the contest starts.
7. Configure a base URL that includes a base path, such as `https://example.com/api`, and confirm contest requests still resolve correctly under that path.

## Explorer Command Checks

1. Confirm problem nodes expand only when they have submissions, and submission nodes appear only beneath their owning problem.
2. Hover a problem and confirm three inline actions appear: the book (Open Problem Statement), the beaker (Export Public Test Cases), and the cloud upload (Submit Active File…). Hover a submission and confirm the compare icon appears only for submissions that include expected or received output.
3. Run `Open Problem Statement` on a problem item and confirm it writes a page under the extension's storage folder (`problem-previews`, not the workspace) and opens it in the Markdown preview. The page is named after the problem, such as `A. <Title>`.
4. Run `Submit Active File…` from a problem item with a saved supported source file open. Confirm the confirmation prompt names the file and the problem, the submission appears under the owning problem with a **Judging** label, the status bar shows the judging count, and the verdict notification offers **View Details** (and **Compare Output** when output exists). Run the same file again and confirm the problem you last submitted it to is listed first in the quick pick.
5. With the file unsaved, confirm the prompt offers **Save and Submit** and that the saved content is what gets judged.
6. Run `Submit Active File…` from the Command Palette and from the editor title button (only for supported extensions). Confirm the palette asks which problem first.
7. Set `autojudgeContest.confirmBeforeSubmit` to `false` and confirm a saved file submits without the prompt. An unsaved file still prompts.
8. Run `Export Public Test Cases` and confirm the folder rule: the active file's folder, else the only workspace folder, else an **Export Here** dialog. Files should be named `<problem title>-testcase-01.in` and `.out`, numbered from `01`. Export again and confirm the **Replace** prompt appears. After export, confirm **Reveal in Explorer** and **Open First Case** work.
9. Run `Open Submission` on a submission item and confirm the page `Submission <id> · <problem>` opens, with the verdict, time or penalty, file, language, judge hint, and expected versus received output when present.
10. Run `Compare Expected and Received Output` on a submission with output and confirm a diff opens between the `expected` and `received` text files in the `submission-output` folder of the storage root.
11. Run `Open Team Details` from a Standings row and confirm a team page opens with rank, solved count, total time, and solved problems. Confirm the output channel is not cleared.
12. Run `Open Contest Overview` from the contest header, from a click on the status bar item, and from the palette. Confirm the page shows phase, start and end, penalty, freeze, and your team's position.
13. Confirm `Open Submission`, `Open Team Details`, and `Compare Expected and Received Output` are not listed in the Command Palette.
14. Confirm no `.autojudge-contest` folder appears in the project after these actions. Generated pages and compare files belong to the storage root.
15. If a future task changes one of these command contracts, update only the affected check while keeping the auth, ordering, and stale-session checks above.

## Standings and Status Bar Checks

1. Confirm showing the Standings view refreshes it at once, and that it keeps refreshing every 15 seconds while visible and every 60 seconds while hidden.
2. Confirm the status bar shows the time left, your rank (`#n`), and `Judging N` while a submission is pending. It hides when logged out, and it is highlighted during the last 15 minutes of a running contest.
3. Confirm a frozen scoreboard shows the **Scoreboard frozen** notice above the teams.

## Manifest Coupling Checks

If the runtime change alters commands, views, menus, or settings, also validate `package.json`, `README.md`, and `CHANGELOG.md` with the `autojudge-manifest-sync` skill so the extension docs stay aligned with the runtime.
