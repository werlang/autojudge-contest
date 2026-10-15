# Changelog

All notable changes to this repository are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Compare Expected and Received Output** (`autojudgeContest.compareSubmissionOutput`) opens a diff of a submission's expected and received output, from the Contest Explorer and from the verdict notification.
- `autojudgeContest.confirmBeforeSubmit` setting (default `true`) to ask before submitting the active file. Unsaved files are always confirmed before they are saved and submitted.
- Contest status bar item with the time left, your rank, and the number of submissions being judged. Clicking it opens the Contest Overview.
- The contest header in Contest Explorer shows the contest and your team, and opens the Contest Overview when clicked.
- Problem quick pick for **Submit Active File…**, **Open Problem Statement**, and **Export Public Test Cases** when they run without a selection. The problem a file was last submitted to is listed first, and solved problems are left out of the **Submit Active File…** list.
- Verdict notifications with **View Details** and **Compare Output** actions. Submissions still being judged are polled automatically, including after a restart.
- Contest Explorer shows problem letters, a balloon icon that is filled once a problem is solved (a hollow ring until then), attempt counts, a **Judging** label, and how long ago each submission was made. Time-limit and error verdicts have their own icons. A problem expands to show a new submission after you submit it, and a problem with a pending verdict opens expanded.
- Standings show rank numbers, highlight your team, and show a notice while the scoreboard is frozen. Long team names are shortened (the full name is in the tooltip), and teams with no solved problems show `0 solved`.
- Loading and Offline states for both sidebar views. Offline keeps your session and offers **Retry**.
- **Submit Active File…** in the editor title bar for supported source files, and right-click menus on problems, submissions, the contest header, and teams.
- Export asks for a folder when the active file and the workspace do not give one, asks before replacing existing files, and offers **Reveal in Explorer** and **Open First Case** once it finishes.
- Problem pages show each public test case as a numbered Input and Output code block you can copy.
- Submission pages show an inline diff of expected versus your output, followed by the raw outputs. **Compare Expected and Received Output** still opens the side-by-side diff.

### Changed

- Commands use the **AutoJudge Contest** category and new titles: **Log In**, **Log Out**, **Refresh**, **Open Contest Overview**, **Open Problem Statement**, **Submit Active File…**, **Export Public Test Cases**, **Open Submission**, and **Open Team Details**. The **Teams Standings** view is now **Standings**.
- **Log Out** moved to the `…` menu of the sidebar views.
- Team details and submission details open as Markdown pages instead of printing to the output channel. The output channel is now a log with timestamps.
- Generated pages (contest overview, problem, submission, team details, and compare output) are stored in the extension's storage folder. Page names use problem letters, and pages show times in local time.
- Public test cases are numbered from `01` (`<problem>-testcase-01.in`), down from `00`. They go to the active file's folder, else the only workspace folder, else a chosen folder.
- The Standings view refreshes every 15 seconds while it is visible and every 60 seconds while it is hidden. It used to refresh every 15 seconds at all times.
- `autojudgeContest.baseUrl` and `autojudgeContest.webUrl` are read on every use, so changes apply without reloading the window.
- Problems load on their own once the contest starts, so a manual Refresh after the start is no longer needed.
- Submitting to a problem the team has already solved is refused with an info message, before the confirmation. The confirmation says a rejected attempt adds penalty only if the problem is solved later.
- A second submission is refused with an info message while the previous one is still being sent to the judge.
- Pending verdicts share one poll loop: one request per interval covers every pending submission, network errors are retried, and a verdict still pending after 2 minutes is checked again 30 seconds later.
- The submit confirmation is an information dialog rather than a warning.
- When every problem is solved, Submit Active File… says **All problems are solved.** instead of opening a picker.
- Marketplace listing: a new description, `online judge` and `icpc` keywords, a dark gallery banner, and an issue tracker link.

### Fixed

- The status bar countdown was missing after a window reload until the sidebar was opened. The extension now activates on startup, so the saved session restores on its own.
- Standings ranked the slowest team first. Teams are now ranked by solved problems, then by lowest total time, and tied teams share a rank.
- An invalid `autojudgeContest.baseUrl` prevented the extension from activating. Activation now succeeds; the error appears when the server is needed, with an **Open Settings** action.
- Log In checks `autojudgeContest.baseUrl` before the browser opens, so an invalid value is reported without a browser round-trip.
- A server that does not answer within 20 seconds counts as unreachable, so the views show **Offline** with **Retry** instead of loading forever. Solution uploads get 60 seconds and, on timeout, ask you to check Contest Explorer before submitting again.
- `PARSING_ERROR` verdicts show as error verdicts.
- An open submission page now updates itself when the verdict arrives, instead of staying on **Still being judged**.
- The output diff separates its `-` / `+` markers from the line, so negative numbers no longer read as `--1`.
- Names from the server are escaped in generated pages, and Windows reserved file names (such as `CON` or `NUL`) get a `_` suffix so their page files can be written.

## [0.2.0] - 2026-10-14

### Added

- Browser login: **Login Team** opens the AutoJudge website, where you enter your team code and PIN (or confirm an existing browser session), and the browser hands the same team session back to VS Code.
- `autojudgeContest.webUrl` setting (default `https://autojudge.io`) for the website used by the browser login.

### Changed

- **Requires the updated AutoJudge server.** Contest, problem, submission and standings requests use public ids only (`publicId` for contests, problems and teams, `solvedProblemIds` for solved problems). Older servers that send numeric ids are no longer supported.
- A team session lasts the whole contest and is shared with the browser. When it ends (contest over, or the staff reset your PIN), the extension asks you to log in again.
- **Logout Team** only forgets the session on this computer; it does not end the team session.
- Before the contest starts, the explorer shows **Contest has not started yet** and keeps your session; problems load once you refresh after the start.
- Restoring the session or refreshing standings keeps your login on errors other than an ended session, instead of silently logging you out.
- `autojudgeContest.baseUrl` and `autojudgeContest.webUrl` are application-scoped, so a workspace setting cannot redirect the login or the API.
- A browser login that cannot open the browser fails with an error, and a callback that arrives with no login in progress says so.
- The contest dashboard shows **Not started** for a contest without a start time, and the session-ended prompt shows again after a new login.

### Removed

- The team code and PIN prompts inside VS Code, and support for the old six-character team hashes and numeric team ids.

## [0.1.1] - 2026-10-14

### Added

- Added the `Teams Standings` sidebar view with score-sorted teams, a fixed 15-second refresh cycle, and output-channel team detail rendering. (`a8d3fcd`, `0fb0922`)
- Added automatic submission-result polling after a successful submit, backed by the `autojudgeContest.pollIntervalMs` setting. (`a8d3fcd`)
- Added clearer output-channel rendering for submission details. (`a8d3fcd`, `ca8d5c7`, `c1afe0f`)

### Changed

- Problem rows in `Contest Explorer` no longer open the statement on selection; the explicit book action opens the preview while submission rows open directly. (`178a281`, `a8d3fcd`)
- Opening a problem now persists the generated markdown file under `.autojudge-contest/problem-previews/` before opening the preview. (`a8d3fcd`, `20ce45e`)
- Public-case export now writes `.in` and `.out` files beside the active source file instead of using a custom export destination. (`178a281`, `a8d3fcd`, `20ce45e`)
- Reorganized `src/` into command, controller, presentation, provider, service, utility, and workspace folders, removing the unused legacy `src/runner/` files. (`a8d3fcd`)
- Rewrote the README, AGENTS context, and runtime skill guidance to match the current commands, views, settings, and file layout. (`20ce45e`, `e6aff86`)

## [0.1.0] - 2026-05-28

### Added

- Initial AutoJudge Contest extension with team login, logout, and session restore. (`03ba3ff`)
- `Contest Explorer` rendering with contest problems and submission history display. (`03ba3ff`)
- Registered `openProblem`, `submitActiveFile`, `exportPublicCases`, and `openSubmission` commands as placeholders. (`03ba3ff`)
