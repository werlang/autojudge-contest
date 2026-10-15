import { describe, expect, it } from 'vitest';
import { formatDuration, formatLocalDateTime, formatMinutes, formatRelativeTime } from '../src/utils/time-format.js';
import { getContestTiming, getProblemLetter, sortProblems, summarizeProblemSubmissions } from '../src/utils/contest-progress.js';

describe('time formatting', () => {
    it('formats minutes with at most one decimal', () => {
        expect(formatMinutes(20 * 60000)).toBe('20 min');
        expect(formatMinutes(12.54 * 60000)).toBe('12.5 min');
        expect(formatMinutes(undefined)).toBe('0 min');
    });

    it('formats durations in hours and minutes', () => {
        expect(formatDuration(30 * 1000)).toBe('<1m');
        expect(formatDuration(45 * 60000)).toBe('45m');
        expect(formatDuration(132 * 60000)).toBe('2h 12m');
        expect(formatDuration(120 * 60000)).toBe('2h');
        expect(formatDuration((28 * 60) * 60000)).toBe('1d 4h');
    });

    it('formats relative and local times with fallbacks', () => {
        const now = Date.parse('2026-06-03T12:00:00Z');
        expect(formatRelativeTime('2026-06-03T11:59:30Z', now)).toBe('just now');
        expect(formatRelativeTime('2026-06-03T11:55:00Z', now)).toBe('5 min ago');
        expect(formatRelativeTime('2026-06-03T09:00:00Z', now)).toBe('3h ago');
        expect(formatRelativeTime('nope', now, '?')).toBe('?');
        expect(formatLocalDateTime(null, 'Not started')).toBe('Not started');
        expect(formatLocalDateTime('2026-06-03T11:55:00Z')).not.toBe('Unknown');
    });
});

describe('contest progress', () => {
    const now = Date.parse('2026-06-03T12:00:00Z');

    it('reports the contest phase and remaining time', () => {
        expect(getContestTiming({ startTime: null, duration: 60 }, now).phase).toBe('notStarted');
        expect(getContestTiming({ startTime: '2026-06-03T13:00:00Z', duration: 60 }, now).phase).toBe('notStarted');
        const running = getContestTiming({ startTime: '2026-06-03T11:00:00Z', duration: 180 }, now);
        expect(running.phase).toBe('running');
        expect(running.remainingMs).toBe(120 * 60000);
        expect(getContestTiming({ startTime: '2026-06-03T08:00:00Z', duration: 60 }, now)).toMatchObject({ phase: 'ended', remainingMs: 0 });
    });

    it('assigns letters by problem order', () => {
        const problems = [{ publicId: 'b', order: 2 }, { publicId: 'a', order: 1 }, { publicId: 'z' }];
        expect(sortProblems(problems).map(problem => problem.publicId)).toEqual(['a', 'b', 'z']);
        expect(getProblemLetter({ publicId: 'b' }, problems)).toBe('B');
        expect(getProblemLetter({ publicId: 'z' }, problems)).toBe('C');
        expect(getProblemLetter({ publicId: 'x' }, problems)).toBe('');
        const many = Array.from({ length: 28 }, (_, index) => ({ publicId: `p${index}`, order: index }));
        expect(getProblemLetter({ publicId: 'p26' }, many)).toBe('AA');
    });

    it('summarizes the team submissions for one problem', () => {
        const submissions = [
            { id: 1, problem: { publicId: 'a' }, status: 'WRONG_ANSWER', submittedAt: '2026-06-03T10:00:00Z' },
            { id: 3, problem: { publicId: 'a' }, status: 'ACCEPTED', submittedAt: '2026-06-03T11:00:00Z' },
            { id: 2, problem: { publicId: 'a' }, status: 'ACCEPTED', submittedAt: '2026-06-03T10:30:00Z' },
            { id: 4, problem: { publicId: 'b' }, status: 'PENDING', submittedAt: '2026-06-03T11:30:00Z' },
        ];
        expect(summarizeProblemSubmissions({ publicId: 'a' }, submissions)).toMatchObject({ attempts: 3, solved: true, pending: 0, firstAccepted: { id: 2 } });
        expect(summarizeProblemSubmissions({ publicId: 'b' }, submissions)).toMatchObject({ attempts: 1, solved: false, pending: 1, firstAccepted: null });
    });
});
