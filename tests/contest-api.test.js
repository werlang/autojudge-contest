import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginTeam, normalizeTeamCode } from '../src/services/contest-api.js';

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        async json() {
            return { token: 'team-jwt-token' };
        },
    });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('normalizeTeamCode', () => {
    it('trims whitespace and lowercases a team public id', () => {
        expect(normalizeTeamCode('  K3M9X2P7Q8W1A\n')).toBe('k3m9x2p7q8w1a');
    });

    it('lowercases the legacy six-character team hash', () => {
        expect(normalizeTeamCode('AB12CD')).toBe('ab12cd');
    });

    it('returns an empty string for blank or missing input', () => {
        expect(normalizeTeamCode('   ')).toBe('');
        expect(normalizeTeamCode(undefined)).toBe('');
    });
});

describe('loginTeam', () => {
    it('posts the normalized team code to the login route', async () => {
        await loginTeam({
            baseUrl: 'https://api.autojudge.test',
            password: '123456',
            teamId: ' K3M9X2P7Q8W1A ',
        });

        expect(fetchMock).toHaveBeenCalledWith('https://api.autojudge.test/teams/k3m9x2p7q8w1a/login', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                Authorization: 'Bearer 123456',
            }),
        }));
    });
});
