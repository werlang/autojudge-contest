import { describe, expect, it } from 'vitest';
import {
    hasComparableOutput,
    isErrorSubmission,
    isFailedSubmission,
    isPassedSubmission,
    isPendingSubmission,
    isTimeLimitSubmission,
} from '../src/utils/submission-status.js';

describe('submission status classification', () => {
    it('classifies every verdict the server can send into exactly one bucket', () => {
        const buckets = {
            ACCEPTED: isPassedSubmission,
            WRONG_ANSWER: isFailedSubmission,
            TIME_LIMIT_EXCEEDED: isTimeLimitSubmission,
            PARSING_ERROR: isErrorSubmission,
            ERROR: isErrorSubmission,
            PENDING: isPendingSubmission,
        };
        const all = [...new Set(Object.values(buckets))];

        for (const [status, matches] of Object.entries(buckets)) {
            expect(all.filter(check => check(status)), status).toEqual([matches]);
        }
    });

    it('treats unknown, blank and nullish statuses as unclassified', () => {
        for (const status of ['SOMETHING_NEW', '', null, undefined]) {
            expect([isPassedSubmission, isFailedSubmission, isTimeLimitSubmission, isErrorSubmission, isPendingSubmission]
                .some(check => check(status))).toBe(false);
        }
    });

    it('treats a submission as comparable only when both expected and received output exist', () => {
        expect(hasComparableOutput({ hint: { expected: '3\n', received: '' } })).toBe(true);
        expect(hasComparableOutput({ hint: { expected: '3\n' } })).toBe(false);
        expect(hasComparableOutput({ hint: { received: '4\n' } })).toBe(false);
        expect(hasComparableOutput({ hint: null })).toBe(false);
        expect(hasComparableOutput(null)).toBe(false);
    });
});
