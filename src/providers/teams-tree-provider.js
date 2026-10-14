import { COMMANDS, TREE_CONTEXT } from '../constants.js';
import { countSolvedProblems, resolveStandingTeams } from '../utils/standings.js';

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
     * @param {{ team?: { contest?: object } } | null} snapshot
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

        const standingsTeams = resolveStandingTeams(this.snapshot?.contest);
        if (!standingsTeams.length) {
            return [buildEmptyStandingsItem()];
        }

        return standingsTeams.map(team => buildStandingTeamItem(team));
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
        label: 'No team standings available',
        description: 'Refresh the contest to load the latest standings.',
        collapsibleState: 0,
    };
}

/**
 * Build one clickable standings row.
 * @param {object} team
 * @returns {Record<string, unknown>}
 */
function buildStandingTeamItem(team) {
    const solvedCount = countSolvedProblems(team);

    return {
        label: team.name,
        description: `${solvedCount} solved | ${formatStandingScore(team.score)}`,
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

/**
 * Format the visible score label to minutes and one decimal.
 * @param {number} score
 * @returns {string}
 */
function formatStandingScore(score) {
    const minutes = (score / 60000).toFixed(1);
    return `${minutes} min`;
}