import * as vscode from 'vscode';
import { formatSubmissionStatus } from '../presentation/contest-presentation.js';
import { COMMANDS, TREE_CONTEXT } from '../constants.js';
import { resolveRouteId, sameEntity } from '../utils/public-id.js';
import {
    getContestTiming,
    getProblemLetter,
    getProblemTitle,
    sortProblems,
    summarizeProblemSubmissions,
} from '../utils/contest-progress.js';
import {
    formatDuration,
    formatLocalDateTime,
    formatMinutes,
    formatRelativeTime,
} from '../utils/time-format.js';
import {
    hasComparableOutput,
    isErrorSubmission,
    isFailedSubmission,
    isPassedSubmission,
    isPendingSubmission,
    isTimeLimitSubmission
} from '../utils/submission-status.js';

const SOLVED_MARK = '✓';
const JUDGING_LABEL = 'Judging…';
// Mid grey reads against both light and dark sidebar backgrounds.
const ICON_OUTLINE = '#808080';
// Neutral fill/ring used when a problem has no valid balloon colour.
const ICON_FALLBACK_COLOR = '#8b8b8b';

/**
 * Provide the contest explorer tree for logged-in contest snapshots: a contest
 * header (contest and team name), then one row per problem (letter, title, a
 * balloon icon that is filled once solved, and a short state) with that
 * problem's submissions nested newest-first.
 */
export class ContestTreeProvider {
    /**
     * @param {{ now?: () => number }} [options] `now` is injectable for tests.
     */
    constructor(options = {}) {
        this.listeners = new Set();
        this.snapshot = null;
        this.state = 'loggedOut';
        this.now = options.now ?? Date.now;
        this.unsolvedOnly = false;
        // Last built items by id, and each nested item's parent, so `getParent`
        // and `findSubmissionItem` work although items are rebuilt per render.
        this.itemsById = new Map();
        this.parentsById = new Map();
    }

    /**
     * Subscribe to tree refresh events.
     * @param {(item?: unknown) => void} listener
     * @returns {{ dispose: () => void }}
     */
    onDidChangeTreeData(listener) {
        this.listeners.add(listener);

        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    /**
     * Refresh the full tree (also re-renders relative times and the timing tooltip)
     * and optionally update the visible state label.
     * @param {'loggedIn' | 'loggedOut'} [state]
     */
    refresh(state) {
        if (state) {
            this.state = state;
        }

        for (const listener of this.listeners) {
            listener(undefined);
        }
    }

    /**
     * Replace the visible contest snapshot and refresh the tree.
     * @param {{ problems: object[], submissions: object[], team: object, contest: object, contestNotStarted?: boolean } | null} snapshot
     */
    setSnapshot(snapshot) {
        this.snapshot = snapshot;
        this.state = snapshot ? 'loggedIn' : 'loggedOut';
        this.itemsById.clear();
        this.parentsById.clear();
        this.refresh();
    }

    /**
     * Show only unsolved problems, or all of them, and re-render the tree.
     * @param {boolean} unsolvedOnly
     */
    setUnsolvedOnly(unsolvedOnly) {
        this.unsolvedOnly = Boolean(unsolvedOnly);
        this.refresh();
    }

    /**
     * Dispose the tree provider.
     */
    dispose() {}

    /**
     * Return the currently rendered contest snapshot.
     * @returns {object | null}
     */
    getSnapshot() {
        return this.snapshot;
    }

    /**
     * Create the balloon-colour icon that doubles as the problem's solved signal:
     * a filled dot when solved, a hollow ring (transparent centre) when not.
     * Both carry a thin semi-transparent neutral outline so very light or very
     * dark balloon colours (e.g. `#f0f0f0`) still read on light and dark themes.
     * The dot (12 px) and the ring (9 px across, 2 px stroke) differ in both
     * fill and size so the two states are distinct at 16 px. A missing or
     * invalid hex color (valid: 3, 4, 6 or 8 digits) falls back to a visible
     * neutral grey (`ICON_FALLBACK_COLOR`) for the fill and the ring, so the solved state never disappears.
     * @param {string | undefined | null} hexColor
     * @param {boolean} [solved=false]
     * @returns {import('vscode').Uri}
     */
    createColoredCircleIcon(hexColor, solved = false) {
        const color = typeof hexColor === 'string' && /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hexColor.trim())
            ? (hexColor.trim().startsWith('#') ? hexColor.trim() : `#${hexColor.trim()}`)
            : ICON_FALLBACK_COLOR;
        const shape = solved
            ? `<circle cx="8" cy="8" r="5.5" fill="${color}" stroke="${ICON_OUTLINE}" stroke-opacity="0.6" stroke-width="1" />`
            : `<circle cx="8" cy="8" r="4.5" fill="none" stroke="${color}" stroke-width="2" />`
                + `<circle cx="8" cy="8" r="5.75" fill="none" stroke="${ICON_OUTLINE}" stroke-opacity="0.5" stroke-width="0.5" />`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">${shape}</svg>`;

        return vscode.Uri.parse(
            `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
        );
    }

    /**
     * Return the visible children for a given tree node.
     * @param {Record<string, unknown> | undefined} element
     * @returns {Array<Record<string, unknown>>}
     */
    getChildren(element) {
        if (element?.children) {
            return element.children;
        }

        if (element || !this.snapshot || this.state === 'loggedOut') {
            return [];
        }

        const now = this.now();
        const header = buildContestHeaderItem(this.snapshot, now);

        if (this.snapshot.contestNotStarted) {
            // The flag is sticky: once the clock says the contest began, the problems
            // just have not been reloaded yet, so say that instead of "not started".
            const contest = this.snapshot.contest ?? this.snapshot.team?.contest ?? null;
            const started = getContestTiming(contest, now).phase !== 'notStarted';
            return [header, buildNotStartedItem(started)];
        }

        const problems = sortProblems(this.snapshot.problems);
        const submissions = Array.isArray(this.snapshot.submissions) ? this.snapshot.submissions : [];
        const allProblemItems = problems.map(problem => this.buildProblemItem(problem, problems, submissions, now));
        const problemItems = this.unsolvedOnly
            ? allProblemItems.filter(item => !item.solved)
            : allProblemItems;

        // Only shown rows are indexed, so a reveal never targets a hidden problem.
        this.indexItems(problemItems);
        if (!problemItems.length && allProblemItems.length) {
            return [header, buildAllSolvedItem()];
        }
        return [header, ...problemItems];
    }

    /**
     * Replace the id index with the given problem rows and their submissions.
     * Items without an id cannot be revealed, so they are skipped.
     * @param {Array<Record<string, unknown>>} problemItems
     */
    indexItems(problemItems) {
        this.itemsById.clear();
        this.parentsById.clear();

        for (const problemItem of problemItems) {
            if (problemItem.id) {
                this.itemsById.set(problemItem.id, problemItem);
            }

            for (const child of problemItem.children ?? []) {
                if (child.id) {
                    this.itemsById.set(child.id, child);
                    this.parentsById.set(child.id, problemItem);
                }
            }
        }
    }

    /**
     * Return a node's parent, as `TreeView.reveal` requires: a submission row
     * belongs to its problem row; problem, contest, and note rows are roots.
     * @param {Record<string, unknown>} element
     * @returns {Record<string, unknown> | undefined}
     */
    getParent(element) {
        return element?.id ? this.parentsById.get(element.id) : undefined;
    }

    /**
     * Find the current tree item of a submission so it can be passed to
     * `TreeView.reveal`. The index is filled by `getChildren`; when the
     * submission is not indexed yet (e.g. the snapshot just changed and the
     * view has not re-rendered) this rebuilds the root rows via `getChildren()`
     * and looks again. Returns `undefined` when the submission is not shown.
     * @param {string | number} submissionId
     * @returns {Record<string, unknown> | undefined}
     */
    findSubmissionItem(submissionId) {
        const id = `submission:${submissionId}`;

        if (!this.itemsById.has(id)) {
            this.getChildren();
        }

        return this.itemsById.get(id);
    }

    /**
     * Build one problem row with its submissions as children. The icon carries
     * the solved state, the description at most one short fact, and the
     * tooltip the full detail.
     * @param {object} problem
     * @param {object[]} problems all contest problems, already sorted
     * @param {object[]} submissions the team's submissions
     * @param {number} now
     * @returns {Record<string, unknown>}
     */
    buildProblemItem(problem, problems, submissions, now) {
        const letter = getProblemLetter(problem, problems);
        const title = getProblemTitle(problem, letter);
        const summary = summarizeProblemSubmissions(problem, submissions);
        const children = submissions
            .filter(submission => sameEntity(submission?.problem, problem))
            .sort((left, right) => toTime(right.submittedAt) - toTime(left.submittedAt))
            .map(submission => buildSubmissionItem(submission, now));
        const publicId = resolveRouteId(problem);
        const label = letter ? `${letter}. ${title}` : title;
        const description = buildProblemDescription(summary);

        return {
            id: publicId ? `problem:${publicId}` : undefined,
            label,
            description,
            // The solved state is only drawn in the icon, so announce it to screen readers.
            accessibilityInformation: {
                label: [label, summary.solved ? 'solved' : 'not solved', description].filter(Boolean).join(', '),
            },
            tooltip: buildProblemTooltip(letter, title, summary),
            collapsibleState: resolveProblemCollapsibleState(summary, children.length),
            contextValue: TREE_CONTEXT.PROBLEM,
            iconPath: this.createColoredCircleIcon(problem?.color, summary.solved),
            children,
            problem,
            solved: summary.solved,
        };
    }

    /**
     * Return the TreeItem-compatible shape for a node.
     * @param {Record<string, unknown>} element
     * @returns {Record<string, unknown>}
     */
    getTreeItem(element) {
        return element;
    }
}

/**
 * Build the contest header row: the contest name with the team name as its
 * description. Timing and rank live in the status bar, so the row stays short;
 * the tooltip still carries timing, team, and local start/end times.
 * @param {{ team?: object, contest?: object, contestNotStarted?: boolean }} snapshot
 * @param {number} now
 * @returns {Record<string, unknown>}
 */
function buildContestHeaderItem(snapshot, now) {
    const contest = snapshot.contest ?? snapshot.team?.contest ?? null;
    const contestName = resolveContestName(contest);
    const teamName = snapshot.team?.name?.toString().trim() || '';
    const timing = getContestTiming(contest, now);
    const timingText = describeContestTiming(timing, Boolean(snapshot.contestNotStarted), now);
    const publicId = resolveRouteId(contest);

    return {
        id: publicId ? `contest:${publicId}` : 'contest',
        label: contestName,
        description: teamName,
        collapsibleState: 0,
        contextValue: TREE_CONTEXT.CONTEST,
        iconPath: new vscode.ThemeIcon('mortar-board', new vscode.ThemeColor('charts.blue')),
        tooltip: buildContestHeaderTooltip(contestName, teamName, timing, timingText),
        command: {
            command: COMMANDS.OPEN_CONTEST_DASHBOARD,
            title: 'Open Contest Overview',
            arguments: [contest],
        },
    };
}

/**
 * Describe where the contest is in time: `2h 12m left`, `Ended`,
 * `Starts in 25m`, or `Not started`. Returns an empty string when the contest
 * is running but its window is unknown, so no misleading state is shown.
 * A valid start time in the past wins over the server's (sticky) not-started
 * flag, which only decides when there is no usable start time.
 * @param {ReturnType<typeof getContestTiming>} timing
 * @param {boolean} notStartedFlag the server reported the contest has not started
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function describeContestTiming(timing, notStartedFlag, now = Date.now()) {
    if (timing.phase === 'notStarted') {
        const untilStartMs = timing.startTime ? timing.startTime.getTime() - now : 0;
        if (untilStartMs > 0) {
            return `Starts in ${formatDuration(untilStartMs)}`;
        }

        // Without a start time we only claim "Not started" when the server said so.
        return notStartedFlag || timing.startTime ? 'Not started' : '';
    }

    if (timing.phase === 'ended') {
        return 'Ended';
    }

    return timing.remainingMs == null ? 'Running' : `${formatDuration(timing.remainingMs)} left`;
}

/**
 * Build the contest header tooltip: name, team, state, and local start/end times.
 * @param {string} contestName
 * @param {string} teamName
 * @param {ReturnType<typeof getContestTiming>} timing
 * @param {string} timingText
 * @returns {string}
 */
function buildContestHeaderTooltip(contestName, teamName, timing, timingText) {
    const lines = [contestName];

    if (teamName) {
        lines.push(`Team: ${teamName}`);
    }

    if (timingText) {
        lines.push(`Status: ${timingText}`);
    }

    if (timing.startTime) {
        lines.push(`Starts: ${formatLocalDateTime(timing.startTime)}`);
    }

    if (timing.endTime) {
        lines.push(`Ends: ${formatLocalDateTime(timing.endTime)}`);
    }

    return lines.join('\n');
}

/**
 * Describe a problem's state in at most one short fact, since the sidebar is
 * narrow and the inline actions cover the description on hover: `Judging…`
 * while a submission is pending, else `2 attempts` when attempted but unsolved,
 * else nothing (solved shows in the icon; the attempt count of a solve stays in
 * the tooltip).
 * @param {ReturnType<typeof summarizeProblemSubmissions>} summary
 * @returns {string}
 */
function buildProblemDescription(summary) {
    if (summary.pending) {
        return JUDGING_LABEL;
    }

    return !summary.solved && summary.attempts > 0 ? formatAttempts(summary.attempts) : '';
}

/**
 * Pick a problem row's initial collapsible state. A problem with a pending
 * submission starts Expanded so a fresh submission is visible; otherwise it
 * starts Collapsed when it has submissions and is a leaf when it has none.
 *
 * VS Code only applies this state when it first renders a row id (stable
 * `problem:<id>`); afterwards it keeps the user's own expand/collapse across
 * refreshes. So the state applies on load and when an untouched problem gets
 * its first submission, and the row does not snap shut when the verdict
 * arrives. A refresh never re-expands a problem the user collapsed; only the
 * explicit reveal after a submit (`TreeView.reveal` with `expand`) does.
 * @param {ReturnType<typeof summarizeProblemSubmissions>} summary
 * @param {number} childCount
 * @returns {0 | 1 | 2} None, Collapsed, or Expanded
 */
function resolveProblemCollapsibleState(summary, childCount) {
    if (!childCount) {
        return 0;
    }

    return summary.pending ? 2 : 1;
}

/**
 * Build the problem tooltip: letter and title, attempts, and first accepted time.
 * @param {string} letter
 * @param {string} title
 * @param {ReturnType<typeof summarizeProblemSubmissions>} summary
 * @returns {string}
 */
function buildProblemTooltip(letter, title, summary) {
    const lines = [letter ? `Problem ${letter}: ${title}` : title];

    if (summary.solved) {
        lines.push(`${SOLVED_MARK} Solved in ${formatAttempts(summary.attempts)}`);
        const accepted = summary.firstAccepted;
        const acceptedAt = formatLocalDateTime(accepted?.submittedAt, '');
        const contestTime = accepted?.score != null ? ` (${formatMinutes(accepted.score)})` : '';
        if (acceptedAt) {
            lines.push(`First accepted: ${acceptedAt}${contestTime}`);
        }
    } else if (summary.attempts) {
        lines.push(`Not solved yet · ${formatAttempts(summary.attempts)}`);
    } else {
        lines.push('No submissions yet');
    }

    if (summary.pending) {
        lines.push(`${JUDGING_LABEL} ${summary.pending} pending`);
    }

    return lines.join('\n');
}

/**
 * Build one submission row: `#id` with `Status · 5 min ago`.
 * @param {object} submission
 * @param {number} now
 * @returns {Record<string, unknown>}
 */
function buildSubmissionItem(submission, now) {
    const status = formatSubmissionStatus(submission.status);
    const relative = formatRelativeTime(submission.submittedAt, now);

    return {
        id: submission.id != null ? `submission:${submission.id}` : undefined,
        label: `#${submission.id ?? '?'}`,
        description: [status, relative].filter(Boolean).join(' · '),
        tooltip: buildSubmissionTooltip(submission, status),
        collapsibleState: 0,
        contextValue: hasComparableOutput(submission)
            ? TREE_CONTEXT.SUBMISSION_WITH_OUTPUT
            : TREE_CONTEXT.SUBMISSION,
        iconPath: getSubmissionIcon(submission.status),
        command: {
            command: COMMANDS.OPEN_SUBMISSION,
            title: 'Open Submission Result',
            arguments: [submission],
        },
        submission,
    };
}

/**
 * Build the submission tooltip: status, local time, time or penalty, file, language.
 * @param {object} submission
 * @param {string} status formatted status
 * @returns {string}
 */
function buildSubmissionTooltip(submission, status) {
    const lines = [`#${submission.id ?? '?'} · ${status}`];
    const submittedAt = formatLocalDateTime(submission.submittedAt, '');

    if (submittedAt) {
        lines.push(`Submitted: ${submittedAt}`);
    }

    if (submission.score != null && !isPendingSubmission(submission.status)) {
        const label = isPassedSubmission(submission.status) ? 'Time' : 'Penalty';
        lines.push(`${label}: ${formatMinutes(submission.score)}`);
    }

    const filename = (submission.filename ?? submission.fileName)?.toString().trim();
    if (filename) {
        lines.push(`File: ${filename}`);
    }

    const language = submission.language?.toString().trim();
    if (language) {
        lines.push(`Language: ${language}`);
    }

    return lines.join('\n');
}

/**
 * Map an AutoJudge submission status to a tree icon. Every failure verdict uses
 * the failure color; only pending uses yellow, and unknown statuses stay neutral.
 * @param {string | undefined | null} status
 * @returns {import('vscode').ThemeIcon}
 */
function getSubmissionIcon(status) {
    if (isPassedSubmission(status)) {
        return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    }

    if (isFailedSubmission(status)) {
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }

    if (isTimeLimitSubmission(status)) {
        return new vscode.ThemeIcon('watch', new vscode.ThemeColor('testing.iconFailed'));
    }

    if (isErrorSubmission(status)) {
        return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
    }

    if (isPendingSubmission(status)) {
        return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
    }

    return new vscode.ThemeIcon('circle-outline');
}

/**
 * Build the explorer note shown in place of the problems until they are loaded.
 * It has no command because there is nothing to open yet; the problems load on
 * their own once the contest starts, so no refresh is needed.
 * @param {boolean} [started=false] the contest clock says it already began
 * @returns {Record<string, unknown>}
 */
function buildNotStartedItem(started = false) {
    return {
        id: started ? 'contest-started' : 'contest-not-started',
        label: started ? 'Contest started' : 'Contest has not started yet',
        description: started ? 'Loading the problems…' : 'Problems appear when it starts',
        collapsibleState: 0,
        iconPath: new vscode.ThemeIcon('clock'),
    };
}

/**
 * Build the note shown when the "unsolved only" filter hides every problem.
 * @returns {Record<string, unknown>}
 */
function buildAllSolvedItem() {
    return {
        id: 'all-solved',
        label: 'All problems solved',
        description: 'Show all problems to see them',
        collapsibleState: 0,
        iconPath: new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed')),
    };
}

/**
 * Resolve the contest display name as sent by the server, falling back to `Contest`.
 * @param {object | null} contest
 * @returns {string}
 */
function resolveContestName(contest) {
    return contest?.name?.toString().trim() || 'Contest';
}

/**
 * Format an attempt count (`1 attempt`, `3 attempts`).
 * @param {number} count
 * @returns {string}
 */
function formatAttempts(count) {
    return `${count} attempt${count === 1 ? '' : 's'}`;
}

/**
 * Convert a timestamp to milliseconds, treating invalid values as 0 (oldest).
 * @param {unknown} value
 * @returns {number}
 */
function toTime(value) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}
