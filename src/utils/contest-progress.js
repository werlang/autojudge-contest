import { sameEntity } from './public-id.js';
import { isPassedSubmission, isPendingSubmission } from './submission-status.js';

const MINUTE_MS = 60 * 1000;

/**
 * Read a contest's duration in minutes. Missing, blank, non-numeric and
 * non-finite values are unknown (`null`), never 0.
 * @param {{ duration?: unknown } | undefined | null} contest
 * @returns {number | null}
 */
export function getContestDurationMinutes(contest) {
    const raw = contest?.duration;
    if (raw == null || (typeof raw === 'string' && !raw.trim())) {
        return null;
    }

    const minutes = Number(raw);
    return Number.isFinite(minutes) ? minutes : null;
}

/**
 * Work out where a contest is in its time window. A contest without a valid
 * `startTime` has not started; the end is `startTime + duration` minutes. An
 * unknown or unrepresentable duration leaves a started contest running with no
 * end time.
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

    const durationMinutes = getContestDurationMinutes(contest);
    const endTime = durationMinutes == null ? null : new Date(startTime.getTime() + durationMinutes * MINUTE_MS);
    if (!endTime || Number.isNaN(endTime.getTime())) {
        return { phase: 'running', startTime, endTime: null, remainingMs: null };
    }

    const remainingMs = endTime.getTime() - now;

    return {
        phase: remainingMs > 0 ? 'running' : 'ended',
        startTime,
        endTime,
        remainingMs: Math.max(remainingMs, 0),
    };
}

/**
 * Sort contest problems by `order`, keeping problems without a usable (finite
 * numeric) order last, in their original relative order.
 * @param {object[] | undefined | null} problems
 * @returns {object[]}
 */
export function sortProblems(problems) {
    return (Array.isArray(problems) ? problems : [])
        .slice()
        .sort((left, right) => toOrderKey(left) - toOrderKey(right));
}

/**
 * Convert a problem's `order` to a sortable number; missing or non-numeric
 * values sort last.
 * @param {{ order?: unknown } | null | undefined} problem
 * @returns {number}
 */
function toOrderKey(problem) {
    const raw = problem?.order;
    if (raw == null || (typeof raw === 'string' && !raw.trim())) {
        return Number.MAX_SAFE_INTEGER;
    }

    const order = Number(raw);
    return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
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
