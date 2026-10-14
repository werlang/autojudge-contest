import { describe, expect, it, vi } from 'vitest';

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

describe('VS Code contest session storage', () => {
    it('stores only the token, in secrets, and writes nothing to global state', async () => {
        const context = createContext();
        const store = await import('../src/services/session-store.js');
        const update = vi.spyOn(context.globalState, 'update');

        await store.writeStoredSession(context, { token: 'jwt-value' });

        expect(await store.readStoredSession(context)).toEqual({ token: 'jwt-value' });
        expect(update).not.toHaveBeenCalled();
    });

    it('reads no session when no token is stored', async () => {
        const store = await import('../src/services/session-store.js');

        expect(await store.readStoredSession(createContext())).toBeNull();
    });

    it('forgets the token and the legacy metadata when the session is cleared', async () => {
        const context = createContext();
        const store = await import('../src/services/session-store.js');

        await context.globalState.update('autojudgeContest.session', { teamId: 'abc123' });
        await store.writeStoredSession(context, { token: 'jwt-value' });
        await store.clearStoredSession(context);

        expect(await store.readStoredSession(context)).toBeNull();
        expect(context.globalState.get('autojudgeContest.session')).toBeUndefined();
    });
});
