import * as vscode from 'vscode';
import { createContestController, logToChannel } from '../controllers/contest-controller.js';
import { COMMANDS, CONTEST_VIEW_ID } from '../constants.js';
import * as contestSession from '../services/contest-session.js';
import { AUTH_URI_PATH, BrowserLogin } from '../services/browser-login.js';
import { ContestSubmissionWorkspace } from '../workspace/contest-submission-workspace.js';
import { getBaseUrl, getPollIntervalMs, resolveWebUrl } from '../utils/config.js';

/**
 * Create the explorer reveal used after a submit: expands the problem and
 * scrolls the new submission row into view without stealing selection or
 * focus. It does nothing while the explorer is hidden (VS Code would ignore
 * or queue the reveal) and swallows reveal errors into a debug log line.
 * @param {object} options
 * @param {{ visible?: boolean, reveal?: Function } | null} options.treeView Contest Explorer view
 * @param {{ findSubmissionItem: (submissionId: string | number) => object | undefined }} options.treeProvider
 * @param {import('vscode').LogOutputChannel | import('vscode').OutputChannel} options.outputChannel
 * @returns {(submissionId: string | number) => Promise<void>}
 */
export function createSubmissionReveal({ treeView, treeProvider, outputChannel }) {
    return async (submissionId) => {
        if (!treeView?.visible) {
            return;
        }

        try {
            const item = treeProvider.findSubmissionItem?.(submissionId);
            if (item) {
                await treeView.reveal(item, { select: false, focus: false, expand: true });
            }
        }
        catch (error) {
            logToChannel(outputChannel, 'debug', `Could not reveal submission #${submissionId}: ${error?.message ?? error}`);
        }
    };
}

/**
 * Register contest commands and keep the multi-step contest behavior inside the
 * controller rather than in VS Code command glue.
 * @param {object} options
 * @param {import('vscode').ExtensionContext} options.context
 * @param {import('../providers/teams-tree-provider.js').TeamsStandingsProvider} options.teamsStandingsProvider
 * @param {import('../providers/contest-tree-provider.js').ContestTreeProvider} options.treeProvider
 * @param {import('vscode').LogOutputChannel | import('vscode').OutputChannel} options.outputChannel
 * @param {import('../providers/contest-status-bar.js').ContestStatusBar} [options.statusBar]
 * @param {import('vscode').TreeView<unknown>} [options.treeView] Contest Explorer view, for visibility-based re-renders
 * @param {import('vscode').TreeView<unknown>} [options.teamsView] Standings view, for the visibility-based refresh cadence
 * @returns {import('vscode').Disposable[]}
 */
export function registerContestCommands({
    context,
    teamsStandingsProvider,
    treeProvider,
    outputChannel,
    statusBar = null,
    treeView = null,
    teamsView = null,
}) {
    const submissionWorkspace = new ContestSubmissionWorkspace();
    const browserLogin = new BrowserLogin({
        openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
        resolveWebUrl,
    });
    const controller = createContestController({
        browserLogin,
        context,
        executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
        openTextDocument: (uriOrPath) => vscode.workspace.openTextDocument(uriOrPath),
        showTextDocument: (document, options) => vscode.window.showTextDocument(document, options),
        outputChannel,
        resolveBaseUrl: () => getBaseUrl(),
        resolvePollIntervalMs: () => getPollIntervalMs(),
        resolveConfirmBeforeSubmit: () => vscode.workspace
            .getConfiguration('autojudgeContest')
            .get('confirmBeforeSubmit', true) !== false,
        sessionApi: contestSession,
        setContext: (key, value) => vscode.commands.executeCommand('setContext', key, value),
        // Each message function forwards an optional `{ modal, detail }` object and action labels.
        showInformationMessage: (message, ...rest) => vscode.window.showInformationMessage(message, ...rest),
        showErrorMessage: (message, ...rest) => vscode.window.showErrorMessage(message, ...rest),
        showWarningMessage: (message, ...rest) => vscode.window.showWarningMessage(message, ...rest),
        showQuickPick: (items, options) => vscode.window.showQuickPick(items, options),
        withCancellableProgress: (title, task) => vscode.window.withProgress({
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title,
        }, async (_progress, cancellation) => await task(cancellation)),
        withExplorerProgress: (task) => vscode.window.withProgress({
            location: { viewId: CONTEST_VIEW_ID },
        }, async () => await task()),
        toFileUri: (fsPath) => vscode.Uri.file(fsPath),
        submissionWorkspace,
        teamsStandingsProvider,
        treeProvider,
        statusBar,
        explorerView: treeView,
        teamsView,
        revealSubmission: createSubmissionReveal({ treeView, treeProvider, outputChannel }),
    });

    // Startup restore: no error toast; failures show the offline welcome view.
    void controller.refreshTree({ silent: true });

    // The web app redirects to vscode://autojudge.autojudge-contest/auth after
    // the team confirmed the connection; BrowserLogin checks `state` and keeps
    // the pending login untouched when a link does not belong to it.
    const uriHandler = vscode.window.registerUriHandler({
        handleUri: (uri) => {
            const result = browserLogin.handleUri(uri);
            if (result.accepted) {
                return;
            }

            logToChannel(outputChannel, 'warn', result.reason);
            // Links that are not login callbacks are only logged; login callbacks
            // that cannot be used (no login running, wrong state) warn the user.
            if (uri?.path === AUTH_URI_PATH) {
                void vscode.window.showWarningMessage(result.reason);
            }
        },
    });

    return [
        controller,
        browserLogin,
        uriHandler,
        vscode.commands.registerCommand(COMMANDS.LOGIN_TEAM, () => controller.loginTeam()),
        vscode.commands.registerCommand(COMMANDS.LOGOUT_TEAM, () => controller.logoutTeam()),
        vscode.commands.registerCommand(COMMANDS.REFRESH_TREE, () => controller.refreshTree()),
        vscode.commands.registerCommand(COMMANDS.OPEN_CONTEST_DASHBOARD, (item) => controller.openContestDashboard(item)),
        vscode.commands.registerCommand(COMMANDS.OPEN_PROBLEM, (item) => controller.openProblem(item)),
        // Tree items pass `{ problem }`, the editor title passes the file Uri, the palette passes nothing.
        vscode.commands.registerCommand(COMMANDS.SUBMIT_ACTIVE_FILE, (item) => controller.submitActiveFile(item)),
        vscode.commands.registerCommand(COMMANDS.EXPORT_PUBLIC_CASES, (item) => controller.exportPublicCases(item)),
        vscode.commands.registerCommand(COMMANDS.OPEN_SUBMISSION, (item) => controller.openSubmission(item)),
        vscode.commands.registerCommand(COMMANDS.OPEN_TEAM_STANDING, (item) => controller.openTeamStanding(item)),
        vscode.commands.registerCommand(COMMANDS.OPEN_STANDINGS, () => controller.openStandings()),
        vscode.commands.registerCommand(COMMANDS.COMPARE_SUBMISSION_OUTPUT, (item) => controller.compareSubmissionOutput(item)),
        vscode.commands.registerCommand(COMMANDS.SHOW_UNSOLVED_PROBLEMS, () => controller.setUnsolvedOnly(true)),
        vscode.commands.registerCommand(COMMANDS.SHOW_ALL_PROBLEMS, () => controller.setUnsolvedOnly(false)),
    ];
}
