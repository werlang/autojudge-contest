import * as vscode from 'vscode';
import { COMMANDS } from '../constants.js';
import { sameTeam } from '../utils/public-id.js';
import { countSolvedProblems, resolveStandingTeams } from '../utils/standings.js';
import { getContestTiming, summarizeProblemSubmissions } from '../utils/contest-progress.js';
import { formatLocalDateTime } from '../utils/time-format.js';
import { describeContestTiming } from './contest-tree-provider.js';

const TICK_MS = 30 * 1000;
const WARNING_REMAINING_MS = 15 * 60 * 1000;

/**
 * Left-aligned status bar item that keeps the contest clock, the team's rank,
 * and any pending verdict visible while the team works in the editor.
 *
 * Usage: create once, call `update(snapshot)` whenever the contest snapshot
 * changes (null hides it), `setPendingCount(n)` when the number of submissions
 * awaiting a verdict changes, and `dispose()` on deactivation. While the contest
 * is running or not started it re-renders itself every 30 seconds.
 */
export class ContestStatusBar {
    /**
     * @param {object} [options]
     * @param {() => import('vscode').StatusBarItem} [options.createStatusBarItem]
     * @param {() => number} [options.now]
     * @param {typeof setInterval} [options.setInterval]
     * @param {typeof clearInterval} [options.clearInterval]
     */
    constructor(options = {}) {
        const createStatusBarItem = options.createStatusBarItem
            ?? (() => vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100));
        this.now = options.now ?? Date.now;
        this.setIntervalFn = options.setInterval ?? setInterval;
        this.clearIntervalFn = options.clearInterval ?? clearInterval;
        this.item = createStatusBarItem();
        this.item.name = 'AutoJudge Contest';
        this.snapshot = null;
        this.pendingCount = 0;
        this.timer = null;
    }

    /**
     * Show the given contest snapshot, or hide the item for null.
     * @param {{ team?: object, contest?: object, problems?: object[], submissions?: object[], contestNotStarted?: boolean } | null} snapshot
     */
    update(snapshot) {
        this.snapshot = snapshot ?? null;
        this.render();
    }

    /**
     * Set how many submissions are awaiting a verdict; a positive count adds a
     * spinning `Judging` segment.
     * @param {number} count
     */
    setPendingCount(count) {
        const value = Number(count);
        this.pendingCount = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
        this.render();
    }

    /**
     * Re-render the item from the current snapshot and time, and start or stop
     * the 30-second tick depending on whether the clock still moves.
     */
    render() {
        const snapshot = this.snapshot;
        if (!snapshot) {
            this.stopTimer();
            this.item.hide();
            return;
        }

        const now = this.now();
        const contest = snapshot.contest ?? snapshot.team?.contest ?? null;
        const notStartedFlag = Boolean(snapshot.contestNotStarted);
        const timing = getContestTiming(contest, now);
        const timingText = describeContestTiming(timing, notStartedFlag, now) || 'Running';
        const standing = notStartedFlag ? null : findTeamStanding(contest, snapshot.team);
        const segments = [`$(mortar-board) ${timingText}`];

        if (standing) {
            segments.push(`#${standing.rank}`);
        }

        if (this.pendingCount > 0) {
            segments.push(`$(sync~spin) Judging${this.pendingCount > 1 ? ` ${this.pendingCount}` : ''}`);
        }

        const running = timing.phase === 'running' && !notStartedFlag;
        const nearEnd = running && timing.remainingMs != null && timing.remainingMs < WARNING_REMAINING_MS;

        this.item.text = segments.join(' · ');
        this.item.tooltip = buildTooltip(snapshot, contest, timing, timingText, standing);
        this.item.backgroundColor = nearEnd ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
        this.item.command = {
            command: COMMANDS.OPEN_CONTEST_DASHBOARD,
            arguments: [contest],
            title: 'Open Contest Overview',
        };
        this.item.show();

        if (timing.phase === 'ended' && !notStartedFlag) {
            this.stopTimer();
        } else {
            this.startTimer();
        }
    }

    /**
     * Stop the tick and dispose the status bar item.
     */
    dispose() {
        this.stopTimer();
        this.item.dispose();
    }

    /**
     * Start the 30-second re-render tick if it is not already running.
     */
    startTimer() {
        if (!this.timer) {
            this.timer = this.setIntervalFn(() => this.render(), TICK_MS);
        }
    }

    /**
     * Stop the re-render tick if it is running.
     */
    stopTimer() {
        if (this.timer) {
            this.clearIntervalFn(this.timer);
            this.timer = null;
        }
    }
}

/**
 * Find the logged-in team's ranked standings entry, with `rank` falling back to
 * the 1-based position when the standings helper did not set one.
 * @param {object | null} contest
 * @param {object | undefined} team
 * @returns {object | null}
 */
function findTeamStanding(contest, team) {
    const teams = resolveStandingTeams(contest);
    const index = teams.findIndex(entry => sameTeam(entry, team));
    if (index === -1) {
        return null;
    }

    const entry = teams[index];
    return { ...entry, rank: entry.rank ?? index + 1, total: teams.length };
}

/**
 * Count the team's solved problems, taking the larger of its own accepted
 * submissions (fresh after a submit) and its standings entry.
 * @param {object} snapshot
 * @param {object | null} standing
 * @returns {number}
 */
function countSolved(snapshot, standing) {
    const problems = Array.isArray(snapshot.problems) ? snapshot.problems : [];
    const fromSubmissions = problems
        .filter(problem => summarizeProblemSubmissions(problem, snapshot.submissions).solved)
        .length;

    return Math.max(fromSubmissions, standing ? countSolvedProblems(standing) : 0);
}

/**
 * Build the status bar tooltip: contest, team, state, rank, solved, end time.
 * @param {object} snapshot
 * @param {object | null} contest
 * @param {ReturnType<typeof getContestTiming>} timing
 * @param {string} timingText
 * @param {object | null} standing
 * @returns {string}
 */
function buildTooltip(snapshot, contest, timing, timingText, standing) {
    const lines = [contest?.name?.toString().trim() || 'Contest'];
    const teamName = snapshot.team?.name?.toString().trim();

    if (teamName) {
        lines.push(`Team: ${teamName}`);
    }

    lines.push(`Status: ${timingText}`);

    if (standing) {
        lines.push(`Rank: #${standing.rank} of ${standing.total}`);
    }

    if (!snapshot.contestNotStarted) {
        lines.push(`Solved: ${countSolved(snapshot, standing)}`);
    }

    if (timing.phase === 'notStarted' && timing.startTime) {
        lines.push(`Starts: ${formatLocalDateTime(timing.startTime)}`);
    }

    if (timing.endTime) {
        lines.push(`Ends: ${formatLocalDateTime(timing.endTime)}`);
    }

    lines.push('Click to open the contest overview');
    return lines.join('\n');
}
