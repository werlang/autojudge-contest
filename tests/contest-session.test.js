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
    it('logs a team in, persists the session token, and loads the contest snapshot', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));

        const context = createContext();
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ token: 'team-jwt-token' }))
            .mockResolvedValueOnce(jsonResponse({
                team: {
                    id: 9,
                    hash: 'teamhash9',
                    name: 'Bits',
                    contest: {
                        id: 4,
                        name: 'Regional Final',
                        description: 'Regional ICPC warm-up',
                        logo: 'regional-final.webp',
                    },
                },
            }))
            .mockResolvedValueOnce(jsonResponse({
                contest: {
                    id: 4,
                    name: 'Regional Final',
                    duration: 180,
                    remainingTime: 90_000,
                    startTime: '2026-05-29T09:00:00.000Z',
                    teams: [
                        {
                            id: 9,
                            name: 'Bits',
                            score: 200,
                            problems: [
                                { id: 1, order: 1, solved: true, title: 'A + B' },
                            ],
                        },
                        {
                            id: 12,
                            name: 'Array Ninjas',
                            score: 350,
                            problems: [
                                { id: 1, order: 1, solved: true, title: 'A + B' },
                                { id: 2, order: 2, solved: true, title: 'Binary Search' },
                            ],
                        },
                    ],
                },
            }))
            .mockResolvedValueOnce(jsonResponse({
                problems: [
                    { id: 1, hash: 'prob-a', title: 'A + B', order: 1 },
                ],
            }))
            .mockResolvedValueOnce(jsonResponse({
                submissions: [
                    { id: 22, status: 'PENDING', problem: { id: 1, title: 'A + B' } },
                ],
            }));

        const session = await import('../src/services/contest-session.js');
        const result = await session.loginAndLoadContest({
            baseUrl: 'https://api.autojudge.test/base',
            context,
            password: '123456',
            teamId: 'teamhash9',
        });

        expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.autojudge.test/base/teams/teamhash9/login', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                Authorization: 'Bearer 123456',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.autojudge.test/base/teams', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.autojudge.test/base/contests/4', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer team-jwt-token',
            }),
        }));
        expect(fetchMock).toHaveBeenNthCalledWith(4, 'https://api.autojudge.test/base/contests/4/problems', expect.objectContaining({
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
                { id: 1, hash: 'prob-a', title: 'A + B', order: 1 },
            ],
            submissions: [
                { id: 22, status: 'PENDING', problem: { id: 1, title: 'A + B' } },
            ],
            team: {
                id: 9,
                hash: 'teamhash9',
                name: 'Bits',
                contest: {
                    description: 'Regional ICPC warm-up',
                    id: 4,
                    logo: 'regional-final.webp',
                    name: 'Regional Final',
                },
            },
            contest: {
                description: 'Regional ICPC warm-up',
                duration: 180,
                id: 4,
                name: 'Regional Final',
                logo: 'regional-final.webp',
                remainingTime: 90_000,
                startTime: '2026-05-29T09:00:00.000Z',
                teams: [
                    {
                        id: 9,
                        name: 'Bits',
                        score: 200,
                        problems: [
                            { id: 1, order: 1, solved: true, title: 'A + B' },
                        ],
                    },
                    {
                        id: 12,
                        name: 'Array Ninjas',
                        score: 350,
                        problems: [
                            { id: 1, order: 1, solved: true, title: 'A + B' },
                            { id: 2, order: 2, solved: true, title: 'Binary Search' },
                        ],
                    },
                ],
            },
            token: 'team-jwt-token',
        });

        const storedSession = await session.readStoredSession(context);
        expect(storedSession).toEqual({
            teamId: 'teamhash9',
            token: 'team-jwt-token',
        });

        vi.useRealTimers();
    });

    it('clears an invalid saved session instead of keeping a broken token around', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, {
            teamId: 'ghost-team',
            token: 'expired-token',
        });

        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Invalid token.' }, 401));

        const restored = await session.restoreContestSession({
            baseUrl: 'https://api.autojudge.test',
            context,
        });

        expect(restored).toBeNull();
        expect(await session.readStoredSession(context)).toBeNull();
    });

    it('submits a solution with the stored contest token', async () => {
        const context = createContext();
        const session = await import('../src/services/contest-session.js');

        await session.writeStoredSession(context, {
            teamId: 'teamhash9',
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
            problemId: 1,
        });

        expect(fetchMock).toHaveBeenCalledWith('https://api.autojudge.test/base/problems/1/judge', expect.objectContaining({
            body: JSON.stringify({
                code: 'print("hi")\n',
                filename: 'main.py',
                problemId: 1,
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
            teamId: 'teamhash9',
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
            teamId: 'teamhash9',
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
    it('loads contest routes through the public id when the server returns one', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({
                team: {
                    id: 9,
                    name: 'Bits',
                    contest: { id: 4, publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
                },
            }))
            .mockResolvedValueOnce(jsonResponse({ contest: { id: 4, publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' } }))
            .mockResolvedValueOnce(jsonResponse({ problems: [{ id: 1, publicId: 'p1a2b3c4d5e6f', title: 'A + B', order: 1 }] }))
            .mockResolvedValueOnce(jsonResponse({ submissions: [] }));

        const session = await import('../src/services/contest-session.js');
        const snapshot = await session.loadContestSnapshot({
            baseUrl: 'https://api.autojudge.test',
            token: 'team-jwt-token',
        });

        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.autojudge.test/contests/k3m9x2p7q8w1a', expect.anything());
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.autojudge.test/contests/k3m9x2p7q8w1a/problems', expect.anything());
        expect(snapshot.problems).toEqual([{ id: 1, publicId: 'p1a2b3c4d5e6f', title: 'A + B', order: 1 }]);
    });

    it('falls back to the numeric contest id for servers that do not return a public id', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ team: { id: 9, name: 'Bits', contest: { id: 4, name: 'Regional Final' } } }))
            .mockResolvedValueOnce(jsonResponse({ contest: { id: 4, name: 'Regional Final' } }))
            .mockResolvedValueOnce(jsonResponse({ problems: [] }))
            .mockResolvedValueOnce(jsonResponse({ submissions: [] }));

        const session = await import('../src/services/contest-session.js');
        await session.loadContestSnapshot({
            baseUrl: 'https://api.autojudge.test',
            token: 'team-jwt-token',
        });

        expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.autojudge.test/contests/4', expect.anything());
        expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.autojudge.test/contests/4/problems', expect.anything());
    });

    it('refreshes contest details through the public id and keeps the numeric id for older servers', async () => {
        const session = await import('../src/services/contest-session.js');
        const context = createContext();
        await session.writeStoredSession(context, { teamId: 'k3m9x2p7q8w1a', token: 'team-jwt-token' });

        fetchMock.mockResolvedValueOnce(jsonResponse({ contest: { id: 4, name: 'Regional Final', duration: 180 } }));
        await session.refreshContestDetails({
            baseUrl: 'https://api.autojudge.test',
            contest: { id: 4, publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
            context,
        });
        expect(fetchMock).toHaveBeenLastCalledWith('https://api.autojudge.test/contests/k3m9x2p7q8w1a', expect.anything());

        fetchMock.mockResolvedValueOnce(jsonResponse({ contest: { id: 4, name: 'Regional Final', duration: 180 } }));
        await session.refreshContestDetails({
            baseUrl: 'https://api.autojudge.test',
            contest: { id: 4, name: 'Regional Final' },
            context,
        });
        expect(fetchMock).toHaveBeenLastCalledWith('https://api.autojudge.test/contests/4', expect.anything());
    });
});
