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
}), { virtual: true });

import { COMMANDS, TREE_CONTEXT } from '../src/constants.js';
import { TeamsStandingsProvider } from '../src/providers/teams-tree-provider.js';

describe('teams standings provider', () => {
    it('renders teams ranked by solved count then lower total time, with the logged-in team highlighted from solvedProblemIds', () => {
        const provider = new TeamsStandingsProvider();

        provider.setSnapshot({
            problems: [],
            submissions: [],
            team: {
                contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
                name: 'Bits',
                publicId: 'tbits91cd0000',
            },
            contest: {
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
                problems: [{ publicId: 'pa1b2c3d4e5f6' }, { publicId: 'pb2c3d4e5f6a1' }],
                teams: [
                    {
                        publicId: 'tbits91cd0000',
                        name: 'Bits',
                        score: 200000,
                        solvedProblemIds: ['pa1b2c3d4e5f6'],
                    },
                    {
                        publicId: 'tninjas7f3a00',
                        name: 'Array Ninjas',
                        score: 350000,
                        solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'],
                    },
                ],
            },
            token: 'jwt-token',
        });

        const rows = provider.getChildren();

        expect(rows).toEqual([
            expect.objectContaining({
                command: expect.objectContaining({
                    command: COMMANDS.OPEN_TEAM_STANDING,
                }),
                contextValue: TREE_CONTEXT.STANDING_TEAM,
                description: '2 solved \u00b7 5.8 min',
                id: 'team:tninjas7f3a00',
                label: '1. Array Ninjas',
            }),
            expect.objectContaining({
                contextValue: TREE_CONTEXT.STANDING_TEAM,
                description: '1 solved \u00b7 3.3 min (you)',
                id: 'team:tbits91cd0000',
                label: '2. Bits',
                tooltip: 'Rank 2 \u00b7 1 of 2 problems solved \u00b7 3.3 min total time \u00b7 your team',
            }),
        ]);
        expect(rows[0].iconPath).toMatchObject({ id: 'person' });
        expect(rows[1].iconPath).toMatchObject({ id: 'star-full', color: { id: 'charts.yellow' } });
    });

    it('does not count a legacy numeric solvedProblems list as solved problems', () => {
        const provider = new TeamsStandingsProvider();

        provider.setSnapshot({
            problems: [],
            submissions: [],
            team: {
                contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
                name: 'Bits',
            },
            contest: {
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
                teams: [
                    {
                        publicId: 'tbits91cd0000',
                        name: 'Bits',
                        score: 200000,
                        solvedProblems: [1],
                    },
                ],
            },
            token: 'jwt-token',
        });

        expect(provider.getChildren()).toEqual([
            expect.objectContaining({ description: '0 solved \u00b7 3.3 min', label: '1. Bits' }),
        ]);
    });

    it('returns a placeholder row when the contest snapshot has no standings data', () => {
        const provider = new TeamsStandingsProvider();

        provider.setSnapshot({
            problems: [],
            submissions: [],
            team: {
                contest: {
                    publicId: 'k3m9x2p7q8w1a',
                    name: 'Regional Final',
                },
                name: 'Bits',
            },
            contest: {
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
            },
            token: 'jwt-token',
        });

        expect(provider.getChildren()).toEqual([
            expect.objectContaining({
                description: 'They appear once teams join the contest',
                label: 'No standings yet',
            }),
        ]);
    });

    it('shows a non-clickable frozen row first while the scoreboard is frozen', () => {
        const provider = new TeamsStandingsProvider();

        provider.setSnapshot({
            team: { publicId: 'tnone0000000' },
            contest: {
                frozenScoreboard: true,
                teams: [{ publicId: 'tbits91cd0000', name: 'Bits', score: 1000 }],
            },
        });

        const rows = provider.getChildren();

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            description: 'final results appear after the contest',
            label: 'Scoreboard frozen',
        });
        expect(rows[0].command).toBeUndefined();
        expect(rows[0].iconPath).toMatchObject({ id: 'lock' });
        expect(rows[1].label).toBe('1. Bits');
        expect(rows[1].description).not.toContain('(you)');
    });

    it('omits the row id when no publicId exists so duplicate teams cannot collide', () => {
        const provider = new TeamsStandingsProvider();

        provider.setSnapshot({ contest: { teams: [{ name: 'Bits', score: 0 }, { name: 'Bits', score: 0 }, { score: 1 }, { score: 2 }] } });

        const rows = provider.getChildren();
        expect(rows).toHaveLength(4);
        expect(rows[0]).toMatchObject({ tooltip: expect.stringContaining('0 solved') });
        for (const row of rows) {
            expect(row.id).toBeUndefined();
        }
    });

    it('repeats the rank number for tied teams in the label', () => {
        const provider = new TeamsStandingsProvider();

        provider.setSnapshot({
            contest: {
                teams: [
                    { publicId: 'ta', name: 'Alpha', score: 100, solvedProblemIds: ['p1'] },
                    { publicId: 'tb', name: 'Beta', score: 100, solvedProblemIds: ['p1'] },
                    { publicId: 'tc', name: 'Gamma', score: 200, solvedProblemIds: ['p1'] },
                ],
            },
        });

        expect(provider.getChildren().map(row => row.label)).toEqual(['1. Alpha', '1. Beta', '3. Gamma']);
    });
});
