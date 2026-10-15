---
name: autojudge-manifest-sync
description: Use when changing the AutoJudge Contest VS Code extension manifest surface, including views, commands, menus, settings, context keys, or user-facing documentation that must stay synchronized with package.json.
---

# AutoJudge Contest Manifest Sync

Use this skill when a task changes anything exposed through `package.json` or described to users in `README.md`.

## Sync Contract

- Keep the contest activity-bar container, contributed views, commands, menu entries, and setting definitions in `package.json` aligned with the docs in `README.md`.
- Keep `README.md` written as a VS Code extension README (Marketplace-oriented), not as a generic GitHub project README.
- Keep `README.md` focused on extension usage: install, commands, shortcuts, settings, and troubleshooting before development internals.
- Prefer this section order in `README.md`: Features, Install, Quick Start, Commands, Configuration, Troubleshooting, Release Notes.
- Keep the command ids and titles truthful for the current contest workflow: login, logout, refresh, problem actions, submission actions, and any additional views added under the `autojudgeContest` container.
- Commands share the `AutoJudge Contest` category, so the palette shows `AutoJudge Contest: <title>`. Item-only commands (`openSubmission`, `openTeamStanding`, `compareSubmissionOutput`) are hidden from the palette with `commandPalette` entries set to `when: false`; the other palette entries are gated on `autojudgeContest.state`.
- The `autojudgeContest.state` context key takes four values (`loading`, `loggedIn`, `loggedOut`, `offline`; see `VIEW_STATES` in `src/constants.js`). The `viewsWelcome`, view title, and palette `when` clauses gate on them, so a new state must be handled in each of them.
- If a setting changes, update both the contributed setting metadata in `package.json` and the configuration examples in `README.md`. `baseUrl`, `webUrl`, `pollIntervalMs`, and `confirmBeforeSubmit` are all read on use, so changes apply without a reload; `baseUrl` and `webUrl` are `scope: application`.
- Keep docs honest about placeholder versus implemented contest features. Do not describe problem preview, submission, testcase export, or submission detail as complete until the runtime really supports them.
- If a new view or context key is added, document where it appears in the sidebar and what state gates its actions.
- Re-check menu gating when touching `autojudgeContest.state`, `viewItem`, or other live contest context expressions in `package.json`.
- If a user-visible feature changes materially, add a concise entry to `CHANGELOG.md`.
- If README marketing copy or screenshots depend on that feature, keep those assets truthful as well.
- Do not document contest flows that the extension still does not implement.

## Workflow

1. Start from the manifest field that controls the behavior: `viewsContainers`, `views`, `commands`, `menus`, or `configuration`.
2. Make the manifest change in `package.json`.
3. Immediately update `README.md` so view descriptions, command descriptions, settings, screenshots, and behavior text stay truthful and extension-focused.
4. Update `CHANGELOG.md` when the change affects end users.
5. If the manifest change also affects runtime behavior, validate the paired runtime path with the `autojudge-extension-runtime` skill.

## Validation Rules

- Validate that `package.json` remains valid JSON.
- Compare the command titles in `package.json` (`contributes.commands`) with the command list in `README.md`, and confirm the view names in `package.json` match the README (`Contest Explorer`, `Standings`).
- Re-check any `when` clauses, `viewItem` ids, and state/context keys you touched.
- In the Extension Development Host, confirm the command, inline button, or new view appears only where intended.
- If you changed the activity-bar container or multiple sidebar views, confirm the visible order matches the intended contest workflow.
- Report every file that was intentionally kept in sync.