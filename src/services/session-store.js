const TOKEN_SECRET_KEY = 'autojudgeContest.teamToken';
// Older versions kept the team id here next to the token. It is no longer
// written, but clearing a session still removes it from existing installs.
const LEGACY_SESSION_METADATA_KEY = 'autojudgeContest.session';

/**
 * Persist the team session token in VS Code secret storage. Nothing about the
 * session is kept in plain global state.
 * @param {import('vscode').ExtensionContext | { secrets: object, globalState: object }} context
 * @param {{ token: string }} session
 * @returns {Promise<void>}
 */
export async function writeStoredSession(context, session) {
    await context.secrets.store(TOKEN_SECRET_KEY, session.token);
}

/**
 * Read the persisted team session from VS Code secret storage.
 * @param {import('vscode').ExtensionContext | { secrets: object, globalState: object }} context
 * @returns {Promise<{ token: string } | null>}
 */
export async function readStoredSession(context) {
    const token = await context.secrets.get(TOKEN_SECRET_KEY);

    return token ? { token } : null;
}

/**
 * Forget the persisted token. This only affects this editor: the team session on
 * the server (and in the browser) stays active.
 * @param {import('vscode').ExtensionContext | { secrets: object, globalState: object }} context
 * @returns {Promise<void>}
 */
export async function clearStoredSession(context) {
    await context.secrets.delete(TOKEN_SECRET_KEY);
    await context.globalState.update(LEGACY_SESSION_METADATA_KEY, undefined);
}
