import { describe, expect, it } from 'vitest';

import { resolveStandingTeams } from '../src/utils/standings.js';

describe('resolveStandingTeams', () => {
    it('orders by solved count desc, then total time asc, then name', () => {
        const teams = resolveStandingTeams({
            teams: [
                { publicId: 'a', name: 'Slow', score: 900, solvedProblemIds: ['p1', 'p2'] },
                { publicId: 'b', name: 'Zero', score: 0 },
                { publicId: 'c', name: 'Fast', score: 100, solvedProblemIds: ['p1', 'p2'] },
                { publicId: 'd', name: 'Beta', score: 500, solvedProblemIds: ['p1'] },
                { publicId: 'e', name: 'Alpha', score: 500, solvedProblemIds: ['p3'] },
            ],
        });

        expect(teams.map(team => team.name)).toEqual(['Fast', 'Slow', 'Alpha', 'Beta', 'Zero']);
    });

    it('assigns standard competition ranks and shares them on ties', () => {
        const teams = resolveStandingTeams({
            teams: [
                { name: 'C', score: 300, solvedProblemIds: ['p1'] },
                { name: 'A', score: 100, solvedProblemIds: ['p1'] },
                { name: 'B', score: 100, solvedProblemIds: ['p1'] },
                { name: 'D', score: 0 },
            ],
        });

        expect(teams.map(team => [team.name, team.rank])).toEqual([['A', 1], ['B', 1], ['C', 3], ['D', 4]]);
    });

    it('keeps the original team fields and returns an empty list without teams', () => {
        const [team] = resolveStandingTeams({ teams: [{ publicId: 'x', name: ' Bits ', score: '5' }] });

        expect(team).toMatchObject({ publicId: 'x', name: 'Bits', score: 5, rank: 1 });
        expect(resolveStandingTeams(null)).toEqual([]);
    });
});
