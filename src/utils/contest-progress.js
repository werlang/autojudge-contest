import { sameEntity } from './public-id.js';
import { isPassedSubmission, isPendingSubmission } from './submission-status.js';

const MINUTE_MS = 60 * 1000;

/**
 * Work out where a contest is in its time window. A contest without a valid
 * `startTime` has not started; the end is `startTime + duration` minutes.
 * @param {{ startTime?: string | null, duration?: number } | undefined | null} contest
 * @param {number} [now=Date.now()]
 * @returns {{ phase: 'notStarted' | 'running' | 'ended', startTime: Date | null, endTime: Date | null, remainingMs: number | null }}
 */
export function getContestTiming(contest, now = Date.now()) {
    const startTime = contest?.startTime ? new Date(contest.startTime) : null;
    if (!startTime || Number.isNaN(startTime.getTime()) || startTime.getTime() > now) {
        return {
            phase: 'notStarted',
            startTime: startTime && !Number.isNaN(startTime.getTime()) ? startTime : null,
            endTime: null,
            remainingMs: null,
        };
    }

    const durationMinutes = Number(contest?.duration);
    if (!Number.isFinite(durationMinutes)) {
        return { phase: 'running', startTime, endTime: null, remainingMs: null };
    }

    const endTime = new Date(startTime.getTime() + durationMinutes * MINUTE_MS);
    const remainingMs = endTime.getTime() - now;

    return {
        phase: remainingMs > 0 ? 'running' : 'ended',
        startTime,
        endTime,
        remainingMs: Math.max(remainingMs, 0),
    };
}

/**
 * Sort contest problems by `order`, keeping problems without an order last.
 * @param {object[] | undefined | null} problems
 * @returns {object[]}
 */
export function sortProblems(problems) {
    return (Array.isArray(problems) ? problems : [])
        .slice()
        .sort((left, right) => (left?.order ?? Number.MAX_SAFE_INTEGER) - (right?.order ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Return the contest letter (A, B, …, Z, AA, …) of a problem: its position in the
 * `order`-sorted problem list. Returns an empty string when it is not in the list.
 * @param {object} problem
 * @param {object[] | undefined | null} problems all contest problems
 * @returns {string}
 */
export function getProblemLetter(problem, problems) {
    const index = sortProblems(problems).findIndex(entry => sameEntity(entry, problem));
    return index === -1 ? '' : indexToLetter(index);
}

/**
 * Summarize the team's own submissions for one problem.
 * @param {object} problem
 * @param {object[] | undefined | null} submissions the team's submissions
 * @returns {{ attempts: number, solved: boolean, pending: number, firstAccepted: object | null }}
 */
export function summarizeProblemSubmissions(problem, submissions) {
    const own = (Array.isArray(submissions) ? submissions : [])
        .filter(submission => sameEntity(submission?.problem, problem));
    const accepted = own
        .filter(submission => isPassedSubmission(submission?.status))
        .sort((left, right) => new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime());

    return {
        attempts: own.length,
        solved: accepted.length > 0,
        pending: own.filter(submission => isPendingSubmission(submission?.status)).length,
        firstAccepted: accepted[0] ?? null,
    };
}

/**
 * Convert a zero-based index to spreadsheet-style letters.
 * @param {number} index
 * @returns {string}
 */
function indexToLetter(index) {
    let value = index + 1;
    let letters = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        letters = String.fromCharCode(65 + remainder) + letters;
        value = Math.floor((value - 1) / 26);
    }
    return letters;
}
