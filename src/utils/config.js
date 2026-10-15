import * as vscode from 'vscode';
import { normalizeBaseUrl } from '../services/contest-api.js';

const DEFAULT_WEB_URL = 'https://autojudge.io';
const DEFAULT_BASE_URL = 'https://api.autojudge.io';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const MIN_POLL_INTERVAL_MS = 1000;

export const SUPPORTED_EXTENSIONS = ['.c', '.cpp', '.java', '.js', '.php', '.py'];
export const TEAM_PANEL_REFRESH_INTERVAL_MS = 15000;

/**
 * Read one `autojudgeContest.*` setting live, so a changed value applies
 * without reloading the window.
 * @param {string} key
 * @param {unknown} fallbackValue
 * @returns {unknown}
 */
function readSetting(key, fallbackValue) {
    return vscode.workspace.getConfiguration('autojudgeContest').get(key, fallbackValue);
}

/**
 * Read the AutoJudge web app address used for the browser login. Read on every
 * login so a changed setting applies without reloading the window.
 * @returns {string}
 */
export function resolveWebUrl() {
    return readSetting('webUrl', DEFAULT_WEB_URL);
}

/**
 * Read and normalize the contest API base URL on every call.
 * @returns {string} URL with a trailing slash
 * @throws {Error} with `code` INVALID_SETTING when the setting is empty or not an http(s) URL
 */
export function getBaseUrl() {
    return normalizeBaseUrl(readSetting('baseUrl', DEFAULT_BASE_URL));
}

/**
 * Read the post-submit polling interval on every call. Non-numeric values fall
 * back to 5 seconds and anything lower than 1 second is raised to 1 second.
 * @returns {number} interval in milliseconds
 */
export function getPollIntervalMs() {
    const configuredIntervalMs = Number(readSetting('pollIntervalMs', DEFAULT_POLL_INTERVAL_MS));

    if (!Number.isFinite(configuredIntervalMs)) {
        return DEFAULT_POLL_INTERVAL_MS;
    }

    return Math.max(Math.trunc(configuredIntervalMs), MIN_POLL_INTERVAL_MS);
}
