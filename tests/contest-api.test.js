import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVALID_SETTING_CODE, REQUEST_TIMEOUT_CODE, REQUEST_TIMEOUT_MS, SUBMIT_TIMEOUT_MS, getSubmissions, isSessionEnded, normalizeBaseUrl, redeemHandoffCode, submitSolution } from '../src/services/contest-api.js';

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
    vi.restoreAllMocks();
});

/**
 * Make fetch hang until its signal aborts, then reject like fetch does.
 */
function hangUntilAborted() {
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
}

describe('request timeout', () => {
    it('rejects a hung request with a clear message once the timeout fires', async () => {
        const timeout = new AbortController();
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
        hangUntilAborted();

        const request = getSubmissions({ baseUrl: 'https://api.autojudge.test', token: 't' });
        timeout.abort();

        await expect(request).rejects.toThrow('The AutoJudge server did not respond in time.');
        expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
        expect(REQUEST_TIMEOUT_MS).toBe(20000);
    });

    it('gives a solution upload the longer timeout and codes its timeout error', async () => {
        const timeout = new AbortController();
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
        hangUntilAborted();

        const request = submitSolution({ baseUrl: 'https://api.autojudge.test', code: 'Yw==', filename: 'a.c', problemId: 'p1', token: 't' });
        timeout.abort();

        await expect(request).rejects.toMatchObject({ code: REQUEST_TIMEOUT_CODE });
        expect(timeoutSpy).toHaveBeenCalledWith(SUBMIT_TIMEOUT_MS);
        expect(SUBMIT_TIMEOUT_MS).toBe(60000);
    });

    it('keeps the caller abort error when the caller signal aborts first', async () => {
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
        hangUntilAborted();
        const caller = new AbortController();

        const request = getSubmissions({ baseUrl: 'https://api.autojudge.test', token: 't', signal: caller.signal });
        caller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('response body read', () => {
    it('rejects with the timeout error when the timeout fires while the body is still being read', async () => {
        const timeout = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
        fetchMock.mockImplementation(async (_url, { signal }) => ({
            ok: true,
            status: 200,
            json: () => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
            }),
        }));

        const request = getSubmissions({ baseUrl: 'https://api.autojudge.test', token: 't' });
        await Promise.resolve();
        timeout.abort();

        await expect(request).rejects.toThrow('The AutoJudge server did not respond in time.');
    });

    it('still treats an unparsable body as an empty payload', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError('Unexpected end of JSON input');
            },
        });

        await expect(getSubmissions({ baseUrl: 'https://api.autojudge.test', token: 't' })).resolves.toEqual({});
    });
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
            signal: expect.any(AbortSignal),
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


describe('normalizeBaseUrl', () => {
    it('keeps a base path and ends with exactly one slash', () => {
        expect(normalizeBaseUrl(' https://api.autojudge.test ')).toBe('https://api.autojudge.test/');
        expect(normalizeBaseUrl('http://localhost:3000/api///')).toBe('http://localhost:3000/api/');
    });

    it.each(['', '   ', undefined, 'not a url', 'ftp://example.test', 'file:///etc/passwd'])(
        'throws an INVALID_SETTING error for %j',
        (value) => {
            let error;
            try {
                normalizeBaseUrl(value);
            }
            catch (caught) {
                error = caught;
            }

            expect(error.message).toBe('The autojudgeContest.baseUrl setting is not a valid http(s) URL. Fix it in Settings.');
            expect(error.code).toBe(INVALID_SETTING_CODE);
            expect(error.code).toBe('INVALID_SETTING');
            expect(error.setting).toBe('autojudgeContest.baseUrl');
        },
    );
});
