import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({
            get: (_key, fallbackValue) => fallbackValue,
        }),
    },
}), { virtual: true });

function createContext() {
    const secrets = new Map();
    const state = new Map();

    return {
        secrets: {
            async get(key) {
                return secrets.get(key);
            },
            async store(key, value) {
                secrets.set(key, value);
            },
            async delete(key) {
                secrets.delete(key);
            },
        },
        globalState: {
            get(key, fallbackValue = undefined) {
                return state.has(key) ? state.get(key) : fallbackValue;
            },
            async update(key, value) {
                if (value === undefined) {
                    state.delete(key);
                    return;
                }

                state.set(key, value);
            },
        },
    };
}

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

describe('contest session flow', () => {
    it('redeems the hand-off code, persists the session token, and loads the contest snapshot', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));

        const context = createContext();
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ token: 'team-jwt-token' }))
            .mockResolvedValueOnce(jsonResponse({
                team: {
                    publicId: 'tbits91cd0000',
                    name: 'Bits',
                    contest: {
                        publicId: 'k3m9x2p7q8w1a',
                        name: 'Regional Final',
                        description: 'Regional ICPC warm-up',
                        logo: 'regional-final.webp',
                    },
                },
            }))
            .mockResolvedValueOnce(jsonResponse({
                contest: {
                    publicId: 'k3m9x2p7q8w1a',
                    name: 'Regional Final',
                    duration: 180,
                    remainingTime: 90_000,
                    startTime: '2026-05-29T09:00:00.000Z',
                    teams: [
                        {
                            publicId: 'tbits91cd0000',
                            name: 'Bits',
                            score: 200,
                            solvedProblemIds: ['pa1b2c3d4e5f6'],
                        },
                        {
                            publicId: 'tninjas7f3a00',
                            name: 'Array Ninjas',
                            score: 350,
                            solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'],
                        },
                    ],
                },
            }))
            .mockResolvedValueOnce(jsonResponse({
                problems: [
                    { publicId: 'pa1b2c3d4e5f6', title: 'A + B', order: 1 },
                ],
            }))
            .mockResolvedValueOnce(jsonResponse({
                submissions: [
                    { id: 22, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' } },
                ],
            }));

        const session = await import('../src/services/contest-session.js');
        const result = await session.redeemAndLoadContest({
            baseUrl: 'https://api.autojudge.test/base',
            code: 'handoff-code-from-the-browser',
            context,
        });

        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.autojudge.test/base/teams/session/redeem', expect.objectContaining({
            body: JSON.stringify({ code: 'handoff-code-from-the-browser' }),
            method: 'POST',
            headers: expect.objectContaining({
                'Content-Type': 'application/json',
            }),
        }));
        expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.autojudge.test/base/teams', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.autojudge.test/base/contests/k3m9x2p7q8w1a', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(4, 'https://api.autojudge.test/base/contests/k3m9x2p7q8w1a/problems', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(5, 'https://api.autojudge.test/base/submissions', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(result).toEqual({
            problems: [
                { publicId: 'pa1b2c3d4e5f6', title: 'A + B', order: 1 },
            ],
            submissions: [
                { id: 22, status: 'PENDING', problem: { publicId: 'pa1b2c3d4e5f6', title: 'A + B' } },
            ],
            team: {
                publicId: 'tbits91cd0000',
                name: 'Bits',
                contest: {
                    description: 'Regional ICPC warm-up',
                    publicId: 'k3m9x2p7q8w1a',
                    logo: 'regional-final.webp',
                    name: 'Regional Final',
                },
            },
            contest: {
                description: 'Regional ICPC warm-up',
                duration: 180,
                publicId: 'k3m9x2p7q8w1a',
                name: 'Regional Final',
                logo: 'regional-final.webp',
                remainingTime: 90_000,
                startTime: '2026-05-29T09:00:00.000Z',
                teams: [
                    {
                        publicId: 'tbits91cd0000',
                        name: 'Bits',
                        score: 200,
                        solvedProblemIds: ['pa1b2c3d4e5f6'],
                    },
                    {
                        publicId: 'tninjas7f3a00',
                        name: 'Array Ninjas',
                        score: 350,
                        solvedProblemIds: ['pa1b2c3d4e5f6', 'pb2c3d4e5f6a1'],
                    },
                ],
            },
            contestNotStarted: false,
            token: 'team-jwt-token',
        });

        const storedSession = await session.readStoredSession(context);
        expect(storedSession).toEqual({
            token: 'team-jwt-token',
        });

        vi.useRealTimers();
    });

    it('keeps the saved token and rejects when restore gets a 401 that is not SESSION_ENDED', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, {
            token: 'expired-token',
        });

        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Invalid token.' }, 401));

        await expect(session.restoreContestSession({
            baseUrl: 'https://api.autojudge.test',
            context,
        })).rejects.toMatchObject({ message: 'Invalid token.', statusCode: 401 });

        expect(await session.readStoredSession(context)).toEqual({ token: 'expired-token' });
    });

    it('keeps the saved token when restore or a standings refresh gets a 400', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, { token: 'team-jwt-token' });

        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Bad request.' }, 400));
        await expect(session.restoreContestSession({
            baseUrl: 'https://api.autojudge.test',
            context,
        })).rejects.toMatchObject({ statusCode: 400 });

        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Bad request.' }, 400));
        await expect(session.refreshContestDetails({
            baseUrl: 'https://api.autojudge.test',
            contest: { publicId: 'k3m9x2p7q8w1a' },
            context,
        })).rejects.toMatchObject({ statusCode: 400 });

        expect(await session.readStoredSession(context)).toEqual({ token: 'team-jwt-token' });
    });

    it('does not store a token when the hand-off code is rejected', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        fetchMock.mockResolvedValueOnce(jsonResponse({
            code: 'HANDOFF_INVALID',
            message: 'This sign-in link is invalid or has expired.',
        }, 400));

        await expect(session.redeemAndLoadContest({
            baseUrl: 'https://api.autojudge.test',
            code: 'used-code',
            context,
        })).rejects.toMatchObject({ code: 'HANDOFF_INVALID', statusCode: 400 });

        expect(await session.readStoredSession(context)).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the session and marks the contest not started when problems are refused before the start', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, { token: 'team-jwt-token' });
        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                team: {
                    publicId: 'tbits91cd0000',
                    name: 'Bits',
                    contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
                },
            }))
            .mockResolvedValueOnce(jsonResponse({
                contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final', problems: [], startTime: '2026-05-29T09:00:00.000Z' },
            }))
            .mockResolvedValueOnce(jsonResponse({
                code: 'CONTEST_NOT_STARTED',
                message: 'The contest has not started yet.',
            }, 403))
            .mockResolvedValueOnce(jsonResponse({ submissions: [] }));

        const restored = await session.restoreContestSession({
            baseUrl: 'https://api.autojudge.test',
            context,
        });

        expect(restored).toMatchObject({
            contest: { name: 'Regional Final' },
            contestNotStarted: true,
            problems: [],
            submissions: [],
            token: 'team-jwt-token',
        });
        expect(await session.readStoredSession(context)).toEqual({ token: 'team-jwt-token' });
    });

    it('rejects a problems refusal that is not CONTEST_NOT_STARTED', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, { token: 'team-jwt-token' });
        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                team: { publicId: 'tbits91cd0000', name: 'Bits', contest: { publicId: 'k3m9x2p7q8w1a' } },
            }))
            .mockResolvedValueOnce(jsonResponse({ contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' } }))
            .mockResolvedValueOnce(jsonResponse({ code: 'FORBIDDEN', message: 'Not allowed.' }, 403))
            .mockResolvedValueOnce(jsonResponse({ submissions: [] }));

        await expect(session.restoreContestSession({
            baseUrl: 'https://api.autojudge.test',
            context,
        })).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
        expect(await session.readStoredSession(context)).toEqual({ token: 'team-jwt-token' });
    });

    it('keeps the stored token and returns the current contest when a standings refresh is refused before the start', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, { token: 'team-jwt-token' });
        fetchMock.mockResolvedValueOnce(jsonResponse({
            code: 'CONTEST_NOT_STARTED',
            message: 'The contest has not started yet.',
        }, 403));

        const contest = { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' };
        await expect(session.refreshContestDetails({
            baseUrl: 'https://api.autojudge.test',
            contest,
            context,
        })).resolves.toBe(contest);
        expect(await session.readStoredSession(context)).toEqual({ token: 'team-jwt-token' });
    });

    it('reports SESSION_ENDED on restore so the caller can clear the token and tell the user', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, { token: 'old-token' });
        fetchMock.mockResolvedValueOnce(jsonResponse({
            code: 'SESSION_ENDED',
            message: 'Your team session has ended. Log in again.',
        }, 401));

        await expect(session.restoreContestSession({
            baseUrl: 'https://api.autojudge.test',
            context,
        })).rejects.toMatchObject({ code: 'SESSION_ENDED', statusCode: 401 });
    });

    it('reports SESSION_ENDED on a standings refresh instead of returning null', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, { token: 'old-token' });
        fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'SESSION_ENDED', message: 'ended' }, 401));

        await expect(session.refreshContestDetails({
            baseUrl: 'https://api.autojudge.test',
            contest: { publicId: 'k3m9x2p7q8w1a' },
            context,
        })).rejects.toMatchObject({ code: 'SESSION_ENDED' });
    });

    it('submits a solution with the stored contest token', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, {
            token: 'team-jwt-token',
        });

        fetchMock.mockResolvedValueOnce(jsonResponse({
            submission: {
                id: 31,
                status: 'PENDING',
            },
        }, 201));

        const result = await session.submitSolution({
            baseUrl: 'https://api.autojudge.test/base',
            code: 'print("hi")\n',
            context,
            filename: 'main.py',
            problemId: 'pa1b2c3d4e5f6',
        });

        expect(fetchMock).toHaveBeenCalledWith('https://api.autojudge.test/base/problems/pa1b2c3d4e5f6/judge', expect.objectContaining({
            body: JSON.stringify({
                code: 'print("hi")\n',
                filename: 'main.py',
                problemId: 'pa1b2c3d4e5f6',
            }),
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
                'Content-Type': 'application/json',
            }),
            method: 'POST',
        }));
        expect(result).toEqual({
            id: 31,
            status: 'PENDING',
        });
    });

    it('polls submission history until the created submission reaches a final verdict', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));

        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, {
            token: 'team-jwt-token',
        });

        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                submissions: [
                    { id: 31, status: 'PENDING' },
                ],
            }))
            .mockResolvedValueOnce(jsonResponse({
                submissions: [
                    { id: 31, status: 'RUNNING' },
                ],
            }))
            .mockResolvedValueOnce(jsonResponse({
                submissions: [
                    { id: 31, status: 'ACCEPTED' },
                ],
            }));

        const pollPromise = session.pollSubmissionResult({
            baseUrl: 'https://api.autojudge.test/base',
            context,
            pollIntervalMs: 1000,
            submissionId: 31,
            timeoutMs: 3000,
        });

        await vi.advanceTimersByTimeAsync(2000);

        await expect(pollPromise).resolves.toEqual({
            id: 31,
            status: 'ACCEPTED',
        });
        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.autojudge.test/base/submissions', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.autojudge.test/base/submissions', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.autojudge.test/base/submissions', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));

        vi.useRealTimers();
    });

    it('returns null when submission polling reaches the timeout without a final verdict', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));

        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, {
            token: 'team-jwt-token',
        });

        fetchMock.mockResolvedValue(jsonResponse({
            submissions: [
                { id: 31, status: 'PENDING' },
            ],
        }));

        const pollPromise = session.pollSubmissionResult({
            baseUrl: 'https://api.autojudge.test/base',
            context,
            pollIntervalMs: 1000,
            submissionId: 31,
            timeoutMs: 2000,
        });

        await vi.advanceTimersByTimeAsync(2000);

        await expect(pollPromise).resolves.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });
});
describe('contest route ids', () => {
    it('loads contest routes through the public id', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                team: {
                    publicId: 'tbits91cd0000',
                    name: 'Bits',
                    contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
                },
            }))
            .mockResolvedValueOnce(jsonResponse({ contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' } }))
            .mockResolvedValueOnce(jsonResponse({ problems: [{ publicId: 'pa1b2c3d4e5f6', title: 'A + B', order: 1 }] }))
            .mockResolvedValueOnce(jsonResponse({ submissions: [] }));

        const session = await import('../src/services/contest-session.js');
        const snapshot = await session.loadContestSnapshot({
            baseUrl: 'https://api.autojudge.test',
            token: 'team-jwt-token',
        });

        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.autojudge.test/contests/k3m9x2p7q8w1a', expect.anything());
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.autojudge.test/contests/k3m9x2p7q8w1a/problems', expect.anything());
        expect(snapshot.problems).toEqual([{ publicId: 'pa1b2c3d4e5f6', title: 'A + B', order: 1 }]);
    });

    it('refreshes contest details through the public id', async () => {
        const session = await import('../src/services/contest-session.js');
        const context = createContext();
        await session.writeStoredSession(context, { token: 'team-jwt-token' });

        fetchMock.mockResolvedValueOnce(jsonResponse({ contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final', duration: 180 } }));
        await session.refreshContestDetails({
            baseUrl: 'https://api.autojudge.test',
            contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
            context,
        });
        expect(fetchMock).toHaveBeenLastCalledWith('https://api.autojudge.test/contests/k3m9x2p7q8w1a', expect.anything());
    });
});
