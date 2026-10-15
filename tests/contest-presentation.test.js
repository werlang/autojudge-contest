import { describe, expect, it } from 'vitest';
import {
    buildContestHeaderDescription,
    formatProblemScore,
    formatSubmissionStatus,
    getContestPageName,
    getProblemPageName,
    getSubmissionPageName,
    getTeamPageName,
    renderContestDashboard,
    renderProblemPage,
    renderSubmissionDetails,
    renderTeamStandingDetails,
    toSafeFileName,
} from '../src/presentation/contest-presentation.js';
import { formatLocalDateTime } from '../src/utils/time-format.js';

// Matches pictographic emoji (and the variation selector some emoji carry).
const EMOJI = /[\p{Extended_Pictographic}️]/u;

const PROBLEMS = [
    { publicId: 'pbbbbbbbbbbbb', order: 2, title: 'Binary Search' },
    { publicId: 'paaaaaaaaaaaa', order: 1, title: 'A + B', description: 'Add two integers.', input: ['1 2\n', '  5|6\n7'], output: ['3\n', 'a*b*c'] },
];

const CONTEST = {
    publicId: 'k3m9x2p7q8w1a',
    name: 'Regional Final',
    duration: 180,
    startTime: '2026-05-28T03:00:00.000Z',
    penaltyTime: 20,
    freezeTime: 60,
    frozenScoreboard: false,
    problems: PROBLEMS,
    teams: [
        { publicId: 'tslow00000000', name: 'Slow', score: 900000, solvedProblemIds: ['paaaaaaaaaaaa'] },
        { publicId: 'tfast00000000', name: 'Fast', score: 300000, solvedProblemIds: ['paaaaaaaaaaaa', 'pbbbbbbbbbbbb'] },
        { publicId: 'tnone00000000', name: 'None', score: 0, solvedProblemIds: [] },
    ],
};

describe('renderProblemPage', () => {
    it('titles the page with the contest letter and renders statement and 1-based cases', () => {
        const page = renderProblemPage(PROBLEMS[1], { problems: PROBLEMS });

        expect(page.startsWith('# A. A + B\n')).toBe(true);
        expect(page).toContain('**Not attempted yet**');
        expect(page).toContain('Add two integers.');
        expect(page).toContain('## Public test cases');
        expect(page).toContain('| 1 | <code>1 2</code> | <code>3</code> |');
        // Pipes, leading spaces, and Markdown emphasis stay literal inside cells.
        expect(page).toContain('| 2 | <code>&nbsp;&nbsp;5&#124;6<br>7</code> | <code>a&#42;b&#42;c</code> |');
        expect(page).not.toContain('| 0 |');
        expect(page).not.toMatch(EMOJI);
    });

    it('preserves runs of spaces and tabs in public test case cells', () => {
        const problem = { publicId: 'pwhitespace0', title: 'Ws', input: ['a  b   c\td \n\t x'], output: ['1 2'] };
        const page = renderProblemPage(problem, { problems: [problem] });

        expect(page).toContain('<code>a &nbsp;b &nbsp;&nbsp;c &nbsp;&nbsp;&nbsp;d&nbsp;<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;x</code>');
        // Single spaces between words stay plain.
        expect(page).toContain('<code>1 2</code>');
    });

    it('summarizes the team progress on the problem', () => {
        const problem = PROBLEMS[1];
        const rejected = { problem, status: 'WRONG_ANSWER', submittedAt: '2026-05-28T03:05:00.000Z' };
        const accepted = { problem, status: 'ACCEPTED', submittedAt: '2026-05-28T03:10:00.000Z' };
        const pending = { problem, status: 'PENDING', submittedAt: '2026-05-28T03:12:00.000Z' };

        expect(renderProblemPage(problem, { problems: PROBLEMS, submissions: [rejected, accepted] }))
            .toContain('**Solved** · 2 attempts');
        expect(renderProblemPage(problem, { problems: PROBLEMS, submissions: [rejected] }))
            .toContain('**Not solved yet** · 1 attempt');
        expect(renderProblemPage(problem, { problems: PROBLEMS, submissions: [pending] }))
            .toContain('**Judging** · 1 attempt');
    });

    it('falls back when the statement, cases, and problem list are missing', () => {
        const page = renderProblemPage({ publicId: 'pzzzzzzzzzzzz', title: 'Lonely' });

        expect(page.startsWith('# Lonely\n')).toBe(true);
        expect(page).toContain('The statement is not available');
        expect(page).not.toContain('Public test cases');
        expect(page).not.toContain('undefined');
    });
});

describe('renderSubmissionDetails', () => {
    it('renders an accepted submission with letter, local time, and Time', () => {
        const submission = {
            id: 852,
            problem: { publicId: 'paaaaaaaaaaaa' },
            score: 1200000,
            status: 'ACCEPTED',
            submittedAt: '2026-05-28T03:10:00.000Z',
            filename: 'main.cpp',
            language: 'C++',
        };
        const page = renderSubmissionDetails(submission, { problems: PROBLEMS });

        expect(page.startsWith('# Submission 852\n')).toBe(true);
        expect(page).toContain('**Accepted** for A. A + B.');
        expect(page).toContain('- **Verdict:** Accepted');
        expect(page).toContain('- **Problem:** A. A + B');
        expect(page).toContain(`- **Submitted:** ${formatLocalDateTime(submission.submittedAt)} (`);
        expect(page).toContain('- **Time:** 20 min');
        expect(page).toContain('- **File:** main.cpp');
        expect(page).toContain('- **Language:** C++');
        expect(page).not.toContain('2026-05-28T03:10:00.000Z');
        expect(page).not.toContain('paaaaaaaaaaaa');
        expect(page).not.toMatch(EMOJI);
    });

    it('labels a rejected score as Penalty and shows hint plus expected vs received with the compare tip', () => {
        const page = renderSubmissionDetails({
            id: 9,
            problem: { publicId: 'pbbbbbbbbbbbb', title: 'Binary Search' },
            score: 1200000,
            status: 'WRONG_ANSWER',
            hint: { message: 'Check the edges.', expected: '3\n', received: '```4' },
        }, { problems: PROBLEMS });

        expect(page).toContain('**Wrong Answer** for B. Binary Search.');
        expect(page).toContain('- **Penalty:** 20 min');
        expect(page).not.toContain('- **Time:**');
        expect(page).toContain('## Hint\n\n```text\nCheck the edges.\n```');
        expect(page).toContain('### Expected\n\n```text\n3\n```');
        // A longer fence keeps judge output with backticks inside the block.
        expect(page).toContain('### Received\n\n````text\n```4\n````');
        expect(page).toContain('Compare Expected and Received Output');
    });

    it('omits missing fields instead of rendering undefined', () => {
        const page = renderSubmissionDetails({ id: 3, status: 'PENDING' });

        expect(page).toContain('**Pending** — still being judged.');
        expect(page).not.toContain('undefined');
        expect(page).not.toContain('**Problem:**');
        expect(page).not.toContain('**Submitted:**');
        expect(page).not.toContain('**Penalty:**');
        expect(page).not.toContain('Compare Expected and Received Output');
    });

    it('skips the compare tip when only one side of the output exists', () => {
        const page = renderSubmissionDetails({ id: 4, status: 'RUNTIME_ERROR', hint: { received: 'boom' } });

        expect(page).toContain('### Received');
        expect(page).not.toContain('### Expected');
        expect(page).not.toContain('Compare Expected and Received Output');
    });
});

describe('renderTeamStandingDetails', () => {
    it('shows rank, solved count, total time, and lettered solved problems', () => {
        const page = renderTeamStandingDetails(CONTEST.teams[0], { contest: CONTEST });

        expect(page.startsWith('# Slow\n')).toBe(true);
        expect(page).toContain('Slow is ranked #2 with 1 problem solved.');
        expect(page).toContain('- **Rank:** #2 of 3');
        expect(page).toContain('- **Solved:** 1 of 2');
        expect(page).toContain('- **Total time:** 15 min');
        expect(page).toContain('- A. A + B');
        expect(page).not.toContain('Binary Search');
        expect(page).not.toContain('> -');
        expect(page).not.toMatch(EMOJI);
    });

    it('lists solved problems in contest order', () => {
        const page = renderTeamStandingDetails(CONTEST.teams[1], { contest: CONTEST });

        expect(page).toContain('- **Rank:** #1 of 3');
        expect(page.indexOf('- A. A + B')).toBeLessThan(page.indexOf('- B. Binary Search'));
    });

    it('shows an empty state for a team with no solved problems', () => {
        const page = renderTeamStandingDetails(CONTEST.teams[2], { contest: CONTEST });

        expect(page).toContain('- **Rank:** #3 of 3');
        expect(page).toContain('This team has not solved any problems yet.');
    });

    it('handles a missing snapshot without undefined output', () => {
        const page = renderTeamStandingDetails({ publicId: 'tghost0000000', name: 'Ghost' }, null);

        expect(page).toContain('Ghost is not in the current standings.');
        expect(page).toContain('- **Rank:** —');
        expect(page).not.toContain('undefined');
    });
});

describe('renderContestDashboard', () => {
    const start = new Date(CONTEST.startTime).getTime();

    it('renders a running contest with local times and remaining time when opened', () => {
        const now = start + 48 * 60 * 1000;
        const page = renderContestDashboard(CONTEST, { team: { publicId: 'tslow00000000', name: 'Slow' } }, now);

        expect(page.startsWith('# Contest Overview · Regional Final\n')).toBe(true);
        expect(page).toContain('- **Phase:** Running');
        expect(page).toContain(`- **Start:** ${formatLocalDateTime(CONTEST.startTime)}`);
        expect(page).toContain(`- **End:** ${formatLocalDateTime(start + 180 * 60 * 1000)}`);
        expect(page).toContain('- **Remaining (when opened):** 2h 12m');
        expect(page).toContain('- **Duration:** 3h');
        expect(page).toContain('- **Penalty per wrong answer:** 20 min');
        expect(page).toContain('- **Scoreboard freeze:** 60 min');
        expect(page).toContain('- **Problems:** 2');
        expect(page).toContain('- **Teams:** 3');
        expect(page).toContain('## Slow');
        expect(page).toContain('- **Rank:** #2 of 3');
        expect(page).toContain('- **Solved:** 1 of 2');
        expect(page).not.toContain('2026-05-28T03:00:00.000Z');
        expect(page).not.toMatch(EMOJI);
    });

    it('marks an ended contest and a frozen scoreboard', () => {
        const page = renderContestDashboard({ ...CONTEST, frozenScoreboard: true }, {}, start + 200 * 60 * 1000);

        expect(page).toContain('- **Phase:** Ended');
        expect(page).toContain('- **Remaining (when opened):** Ended');
        expect(page).toContain('- **Scoreboard freeze:** 60 min (frozen now)');
        expect(page).not.toContain('## ');
    });

    it('renders a not-started contest without 1970 dates or undefined settings', () => {
        const page = renderContestDashboard({ name: 'Practice', startTime: null }, { problems: PROBLEMS });

        expect(page).toContain('The contest has not started yet.');
        expect(page).toContain('- **Start:** Not started');
        expect(page).toContain('- **End:** Not started');
        expect(page).toContain('- **Remaining (when opened):** Not started');
        expect(page).toContain('- **Problems:** 2');
        expect(page).not.toContain('1970');
        expect(page).not.toContain('undefined');
        expect(page).not.toContain('NaN');
        expect(page).not.toContain('Penalty per wrong answer');
    });

    it('omits end and duration instead of claiming 0 minutes when the duration is unknown', () => {
        const page = renderContestDashboard({ ...CONTEST, duration: null }, {}, start + 60 * 1000);

        expect(page).toContain('- **Phase:** Running');
        expect(page).not.toContain('**Duration:**');
        expect(page).not.toContain('**End:**');
        expect(page).not.toContain('Invalid');
    });

    it('shows the scheduled end of a contest that starts later', () => {
        const page = renderContestDashboard(CONTEST, {}, start - 60 * 60 * 1000);

        expect(page).toContain('- **Phase:** Not started');
        expect(page).toContain(`The contest starts ${formatLocalDateTime(CONTEST.startTime)}.`);
        expect(page).toContain(`- **End:** ${formatLocalDateTime(start + 180 * 60 * 1000)}`);
    });
});

describe('page names', () => {
    it('builds tab titles from letters and names', () => {
        expect(getProblemPageName(PROBLEMS[0], PROBLEMS)).toBe('B. Binary Search');
        expect(getProblemPageName({ title: 'Loose' })).toBe('Loose');
        expect(getSubmissionPageName({ id: 852, problem: { publicId: 'paaaaaaaaaaaa' } }, PROBLEMS)).toBe('Submission 852 · A. A + B');
        expect(getSubmissionPageName({ id: 7 })).toBe('Submission 7');
        expect(getTeamPageName({ name: '  Bits ' })).toBe('Bits');
        expect(getTeamPageName({})).toBe('Unnamed team');
        expect(getContestPageName({ name: 'Regional Final' })).toBe('Contest Overview · Regional Final');
        expect(getContestPageName(null)).toBe('Contest Overview');
    });

    it('makes names filesystem safe', () => {
        expect(toSafeFileName('Submission 852 · A. a/b\\c:d*e?f"g<h>i|j')).toBe('Submission 852 · A. a b c d e f g h i j');
        expect(toSafeFileName('tab\tand\nnewline\u0000')).toBe('tab and newline');
        expect(toSafeFileName('  trailing dots... ')).toBe('trailing dots');
        expect(toSafeFileName('x'.repeat(200))).toHaveLength(80);
        expect(toSafeFileName('///')).toBe('page');
        expect(toSafeFileName(undefined, 'problem')).toBe('problem');
    });

    it('never produces a Windows reserved device name', () => {
        expect(toSafeFileName('nul')).toBe('nul_');
        expect(toSafeFileName('CON')).toBe('CON_');
        expect(toSafeFileName('Com1')).toBe('Com1_');
        expect(toSafeFileName('lpt9')).toBe('lpt9_');
        expect(toSafeFileName('aux.txt')).toBe('aux_.txt');
        expect(toSafeFileName('PRN...')).toBe('PRN_');
        expect(toSafeFileName('nul ')).toBe('nul_');
        expect(toSafeFileName('com0')).toBe('com0');
        expect(toSafeFileName('console')).toBe('console');
        expect(toSafeFileName('com10')).toBe('com10');
        expect(toSafeFileName('nul?', 'x')).toBe('nul_');
    });
});

describe('kept helpers', () => {
    it('keeps the explorer and output helpers stable', () => {
        expect(formatSubmissionStatus('WRONG_ANSWER')).toBe('Wrong Answer');
        expect(formatSubmissionStatus(null)).toBe('Unknown');
        expect(buildContestHeaderDescription({ name: ' Bits ' })).toBe('Bits');
        expect(buildContestHeaderDescription(null)).toBe('Unknown Team');
        expect(formatProblemScore(1200000)).toBe('20 min');
    });
});
