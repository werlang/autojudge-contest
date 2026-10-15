import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    ThemeColor: class ThemeColor {
        constructor(id) {
            this.id = id;
        }
    },
    ThemeIcon: class ThemeIcon {
        constructor(id, color) {
            this.id = id;
            this.color = color;
        }
    },
    Uri: {
        parse: (value) => ({
            toString: () => value,
            fsPath: value,
        }),
    },
}), { virtual: true });

import { ContestTreeProvider } from '../src/providers/contest-tree-provider.js';
import { getProblemPageName } from '../src/presentation/contest-presentation.js';
import { COMMANDS, TREE_CONTEXT } from '../src/constants.js';

const START = Date.parse('2026-05-28T02:00:00.000Z');
const MINUTE = 60 * 1000;
// 48 minutes into a 3-hour contest: 2h 12m left.
const NOW = START + 48 * MINUTE;

/**
 * Build a contest object starting at START with the given duration in minutes.
 * @param {object} [overrides]
 * @returns {object}
 */
function buildContest(overrides = {}) {
    return {
        publicId: 'k3m9x2p7q8w1a',
        name: 'Regional Final',
        startTime: new Date(START).toISOString(),
        duration: 180,
        ...overrides,
    };
}

/**
 * Build a submission for problem `problemId` submitted `minutesIn` after START.
 * @param {number} id
 * @param {string} status
 * @param {string} problemId
 * @param {number} minutesIn
 * @param {object} [extra]
 * @returns {object}
 */
function buildSubmission(id, status, problemId, minutesIn, extra = {}) {
    return {
        id,
        status,
        submittedAt: new Date(START + minutesIn * MINUTE).toISOString(),
        problem: { publicId: problemId },
        ...extra,
    };
}

/**
 * Create a provider at a fixed clock with the given snapshot.
 * @param {object} snapshot
 * @param {number} [now=NOW]
 * @returns {ContestTreeProvider}
 */
function createProvider(snapshot, now = NOW) {
    const provider = new ContestTreeProvider({ now: () => now });
    provider.setSnapshot({
        problems: [],
        submissions: [],
        team: { publicId: 'tbits0000001', name: 'Bits' },
        contest: buildContest(),
        token: 'jwt-token',
        ...snapshot,
    });
    return provider;
}

describe('contest tree provider', () => {
    it('returns an empty tree while no contest snapshot is loaded so the welcome action can render', () => {
        const provider = new ContestTreeProvider();

        expect(provider.getChildren()).toEqual([]);
    });

    it('renders the contest header with the contest name and only the team name, keeping timing in the tooltip', () => {
        const listener = vi.fn();
        const provider = new ContestTreeProvider({ now: () => NOW });
        provider.onDidChangeTreeData(listener);
        provider.setSnapshot({
            problems: [],
            submissions: [],
            team: { name: 'Bits' },
            contest: buildContest(),
        });

        const [header] = provider.getChildren();

        expect(header).toEqual(expect.objectContaining({
            id: 'contest:k3m9x2p7q8w1a',
            label: 'Regional Final',
            description: 'Bits',
            contextValue: TREE_CONTEXT.CONTEST,
            iconPath: expect.objectContaining({ id: 'mortar-board' }),
            command: expect.objectContaining({
                command: COMMANDS.OPEN_CONTEST_DASHBOARD,
                arguments: [expect.objectContaining({ publicId: 'k3m9x2p7q8w1a' })],
            }),
        }));
        expect(header.tooltip).toContain('Regional Final');
        expect(header.tooltip).toContain('Team: Bits');
        expect(header.tooltip).toContain('Status: 2h 12m left');
        expect(header.tooltip).toContain('Starts: ');
        expect(header.tooltip).toContain('Ends: ');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('describes ended and not-yet-started contests in the header tooltip, not the description', () => {
        const ended = createProvider({}, START + 200 * MINUTE).getChildren()[0];
        const upcoming = createProvider({}, START - 25 * MINUTE).getChildren()[0];
        const unscheduled = createProvider({
            contest: buildContest({ startTime: null }),
            contestNotStarted: true,
        }).getChildren()[0];

        expect([ended, upcoming, unscheduled].map(header => header.description)).toEqual(['Bits', 'Bits', 'Bits']);
        expect(ended.tooltip).toContain('Status: Ended');
        expect(upcoming.tooltip).toContain('Status: Starts in 25m');
        expect(unscheduled.tooltip).toContain('Status: Not started');
    });

    it('trusts the clock over a sticky not-started flag once the contest is running', () => {
        const rootChildren = createProvider({
            contestNotStarted: true,
            problems: [{ publicId: 'pa1b2c3d4e5f6', order: 1, title: 'A + B' }],
        }).getChildren();

        expect(rootChildren[0].tooltip).toContain('Status: 2h 12m left');
        expect(rootChildren).toHaveLength(2);
        expect(rootChildren[1]).toEqual(expect.objectContaining({
            label: 'Contest started',
            description: 'Loading the problems…',
        }));
        expect(rootChildren[1].command).toBeUndefined();
    });

    it('falls back to "Contest" and omits timing when the contest has no name or window', () => {
        const [header] = createProvider({ contest: { publicId: 'k3m9x2p7q8w1a' } }).getChildren();

        expect(header.label).toBe('Contest');
        expect(header.description).toBe('Bits');
        expect(header.tooltip).not.toContain('Status:');
    });

    it('shows a not-started note instead of problems while the contest has not started', () => {
        const rootChildren = createProvider({
            contestNotStarted: true,
            problems: [{ publicId: 'pa1b2c3d4e5f6', order: 1, title: 'A + B' }],
        }, START - 10 * MINUTE).getChildren();

        expect(rootChildren).toEqual([
            expect.objectContaining({ label: 'Regional Final' }),
            expect.objectContaining({
                description: 'Problems appear when it starts',
                label: 'Contest has not started yet',
            }),
        ]);
        expect(rootChildren[1].command).toBeUndefined();
        expect(rootChildren[1].contextValue).toBeUndefined();
    });

    it('labels problems by contest letter and describes solved, attempted, judging, and untouched states', () => {
        const rootChildren = createProvider({
            problems: [
                { publicId: 'pd', order: 4, title: 'Untouched' },
                { publicId: 'pa', order: 1, title: 'A + B', color: '#ff0000' },
                { publicId: 'pb', order: 2, title: 'Binary Search' },
                { publicId: 'pc', order: 3, title: '  Cycles  ' },
                { publicId: 'pe', order: 5, title: 'First Try' },
            ],
            submissions: [
                buildSubmission(11, 'WRONG_ANSWER', 'pa', 10),
                buildSubmission(12, 'ACCEPTED', 'pa', 20, { score: 40 * MINUTE }),
                buildSubmission(13, 'TIME_LIMIT_EXCEEDED', 'pb', 15),
                buildSubmission(14, 'WRONG_ANSWER', 'pb', 25),
                buildSubmission(15, 'PENDING', 'pc', 47),
                buildSubmission(16, 'ACCEPTED', 'pe', 30),
            ],
        }).getChildren();

        const problems = rootChildren.slice(1);
        expect(problems.map(item => item.label)).toEqual([
            'A. A + B',
            'B. Binary Search',
            'C. Cycles',
            'D. Untouched',
            'E. First Try',
        ]);
        expect(problems.map(item => item.description)).toEqual([
            '',
            '2 attempts',
            'Judging…',
            '',
            '',
        ]);
        expect(problems.map(item => item.collapsibleState)).toEqual([1, 1, 2, 0, 1]);
        expect(problems.map(item => item.id)).toEqual([
            'problem:pa',
            'problem:pb',
            'problem:pc',
            'problem:pd',
            'problem:pe',
        ]);
        expect(problems[0]).toEqual(expect.objectContaining({
            contextValue: TREE_CONTEXT.PROBLEM,
            problem: expect.objectContaining({ publicId: 'pa' }),
        }));
        expect(problems[0].command).toBeUndefined();
        expect(problems[0].iconPath.toString()).toContain(encodeURIComponent('#ff0000'));
        expect(problems[0].tooltip).toContain('Problem A: A + B');
        expect(problems[0].tooltip).toContain('Solved in 2 attempts');
        expect(problems[0].tooltip).toContain('First accepted: ');
        expect(problems[0].tooltip).toContain('(40 min)');
        expect(problems.map(item => item.accessibilityInformation.label)).toEqual([
            'A. A + B, solved',
            'B. Binary Search, not solved, 2 attempts',
            'C. Cycles, not solved, Judging…',
            'D. Untouched, not solved',
            'E. First Try, solved',
        ]);
        expect(problems[1].tooltip).toContain('Not solved yet · 2 attempts');
        expect(problems[2].tooltip).toContain('Judging… 1 pending');
        expect(problems[3].tooltip).toContain('No submissions yet');
        expect(problems[4].tooltip).toContain('Solved in 1 attempt');
    });

    it('draws a filled outlined dot for solved problems and a hollow ring otherwise', () => {
        const provider = new ContestTreeProvider();
        const solved = decodeURIComponent(provider.createColoredCircleIcon('#f0f0f0', true).toString());
        const unsolved = decodeURIComponent(provider.createColoredCircleIcon('f0f0f0').toString());

        expect(solved).toMatch(/^data:image\/svg\+xml;utf8,<svg /);
        expect(solved).toContain('r="5.5" fill="#f0f0f0" stroke="#808080" stroke-opacity="0.6"');
        expect(solved).not.toContain('fill="none"');
        expect(unsolved).toContain('r="4.5" fill="none" stroke="#f0f0f0" stroke-width="2"');
        expect(unsolved).toContain('stroke="#808080" stroke-opacity="0.5"');
        expect(unsolved).not.toContain('fill="#f0f0f0"');
    });

    it('fills the problem icon only once the problem is solved', () => {
        const [, solved, attempted] = createProvider({
            problems: [
                { publicId: 'pa', order: 1, title: 'A + B', color: '#ff0000' },
                { publicId: 'pb', order: 2, title: 'Binary Search', color: '#00ff00' },
            ],
            submissions: [
                buildSubmission(1, 'ACCEPTED', 'pa', 10),
                buildSubmission(2, 'WRONG_ANSWER', 'pb', 12),
            ],
        }).getChildren();

        expect(decodeURIComponent(solved.iconPath.toString())).toContain('fill="#ff0000"');
        expect(decodeURIComponent(attempted.iconPath.toString())).toContain('fill="none" stroke="#00ff00"');
    });

    it('shows only Judging… and expands the problem while a later submission is judging', () => {
        const [, problem] = createProvider({
            problems: [{ publicId: 'pa', order: 1, title: 'A + B' }],
            submissions: [
                buildSubmission(1, 'ACCEPTED', 'pa', 10),
                buildSubmission(2, 'RUNNING', 'pa', 47),
            ],
        }).getChildren();

        expect(problem.description).toBe('Judging…');
        expect(problem.collapsibleState).toBe(2);
        expect(problem.id).toBe('problem:pa');
        expect(decodeURIComponent(problem.iconPath.toString())).toContain('r="5.5"');
        expect(problem.tooltip).toContain('Solved in 2 attempts');
    });

    it('expands a problem whose first submission is still judging and collapses it once judged', () => {
        const pending = createProvider({
            problems: [{ publicId: 'pa', order: 1, title: 'A + B' }],
            submissions: [buildSubmission(1, 'PENDING', 'pa', 47)],
        }).getChildren()[1];
        const judged = createProvider({
            problems: [{ publicId: 'pa', order: 1, title: 'A + B' }],
            submissions: [buildSubmission(1, 'WRONG_ANSWER', 'pa', 47)],
        }).getChildren()[1];

        expect([pending.collapsibleState, judged.collapsibleState]).toEqual([2, 1]);
        // Same id either way, so VS Code keeps the user's own expand state.
        expect(pending.id).toBe(judged.id);
        expect(judged.description).toBe('1 attempt');
    });

    it('labels a problem the same way in the explorer and on its page', () => {
        const problems = [{ publicId: 'pa', order: 1, name: 'Sum' }, { publicId: 'pb', order: 2 }];
        const rows = createProvider({ problems }).getChildren().slice(1);

        expect(rows.map(item => item.label)).toEqual(['A. Sum', 'B. Problem B']);
        expect(rows.map(item => item.label)).toEqual(problems.map(problem => getProblemPageName(problem, problems)));
    });

    it('survives problems without a title or color', () => {
        const provider = createProvider({
            problems: [{ publicId: 'pa', order: 1 }, { publicId: 'pb', order: 2, title: '   ' }],
        });
        const problems = provider.getChildren().slice(1);

        expect(problems.map(item => item.label)).toEqual(['A. Problem A', 'B. Problem B']);
        expect(problems[0].iconPath.toString()).toContain(encodeURIComponent('#00000000'));
        expect(provider.createColoredCircleIcon('not a color').toString()).toContain(encodeURIComponent('#00000000'));
    });

    it('renders submissions newest-first with status, relative time, stable ids, and a tooltip', () => {
        const provider = createProvider({
            problems: [{ publicId: 'pa', order: 1, title: 'A + B' }],
            submissions: [
                buildSubmission(11, 'WRONG_ANSWER', 'pa', 43, { score: 20 * MINUTE, filename: 'main.cpp', language: 'cpp' }),
                buildSubmission(12, 'ACCEPTED', 'pa', 46, { score: 46 * MINUTE }),
                buildSubmission(13, 'ACCEPTED', 'other', 47),
            ],
        });
        const [, problem] = provider.getChildren();
        const submissions = provider.getChildren(problem);

        expect(submissions.map(item => item.label)).toEqual(['#12', '#11']);
        expect(submissions[0]).toEqual(expect.objectContaining({
            id: 'submission:12',
            description: 'Accepted · 2 min ago',
            contextValue: TREE_CONTEXT.SUBMISSION,
            command: expect.objectContaining({
                command: COMMANDS.OPEN_SUBMISSION,
                arguments: [expect.objectContaining({ id: 12 })],
            }),
            submission: expect.objectContaining({ id: 12 }),
        }));
        expect(submissions[0].tooltip).toContain('Time: 46 min');
        expect(submissions[1].description).toBe('Wrong Answer · 5 min ago');
        expect(submissions[1].tooltip).toContain('#11 · Wrong Answer');
        expect(submissions[1].tooltip).toContain('Submitted: ');
        expect(submissions[1].tooltip).toContain('Penalty: 20 min');
        expect(submissions[1].tooltip).toContain('File: main.cpp');
        expect(submissions[1].tooltip).toContain('Language: cpp');
    });

    it('maps each verdict to an icon, using the failure color for time limits and a neutral icon for unknowns', () => {
        const statuses = ['ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'COMPILATION_ERROR', 'PARSING_ERROR', 'ERROR', 'PENDING', 'SOMETHING_NEW'];
        const provider = createProvider({
            problems: [{ publicId: 'pa', order: 1, title: 'A + B' }],
            submissions: statuses.map((status, index) => buildSubmission(index + 1, status, 'pa', 40 - index)),
        });
        const [, problem] = provider.getChildren();
        const icons = provider.getChildren(problem).map(item => [item.iconPath.id, item.iconPath.color?.id]);

        expect(icons).toEqual([
            ['pass-filled', 'testing.iconPassed'],
            ['error', 'testing.iconFailed'],
            ['watch', 'testing.iconFailed'],
            ['warning', 'testing.iconFailed'],
            ['warning', 'testing.iconFailed'],
            ['warning', 'testing.iconFailed'],
            ['warning', 'testing.iconFailed'],
            ['loading~spin', 'charts.yellow'],
            ['circle-outline', undefined],
        ]);
    });

    it('marks only submissions whose hint carries both expected and received output as comparable', () => {
        const provider = createProvider({
            problems: [{ publicId: 'pa', order: 1, title: 'A + B' }],
            submissions: [
                buildSubmission(1, 'WRONG_ANSWER', 'pa', 10, { hint: { expected: '3', received: '4' } }),
                buildSubmission(2, 'WRONG_ANSWER', 'pa', 9, { hint: { expected: '', received: '' } }),
                buildSubmission(3, 'WRONG_ANSWER', 'pa', 8, { hint: { expected: null, received: '4' } }),
                buildSubmission(4, 'WRONG_ANSWER', 'pa', 7, { hint: { expected: '3' } }),
                buildSubmission(5, 'WRONG_ANSWER', 'pa', 6, { hint: { message: 'nope', expected: null, received: null } }),
                buildSubmission(6, 'WRONG_ANSWER', 'pa', 5),
            ],
        });
        const [, problem] = provider.getChildren();

        expect(provider.getChildren(problem).map(item => item.contextValue)).toEqual([
            TREE_CONTEXT.SUBMISSION_WITH_OUTPUT,
            TREE_CONTEXT.SUBMISSION_WITH_OUTPUT,
            TREE_CONTEXT.SUBMISSION,
            TREE_CONTEXT.SUBMISSION,
            TREE_CONTEXT.SUBMISSION,
            TREE_CONTEXT.SUBMISSION,
        ]);
    });
});
