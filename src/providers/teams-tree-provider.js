import * as vscode from 'vscode';
import { COMMANDS, TREE_CONTEXT } from '../constants.js';
import { sameTeam, resolveRouteId } from '../utils/public-id.js';
import { countSolvedProblems, resolveStandingTeams } from '../utils/standings.js';
import { formatMinutes } from '../utils/time-format.js';

/**
 * Provide the standings panel rendered beside the contest explorer.
 */
export class TeamsStandingsProvider {
    constructor() {
        this.listeners = new Set();
        this.snapshot = null;
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
     * Refresh the visible standings tree.
     */
    refresh() {
        for (const listener of this.listeners) {
            listener(undefined);
        }
    }

    /**
     * Replace the shared contest snapshot used to render team standings.
     * @param {{ team?: object, contest?: object } | null} snapshot
     */
    setSnapshot(snapshot) {
        this.snapshot = snapshot;
        this.refresh();
    }

    /**
     * Return the visible children for the standings panel.
     * @param {Record<string, unknown> | undefined} element
     * @returns {Array<Record<string, unknown>>}
     */
    getChildren(element) {
        if (element?.children) {
            return element.children;
        }

        if (!this.snapshot) {
            return [];
        }

        const contest = this.snapshot?.contest;
        const standingsTeams = resolveStandingTeams(contest);
        if (!standingsTeams.length) {
            return [buildEmptyStandingsItem()];
        }

        const problemCount = Array.isArray(contest?.problems) ? contest.problems.length : null;
        const rows = standingsTeams.map(team => buildStandingTeamItem(team, this.snapshot?.team, problemCount));

        return contest?.frozenScoreboard ? [buildFrozenScoreboardItem(), ...rows] : rows;
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
 * Build the placeholder row shown when standings are unavailable.
 * @returns {Record<string, unknown>}
 */
function buildEmptyStandingsItem() {
    return {
        label: 'No standings yet',
        description: 'They appear once teams join the contest',
        collapsibleState: 0,
    };
}

/**
 * Build the non-clickable notice row shown while the scoreboard is frozen.
 * @returns {Record<string, unknown>}
 */
function buildFrozenScoreboardItem() {
    return {
        id: 'standings:frozen',
        label: 'Scoreboard frozen',
        description: 'final results appear after the contest',
        iconPath: new vscode.ThemeIcon('lock'),
        collapsibleState: 0,
    };
}

/**
 * Build one clickable standings row. The logged-in team gets a highlighted icon
 * and a `(you)` marker so it is easy to find.
 * @param {object} team normalized standings team carrying `rank`
 * @param {object | undefined | null} currentTeam the logged-in team from the snapshot
 * @param {number | null} problemCount total contest problems, when known
 * @returns {Record<string, unknown>}
 */
function buildStandingTeamItem(team, currentTeam, problemCount) {
    const solvedCount = countSolvedProblems(team);
    const isCurrentTeam = sameTeam(team, currentTeam);
    const timeLabel = formatMinutes(team.score);
    const solvedLabel = problemCount == null
        ? `${solvedCount} solved`
        : `${solvedCount} of ${problemCount} problems solved`;
    const summary = `${solvedCount} solved \u00b7 ${timeLabel}`;

    return {
        id: `team:${resolveRouteId(team) ?? team.name}`,
        label: `${team.rank}. ${team.name}`,
        description: isCurrentTeam ? `${summary} (you)` : summary,
        tooltip: `Rank ${team.rank} \u00b7 ${solvedLabel} \u00b7 ${timeLabel} total time${isCurrentTeam ? ' \u00b7 your team' : ''}`,
        iconPath: isCurrentTeam
            ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
            : new vscode.ThemeIcon('person'),
        collapsibleState: 0,
        contextValue: TREE_CONTEXT.STANDING_TEAM,
        command: {
            command: COMMANDS.OPEN_TEAM_STANDING,
            title: 'Open Team Standing',
            arguments: [team],
        },
        team,
    };
}
