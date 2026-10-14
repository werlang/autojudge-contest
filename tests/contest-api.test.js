import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSessionEnded, redeemHandoffCode } from '../src/services/contest-api.js';

const fetchMock = vi.fn();

/**
 * Build a minimal fetch response.
 * @param {object} payload
 * @param {number} [status]
 * @returns {object}
 */
function jsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return payload;
        },
    };
}

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('redeemHandoffCode', () => {
    it('posts the code as JSON to the redeem route without an Authorization header', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ token: 'team-jwt-token' }));

        const result = await redeemHandoffCode({
            baseUrl: 'https://api.autojudge.test',
            code: 'abc_DEF-123',
        });

        expect(result).toEqual({ token: 'team-jwt-token' });
        expect(fetchMock).toHaveBeenCalledWith('https://api.autojudge.test/teams/session/redeem', {
            body: JSON.stringify({ code: 'abc_DEF-123' }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: undefined,
        });
    });

    it('surfaces HANDOFF_INVALID with its status and server message', async () => {
        fetchMock.mockResolvedValue(jsonResponse({
            code: 'HANDOFF_INVALID',
            message: 'This sign-in link is invalid or has expired.',
        }, 400));

        await expect(redeemHandoffCode({
            baseUrl: 'https://api.autojudge.test',
            code: 'used',
        })).rejects.toMatchObject({
            code: 'HANDOFF_INVALID',
            message: 'This sign-in link is invalid or has expired.',
            statusCode: 400,
        });
    });
});

describe('isSessionEnded', () => {
    it('recognizes a 401 with the SESSION_ENDED code', () => {
        expect(isSessionEnded({ statusCode: 401, code: 'SESSION_ENDED' })).toBe(true);
    });

    it('ignores other 401s, other codes and non-errors', () => {
        expect(isSessionEnded({ statusCode: 401, code: 'UNAUTHORIZED' })).toBe(false);
        expect(isSessionEnded({ statusCode: 400, code: 'SESSION_ENDED' })).toBe(false);
        expect(isSessionEnded(new Error('boom'))).toBe(false);
        expect(isSessionEnded(undefined)).toBe(false);
    });
});
