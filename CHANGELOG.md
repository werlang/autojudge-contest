# Changelog

All notable changes to this repository are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-14

### Added

- Browser login: **Login Team** opens the AutoJudge website, where you enter your team code and PIN (or confirm an existing browser session), and the browser hands the same team session back to VS Code.
- `autojudgeContest.webUrl` setting (default `https://autojudge.io`) for the website used by the browser login.

### Changed

- **Requires the updated AutoJudge server.** Contest, problem, submission and standings requests use public ids only (`publicId` for contests, problems and teams, `solvedProblemIds` for solved problems). Older servers that send numeric ids are no longer supported.
- A team session lasts the whole contest and is shared with the browser. When it ends (contest over, or the staff reset your PIN), the extension asks you to log in again.
- **Logout Team** only forgets the session on this computer; it does not end the team session.

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
