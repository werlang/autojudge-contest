import * as vscode from 'vscode';
import { createContestController } from '../controllers/contest-controller.js';
import { COMMANDS } from '../constants.js';
import * as contestSession from '../services/contest-session.js';
import { isTeamCode, normalizeTeamCode, TEAM_CODE_MESSAGE } from '../services/contest-api.js';
import { ContestSubmissionWorkspace } from '../workspace/contest-submission-workspace.js';
import config from '../utils/config.js';

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
    const controller = createContestController({
        context,
        executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
        openTextDocument: (options) => vscode.workspace.openTextDocument(options),
        outputChannel,
        promptTeamCredentials: async () => {
            const teamInput = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                placeHolder: 'team-code',
                prompt: 'Enter your AutoJudge team code (printed on your team card).',
                title: 'AutoJudge Contest Login',
                validateInput: (value) => (isTeamCode(value) ? null : TEAM_CODE_MESSAGE),
            });
            const teamId = normalizeTeamCode(teamInput);

            if (!isTeamCode(teamId)) {
                return null;
            }

            const password = await vscode.window.showInputBox({
                ignoreFocusOut: true,
                password: true,
                placeHolder: '123456',
                prompt: 'Enter the AutoJudge team password.',
                title: 'AutoJudge Contest Login',
            });

            if (!password) {
                return null;
            }

            return { password, teamId };
        },
        resolveBaseUrl: () => config.BASE_URL,
        resolvePollIntervalMs: () => {
            const configuredIntervalMs = config.POLL_INTERVAL_MS;

            if (!Number.isFinite(configuredIntervalMs)) {
                return 5000;
            }

            return Math.max(Math.trunc(configuredIntervalMs), 1000);
        },
        sessionApi: contestSession,
        setContext: (key, value) => vscode.commands.executeCommand('setContext', key, value),
        showInformationMessage: (message) => vscode.window.showInformationMessage(message),
        showErrorMessage: (message) => vscode.window.showErrorMessage(message),
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

    return [
        controller,
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