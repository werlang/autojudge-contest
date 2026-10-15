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

/**
 * Provide the contest explorer tree for logged-in contest snapshots: a contest
 * header with live timing, then one row per problem (letter, title, solved or
 * attempt state) with that problem's submissions nested newest-first.
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
     * Refresh the full tree (also re-renders relative times and the countdown)
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
     * Create the small balloon-color circle used as a problem's identity icon.
     * A missing or non-hex color renders a transparent circle.
     * @param {string | undefined | null} hexColor
     * @returns {import('vscode').Uri}
     */
    createColoredCircleIcon(hexColor) {
        const color = typeof hexColor === 'string' && /^#?[0-9a-f]{3,8}$/i.test(hexColor.trim())
            ? (hexColor.trim().startsWith('#') ? hexColor.trim() : `#${hexColor.trim()}`)
            : '#00000000';
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
                <circle cx="8" cy="8" r="4" fill="${color}" />
            </svg>
        `;

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

        return [
            header,
            ...problems.map(problem => this.buildProblemItem(problem, problems, submissions, now)),
        ];
    }

    /**
     * Build one problem row with its submissions as children.
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

        return {
            id: publicId ? `problem:${publicId}` : undefined,
            label: letter ? `${letter}. ${title}` : title,
            description: buildProblemDescription(summary),
            tooltip: buildProblemTooltip(letter, title, summary),
            collapsibleState: children.length ? 1 : 0,
            contextValue: TREE_CONTEXT.PROBLEM,
            iconPath: this.createColoredCircleIcon(problem?.color),
            children,
            problem,
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
 * Build the contest header row: the contest name, then team and timing.
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
        description: [teamName, timingText].filter(Boolean).join(' · '),
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
 * Describe a problem's state for the team: `✓ Solved`, `✓ Solved · 3 attempts`,
 * `Judging…`, `2 attempts`, or nothing when untouched.
 * @param {ReturnType<typeof summarizeProblemSubmissions>} summary
 * @returns {string}
 */
function buildProblemDescription(summary) {
    const parts = [];

    if (summary.solved) {
        parts.push(`${SOLVED_MARK} Solved`);
    }

    if (summary.pending) {
        parts.push(JUDGING_LABEL);
    }

    // A first-try solve or a lone pending attempt needs no attempt count.
    const showAttempts = summary.solved || summary.pending ? summary.attempts > 1 : summary.attempts > 0;
    if (showAttempts) {
        parts.push(formatAttempts(summary.attempts));
    }

    return parts.join(' · ');
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
 * It has no command because there is nothing to open yet; refresh loads the problems.
 * @param {boolean} [started=false] the contest clock says it already began
 * @returns {Record<string, unknown>}
 */
function buildNotStartedItem(started = false) {
    return {
        id: started ? 'contest-started' : 'contest-not-started',
        label: started ? 'Contest started' : 'Contest has not started yet',
        description: started ? 'Refresh to load the problems' : 'Refresh when it starts',
        collapsibleState: 0,
        iconPath: new vscode.ThemeIcon('clock'),
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
