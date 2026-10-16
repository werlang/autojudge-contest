/**
 * Shared time and duration formatting used by the sidebar views, the status bar,
 * and the generated Markdown pages, so every surface shows the same units.
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format a contest time score or penalty (milliseconds) as minutes with at most
 * one decimal, dropping a trailing `.0` (`20 min`, `1.8 min`).
 * @param {number} ms
 * @returns {string}
 */
export function formatMinutes(ms) {
    const value = Number(ms);
    const minutes = Number.isFinite(value) ? Math.max(value, 0) / MINUTE_MS : 0;
    const rounded = Math.round(minutes * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} min`;
}

/**
 * Format a remaining or elapsed duration for people: `2h 12m`, `45m`, `<1m`,
 * or `3d 4h` for long spans.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < MINUTE_MS) {
        return '<1m';
    }

    const days = Math.floor(value / DAY_MS);
    const hours = Math.floor((value % DAY_MS) / HOUR_MS);
    const minutes = Math.floor((value % HOUR_MS) / MINUTE_MS);

    if (days) {
        return hours ? `${days}d ${hours}h` : `${days}d`;
    }

    if (hours) {
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    return `${minutes}m`;
}

/**
 * Format a timestamp in the viewer's local time zone, or return `fallback` when
 * the value is missing or not a valid date.
 * @param {string | number | Date | undefined | null} value
 * @param {string} [fallback='Unknown']
 * @returns {string}
 */
export function formatLocalDateTime(value, fallback = 'Unknown') {
    const date = toValidDate(value);
    if (!date) {
        return fallback;
    }

    return date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}

/**
 * Format how long ago a timestamp was (`just now`, `5 min ago`, `1h20m ago`,
 * `2h ago`, `3d ago`), or return `fallback` for a missing or invalid value.
 * Past an hour the minutes stay, so submissions an hour apart still differ.
 * @param {string | number | Date | undefined | null} value
 * @param {number} [now=Date.now()]
 * @param {string} [fallback='']
 * @returns {string}
 */
export function formatRelativeTime(value, now = Date.now(), fallback = '') {
    const date = toValidDate(value);
    if (!date) {
        return fallback;
    }

    const elapsedMs = now - date.getTime();
    if (elapsedMs < MINUTE_MS) {
        return 'just now';
    }

    if (elapsedMs < HOUR_MS) {
        return `${Math.floor(elapsedMs / MINUTE_MS)} min ago`;
    }

    if (elapsedMs < DAY_MS) {
        const hours = Math.floor(elapsedMs / HOUR_MS);
        const minutes = Math.floor((elapsedMs % HOUR_MS) / MINUTE_MS);
        return minutes ? `${hours}h${minutes}m ago` : `${hours}h ago`;
    }

    return `${Math.floor(elapsedMs / DAY_MS)}d ago`;
}

/**
 * Parse a timestamp into a valid Date, or null.
 * @param {string | number | Date | undefined | null} value
 * @returns {Date | null}
 */
function toValidDate(value) {
    if (value == null || value === '') {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
