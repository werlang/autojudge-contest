import { describe, expect, it } from 'vitest';

import { COMMANDS, TREE_CONTEXT } from '../src/constants.js';
import { TeamsStandingsProvider } from '../src/providers/teams-tree-provider.js';

describe('teams standings provider', () => {
    it('renders teams sorted by descending score with solved counts from solvedProblemIds', () => {
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
                        scoreboardId: 'sb-bits-91cd',
                        name: 'Bits',
                        score: 200000,
                        solvedProblemIds: ['pa1b2c3d4e5f6'],
                    },
                    {
                        scoreboardId: 'sb-ninjas-7f3a',
                        name: 'Array Ninjas',
                        score: 350000,
                        solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'],
                    },
                ],
            },
            token: 'jwt-token',
        });

        expect(provider.getChildren()).toEqual([
            expect.objectContaining({
                command: expect.objectContaining({
                    command: COMMANDS.OPEN_TEAM_STANDING,
                }),
                contextValue: TREE_CONTEXT.STANDING_TEAM,
                description: '2 solved | 5.8 min',
                label: 'Array Ninjas',
            }),
            expect.objectContaining({
                contextValue: TREE_CONTEXT.STANDING_TEAM,
                description: '1 solved | 3.3 min',
                label: 'Bits',
            }),
        ]);
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
                        scoreboardId: 'sb-bits-91cd',
                        name: 'Bits',
                        score: 200000,
                        solvedProblems: [1],
                    },
                ],
            },
            token: 'jwt-token',
        });

        expect(provider.getChildren()).toEqual([
            expect.objectContaining({ description: '0 solved | 3.3 min', label: 'Bits' }),
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
                description: 'Refresh the contest to load the latest standings.',
                label: 'No team standings available',
            }),
        ]);
    });
});
