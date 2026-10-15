import * as vscode from 'vscode';
import { createContestController } from '../controllers/contest-controller.js';
import { COMMANDS } from '../constants.js';
import * as contestSession from '../services/contest-session.js';
import { BrowserLogin } from '../services/browser-login.js';
import { ContestSubmissionWorkspace } from '../workspace/contest-submission-workspace.js';
import { getBaseUrl, getPollIntervalMs, resolveWebUrl } from '../utils/config.js';

/**
 * Register contest commands and keep the multi-step contest behavior inside the
 * controller rather than in VS Code command glue.
 * @param {object} options
 * @param {import('vscode').ExtensionContext} options.context
 * @param {import('../providers/teams-tree-provider.js').TeamsStandingsProvider} options.teamsStandingsProvider
 * @param {import('../providers/contest-tree-provider.js').ContestTreeProvider} options.treeProvider
 * @param {import('vscode').OutputChannel} options.outputChannel
 * @returns {import('vscode').Disposable[]}
 */
export function registerContestCommands({ context, teamsStandingsProvider, treeProvider, outputChannel }) {
    const submissionWorkspace = new ContestSubmissionWorkspace();
    const browserLogin = new BrowserLogin({
        openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
        resolveWebUrl,
    });
    const controller = createContestController({
        browserLogin,
        context,
        executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
        openTextDocument: (options) => vscode.workspace.openTextDocument(options),
        outputChannel,
        resolveBaseUrl: () => getBaseUrl(),
        resolvePollIntervalMs: () => getPollIntervalMs(),
        sessionApi: contestSession,
        setContext: (key, value) => vscode.commands.executeCommand('setContext', key, value),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        showErrorMessage: (message) => vscode.window.showErrorMessage(message),
        showWarningMessage: (message, ...actions) => vscode.window.showWarningMessage(message, ...actions),
        withCancellableProgress: (title, task) => vscode.window.withProgress({
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title,
        }, async (_progress, cancellation) => await task(cancellation)),
        withProgressNotification: (title, task) => vscode.window.withProgress({
            cancellable: false,
            location: vscode.ProgressLocation.Notification,
            title,
        }, async () => await task()),
        submissionWorkspace,
        teamsStandingsProvider,
        treeProvider,
    });

    controller.refreshTree();

    // The web app redirects to vscode://autojudge.autojudge-contest/auth after
    // the team confirmed the connection; BrowserLogin checks `state` and keeps
    // the pending login untouched when a link does not belong to it.
    const uriHandler = vscode.window.registerUriHandler({
        handleUri: (uri) => {
            const result = browserLogin.handleUri(uri);
            if (!result.accepted) {
                outputChannel.appendLine(result.reason);
                void vscode.window.showErrorMessage(result.reason);
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
        vscode.commands.registerCommand(COMMANDS.OPEN_PROBLEM, (item) => controller.openProblem(item?.problem ?? item)),
        vscode.commands.registerCommand(COMMANDS.SUBMIT_ACTIVE_FILE, (item) => controller.submitActiveFile(item?.problem ?? item)),
        vscode.commands.registerCommand(COMMANDS.EXPORT_PUBLIC_CASES, (item) => controller.exportPublicCases(item?.problem ?? item)),
        vscode.commands.registerCommand(COMMANDS.OPEN_SUBMISSION, (item) => controller.openSubmission(item?.submission ?? item)),
        vscode.commands.registerCommand(COMMANDS.OPEN_TEAM_STANDING, (item) => controller.openTeamStanding(item?.team ?? item)),
    ];
}