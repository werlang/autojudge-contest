const PASSED_STATUSES = new Set(['ACCEPTED', 'OK', 'PASS']);
const PENDING_STATUSES = new Set(['PENDING', 'QUEUED', 'RUNNING', 'JUDGING']);
const FAILED_STATUSES = new Set(['WRONG_ANSWER', 'FAILED', 'REJECTED']);
const TIME_LIMIT_STATUSES = new Set(['TIME_LIMIT_EXCEEDED', 'TIMEOUT']);
const ERROR_STATUSES = new Set(['RUNTIME_ERROR', 'COMPILATION_ERROR', 'INTERNAL_ERROR', 'PARSING_ERROR', 'ERROR']);

/**
 * Return whether the submission should be shown as a failed result.
 * @param {string | undefined | null} status
 * @returns {boolean}
 */
export function isFailedSubmission(status) {
    return FAILED_STATUSES.has((status || '').toString().trim().toUpperCase());
}

/**
 * Return whether the submission should be shown as a time limit exceeded result.
 * @param {string | undefined | null} status
 * @returns {boolean}
 */
export function isTimeLimitSubmission(status) {
    return TIME_LIMIT_STATUSES.has((status || '').toString().trim().toUpperCase());
}

/**
 * Return whether the submission should be shown as an error result.
 * @param {string | undefined | null} status
 * @returns {boolean}
 */
export function isErrorSubmission(status) {
    return ERROR_STATUSES.has((status || '').toString().trim().toUpperCase());
}

/**
 * Return whether the submission should be shown as a passed result.
 * @param {string | undefined | null} status
 * @returns {boolean}
 */
export function isPassedSubmission(status) {
    return PASSED_STATUSES.has((status || '').toString().trim().toUpperCase());
}

/**
 * Return whether the submission is still pending a final verdict.
 * @param {string | undefined | null} status
 * @returns {boolean}
 */
export function isPendingSubmission(status) {
    return PENDING_STATUSES.has((status || '').toString().trim().toUpperCase());
}