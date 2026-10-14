# Changelog

All notable changes to this repository are documented in this file.

## Unreleased

### Added

- Added the `Teams Standings` sidebar view with score-sorted teams, a fixed 15-second refresh cycle, and output-channel team detail rendering.
- Added automatic submission-result polling after a successful submit, backed by the `autojudgeContest.pollIntervalMs` setting.
- Added clearer output-channel rendering for submission details.

### Changed

- Team login now asks for the team code printed on your team card. The code is trimmed and lowercased before it is sent, and numeric team ids are no longer accepted.
- Contest and problem requests use the server's public ids when available, and fall back to numeric ids for older servers. Submissions and standings keep working with the existing numeric references.
- Problem rows in `Contest Explorer` no longer open the statement on selection; the explicit book action opens the preview while submission rows open directly.
- Opening a problem now persists the generated markdown file under `.autojudge-contest/problem-previews/` before opening the preview.
- Public-case export now writes `.in` and `.out` files beside the active source file instead of using a custom export destination.
- Removed the stale `autojudgeContest.createTestCases` command contribution so the manifest matches the runtime command surface.
- Reorganized `src/` into command, controller, presentation, provider, service, utility, and workspace folders, removing the unused legacy `src/runner/` files.
- Rewrote the README, AGENTS context, and runtime skill guidance to match the current commands, views, settings, and file layout.

### Removed

- Removed the contest-header countdown timer and its continuous tree-provider self-refresh.
