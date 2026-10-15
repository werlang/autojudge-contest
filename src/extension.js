import * as vscode from 'vscode';
import { registerContestCommands } from './commands/contest-commands.js';
import { CONTEST_VIEW_ID, CONTEXT_KEYS, TEAMS_VIEW_ID, VIEW_STATES } from './constants.js';
import { ContestStatusBar } from './providers/contest-status-bar.js';
import { ContestTreeProvider } from './providers/contest-tree-provider.js';
import { TeamsStandingsProvider } from './providers/teams-tree-provider.js';

/**
 * Activate the AutoJudge Contest extension: the log output channel, both
 * sidebar views (shown as "Loading the contest…" until the first session
 * restore settles), the status bar item, and the commands.
 * @param {import('vscode').ExtensionContext} context
 */
export async function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('AutoJudge Contest', { log: true });
    const treeProvider = new ContestTreeProvider();
    const teamsStandingsProvider = new TeamsStandingsProvider();
    await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.STATE, VIEW_STATES.LOADING);
    const treeView = vscode.window.createTreeView(CONTEST_VIEW_ID, {
        showCollapseAll: true,
        treeDataProvider: treeProvider,
    });
    const teamsView = vscode.window.createTreeView(TEAMS_VIEW_ID, {
        showCollapseAll: false,
        treeDataProvider: teamsStandingsProvider,
    });
    const statusBar = new ContestStatusBar();

    const commandDisposables = registerContestCommands({
        context,
        teamsStandingsProvider,
        treeProvider,
        outputChannel,
        statusBar,
        treeView,
        teamsView,
    });

    // The status bar is disposed after the controller, so a stopping poll never updates a disposed item.
    context.subscriptions.push(outputChannel, treeProvider, treeView, teamsView, ...commandDisposables, statusBar);
}

/**
 * Deactivate the extension.
 */
export function deactivate() {}
