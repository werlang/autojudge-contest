import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTeamCode, loginTeam, normalizeTeamCode } from '../src/services/contest-api.js';

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

    it('returns an empty string for blank or missing input', () => {
        expect(normalizeTeamCode('   ')).toBe('');
        expect(normalizeTeamCode(undefined)).toBe('');
    });
});

describe('isTeamCode', () => {
    it('accepts a 13-character public id once trimmed and lowercased', () => {
        expect(isTeamCode('k3m9x2p7q8w1a')).toBe(true);
        expect(isTeamCode('  K3M9X2P7Q8W1A ')).toBe(true);
    });

    it('rejects the legacy six-character team hash', () => {
        expect(isTeamCode('ab12cd')).toBe(false);
        expect(isTeamCode(' AB12CD ')).toBe(false);
    });

    it('rejects codes that are not exactly 13 letters or digits', () => {
        expect(isTeamCode('k3m9x2p7q8w1')).toBe(false);
        expect(isTeamCode('k3m9x2p7q8w1ab')).toBe(false);
        expect(isTeamCode('k3m9x2p7-8w1a')).toBe(false);
        expect(isTeamCode('k3m9x2p7q8w1é')).toBe(false);
        expect(isTeamCode('')).toBe(false);
        expect(isTeamCode(undefined)).toBe(false);
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

    it('rejects a legacy six-character team hash without contacting the server', async () => {
        await expect(loginTeam({
            baseUrl: 'https://api.autojudge.test',
            password: '123456',
            teamId: 'ab12cd',
        })).rejects.toThrow('Enter the 13-character team code');

        expect(fetchMock).not.toHaveBeenCalled();
    });
});
