import * as vscode from 'vscode';
import {
    buildContestHeaderDescription,
    formatSubmissionStatus,
} from '../presentation/contest-presentation.js';
import { COMMANDS, TREE_CONTEXT } from '../constants.js';
import { sameEntity } from '../utils/public-id.js';
import {
    isErrorSubmission,
    isFailedSubmission,
    isPassedSubmission,
    isPendingSubmission,
    isTimeLimitSubmission
} from '../utils/submission-status.js';

/**
 * Provide the contest explorer tree for logged-in contest snapshots.
 */
export class ContestTreeProvider {
    constructor() {
        this.listeners = new Set();
        this.snapshot = null;
        this.state = 'loggedOut';
    }

    /**
     * Subscribe to tree refresh events.
     * @param {(item?: unknown) => void} listener
     * @returns {{ dispose: () => void }}
     */
    onDidChangeTreeData(listener) {
        this.listeners.add(listener);

        return {
            dispose: () => {
                this.listeners.delete(listener);
            },
        };
    }

    /**
     * Refresh the full tree and optionally update the visible state label.
     * @param {'loggedIn' | 'loggedOut'} [state]
     */
    refresh(state) {
        if (state) {
            this.state = state;
        }

        for (const listener of this.listeners) {
            listener(undefined);
        }
    }

    /**
     * Replace the visible contest snapshot and refresh the tree.
     * @param {{ problems: object[], submissions: object[], team: { contest: { id: number, name: string }, name: string }, token: string } | null} snapshot
     */
    setSnapshot(snapshot) {
        this.snapshot = snapshot;
        this.state = snapshot ? 'loggedIn' : 'loggedOut';
        this.refresh();
    }

    /**
     * Dispose the tree provider.
     */
    dispose() {}

    /**
     * Return the currently rendered contest snapshot.
     * @returns {{ problems: object[], submissions: object[], team: object, token: string } | null}
     */
    getSnapshot() {
        return this.snapshot;
    }

    /**
     * Create a simple colored circle icon as a data URI for problem nodes.
     * @param {*} hexColor
     * @returns 
     */
    createColoredCircleIcon(hexColor) {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
                <circle cx="8" cy="8" r="3" fill="${hexColor || '#00000000'}" />
            </svg>
        `;

        return vscode.Uri.parse(
            `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
        );
    }

    /**
     * Return the visible children for a given tree node.
     * @param {Record<string, unknown> | undefined} element
     * @returns {Array<Record<string, unknown>>}
     */
    getChildren(element) {
        if (element?.children) {
            return element.children;
        }

        if (!this.snapshot || this.state === 'loggedOut') {
            return [];
        }

        const problemItems = this.snapshot.problems
            .slice()
            .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
            .map(problem => {
                const submissions = this.snapshot.submissions
                    .filter(submission => sameEntity(submission.problem, problem))
                    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
                    .map(submission => ({
                        label: `#${submission.id}`,
                        description: formatSubmissionStatus(submission.status),
                        collapsibleState: 0,
                        contextValue: TREE_CONTEXT.SUBMISSION,
                        iconPath: getSubmissionIcon(submission.status),
                        command: {
                            command: COMMANDS.OPEN_SUBMISSION,
                            title: 'Open Submission Result',
                            arguments: [submission],
                        },
                        submission,
                    }));

                return {
                    label: problem.title.trim(),
                    description: `${submissions.length} submission${submissions.length === 1 ? '' : 's'}`,
                    collapsibleState: submissions.length ? 1 : 0,
                    contextValue: TREE_CONTEXT.PROBLEM,
                    iconPath: this.createColoredCircleIcon(problem.color),
                    children: submissions,
                    problem,
                };
            });

        return [
            // The contest header is a root-level node that surfaces the team and contest name.
            {
                label: this.snapshot.contest.name.trim().toUpperCase(),
                description: buildContestHeaderDescription(this.snapshot.team),
                collapsibleState: 0,
                contextValue: TREE_CONTEXT.CONTEST,
                iconPath: new vscode.ThemeIcon('mortar-board', new vscode.ThemeColor('charts.blue')),
                tooltip: buildContestHeaderTooltip(this.snapshot.team, this.snapshot.contest),
                command: {
                    command: COMMANDS.OPEN_CONTEST_DASHBOARD,
                    title: 'Open Contest Dashboard',
                    arguments: [this.snapshot.contest],
                },
            },
            ...problemItems,
        ];
    }

    /**
     * Return the TreeItem-compatible shape for a node.
     * @param {Record<string, unknown>} element
     * @returns {Record<string, unknown>}
     */
    getTreeItem(element) {
        return element;
    }
}

/**
 * Map an AutoJudge submission status to a deterministic tree icon at the VS Code boundary.
 * @param {string | undefined | null} status
 * @returns {import('vscode').ThemeIcon}
 */
function getSubmissionIcon(status) {
    if (isPassedSubmission(status)) {
        return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'));
    }

    if (isFailedSubmission(status)) {
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
    }

    if (isTimeLimitSubmission(status)) {
        return new vscode.ThemeIcon('clockface', new vscode.ThemeColor('charts.yellow'));
    }

    if (isPendingSubmission(status)) {
        return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.yellow'));
    }

    if (isErrorSubmission(status)) {
        return new vscode.ThemeIcon('warning-compact', new vscode.ThemeColor('testing.iconFailed'));
    }

    return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
}

/**
 * Build the richer contest-header tooltip shown in the explorer.
 * @param {{ contest?: { name?: string }, name?: string }} team
 * @param {{ name?: string }} contest
 * @returns {string}
 */
function buildContestHeaderTooltip(team, contest) {
    const tooltipLines = [contest?.name?.toString().trim() || 'Contest'];
    const description = buildContestHeaderDescription(team);

    if (description) {
        tooltipLines.push(description);
    }

    return tooltipLines.join('\n');
}