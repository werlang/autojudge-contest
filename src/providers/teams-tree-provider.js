import * as vscode from 'vscode';
import { COMMANDS, TREE_CONTEXT } from '../constants.js';
import { sameTeam, resolveRouteId } from '../utils/public-id.js';
import { countSolvedProblems, resolveStandingTeams } from '../utils/standings.js';
import { formatMinutes } from '../utils/time-format.js';

/** Longest team name (in graphemes, ellipsis included) shown in a row label. */
export const MAX_TEAM_NAME_LENGTH = 24;

/** Splits names into user-perceived characters (flags, ZWJ emoji, combining marks). */
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Empty 16x16 SVG used as the placeholder icon of other teams' rows. */
const BLANK_ICON_URI = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>')}`;

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

        return [
            buildFullStandingsItem(),
            ...(contest?.frozenScoreboard ? [buildFrozenScoreboardItem()] : []),
            ...rows,
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
 * Build the first row, which opens the full standings table (every team with
 * a column per problem).
 * @returns {Record<string, unknown>}
 */
function buildFullStandingsItem() {
    return {
        id: 'standings:full',
        label: 'Full standings',
        description: 'every team and problem',
        iconPath: new vscode.ThemeIcon('table'),
        collapsibleState: 0,
        command: {
            command: COMMANDS.OPEN_STANDINGS,
            title: 'Open Full Standings',
        },
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
 * Build one clickable standings row: `4. Team name` with `2 solved · 85 min`
 * (`0 solved` alone for teams without a solve). Long names are capped so the
 * stats stay visible in a narrow sidebar; the tooltip carries the full name.
 * The logged-in team gets a star icon and a `(you)` marker; every other row
 * gets an invisible placeholder icon so all labels start at the same column.
 * @param {object} team normalized standings team carrying `rank`
 * @param {object | undefined | null} currentTeam the logged-in team from the snapshot
 * @param {number | null} problemCount total contest problems, when known
 * @returns {Record<string, unknown>}
 */
function buildStandingTeamItem(team, currentTeam, problemCount) {
    const solvedCount = countSolvedProblems(team);
    const isCurrentTeam = sameTeam(team, currentTeam);
    const teamName = team.name?.toString().trim() || 'Unnamed team';
    const timeLabel = formatMinutes(team.score);
    const solvedLabel = problemCount == null
        ? `${solvedCount} solved`
        : `${solvedCount} of ${problemCount} problems solved`;
    // Total time is meaningless without a solve, so a zero row stays short.
    const summary = solvedCount ? `${solvedCount} solved \u00b7 ${timeLabel}` : '0 solved';

    const publicId = resolveRouteId(team);

    return {
        // Without a stable public id the row gets no id: VS Code throws on duplicates.
        id: publicId ? `team:${publicId}` : undefined,
        label: `${team.rank}. ${truncateTeamName(teamName)}`,
        description: isCurrentTeam ? `${summary} (you)` : summary,
        tooltip: `${teamName}\nRank ${team.rank} \u00b7 ${solvedLabel} \u00b7 ${timeLabel} total time${isCurrentTeam ? ' \u00b7 your team' : ''}`,
        iconPath: isCurrentTeam
            ? new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'))
            // VS Code indents icon-less rows differently from the starred row, so
            // other teams get an invisible icon that keeps every label aligned.
            : vscode.Uri.parse(BLANK_ICON_URI),
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
 * Cap a team name at {@link MAX_TEAM_NAME_LENGTH} user-perceived characters,
 * ending it with an ellipsis when cut. Counts grapheme clusters, so flags, ZWJ
 * emoji sequences and combining marks are never split in half.
 * @param {string} name
 * @returns {string}
 */
export function truncateTeamName(name) {
    const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(name), ({ segment }) => segment);
    if (graphemes.length <= MAX_TEAM_NAME_LENGTH) {
        return name;
    }

    return `${graphemes.slice(0, MAX_TEAM_NAME_LENGTH - 1).join('').trimEnd()}\u2026`;
}
