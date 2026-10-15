import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
    ThemeColor: class ThemeColor {
        constructor(id) {
            this.id = id;
        }
    },
    ThemeIcon: class ThemeIcon {
        constructor(id, color) {
            this.id = id;
            this.color = color;
        }
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    Uri: { parse: value => ({ toString: () => value }) },
    window: { createStatusBarItem: () => ({}) },
}), { virtual: true });

import { ContestStatusBar } from '../src/providers/contest-status-bar.js';
import { COMMANDS } from '../src/constants.js';

const START = Date.parse('2026-05-28T02:00:00.000Z');
const MINUTE = 60 * 1000;

/**
 * Create a fake status bar item that records visibility.
 * @returns {object}
 */
function createFakeItem() {
    return {
        visible: false,
        show: vi.fn(function show() { this.visible = true; }),
        hide: vi.fn(function hide() { this.visible = false; }),
        dispose: vi.fn(),
    };
}

/**
 * Build a status bar with a fake item, a controllable clock, and fake timers.
 * @param {number} now
 * @returns {{ bar: ContestStatusBar, item: object, clock: { now: number }, setInterval: Function, clearInterval: Function }}
 */
function createBar(now) {
    const item = createFakeItem();
    const clock = { now };
    const setIntervalFn = vi.fn(() => 'timer-1');
    const clearIntervalFn = vi.fn();
    const bar = new ContestStatusBar({
        createStatusBarItem: () => item,
        now: () => clock.now,
        setInterval: setIntervalFn,
        clearInterval: clearIntervalFn,
    });
    return { bar, item, clock, setInterval: setIntervalFn, clearInterval: clearIntervalFn };
}

/**
 * Build a snapshot where team `tme` is ranked second of three.
 * @param {object} [overrides]
 * @returns {object}
 */
function buildSnapshot(overrides = {}) {
    const contest = {
        publicId: 'k3m9x2p7q8w1a',
        name: 'Regional Final',
        startTime: new Date(START).toISOString(),
        duration: 180,
        teams: [
            { publicId: 'tother1', name: 'Other', score: 100, solvedProblemIds: ['pa', 'pb'] },
            { publicId: 'tme', name: 'Bits', score: 50, solvedProblemIds: ['pa'] },
            { publicId: 'tlast', name: 'Last', score: 0, solvedProblemIds: [] },
        ],
    };
    return {
        team: { publicId: 'tme', name: 'Bits' },
        contest,
        problems: [{ publicId: 'pa', order: 1 }, { publicId: 'pb', order: 2 }],
        submissions: [{ id: 1, status: 'ACCEPTED', problem: { publicId: 'pa' }, submittedAt: new Date(START).toISOString() }],
        ...overrides,
    };
}

describe('contest status bar', () => {
    it('hides on a null snapshot without starting a timer', () => {
        const { bar, item, setInterval } = createBar(START);

        bar.update(null);

        expect(item.hide).toHaveBeenCalled();
        expect(item.visible).toBe(false);
        expect(setInterval).not.toHaveBeenCalled();
    });

    it('shows the countdown and rank, with a command that opens the contest overview', () => {
        const { bar, item } = createBar(START + 48 * MINUTE);
        const snapshot = buildSnapshot();

        bar.update(snapshot);

        expect(item.visible).toBe(true);
        expect(item.text).toBe('$(mortar-board) 2h 12m left · #2');
        expect(item.backgroundColor).toBeUndefined();
        expect(item.command).toEqual({
            command: COMMANDS.OPEN_CONTEST_DASHBOARD,
            arguments: [snapshot.contest],
            title: 'Open Contest Overview',
        });
        expect(item.tooltip).toContain('Regional Final');
        expect(item.tooltip).toContain('Team: Bits');
        expect(item.tooltip).toContain('Rank: #2 of 3');
        expect(item.tooltip).toContain('Solved: 1');
        expect(item.tooltip).toContain('Ends: ');
    });

    it('omits the rank when the team is not in the standings', () => {
        const { bar, item } = createBar(START + 48 * MINUTE);

        bar.update(buildSnapshot({ team: { publicId: 'tmissing', name: 'Ghost' } }));

        expect(item.text).toBe('$(mortar-board) 2h 12m left');
        expect(item.tooltip).not.toContain('Rank:');
    });

    it('uses the warning background in the last 15 minutes', () => {
        const { bar, item } = createBar(START + 170 * MINUTE);

        bar.update(buildSnapshot());

        expect(item.text).toBe('$(mortar-board) 10m left · #2');
        expect(item.backgroundColor).toEqual(expect.objectContaining({ id: 'statusBarItem.warningBackground' }));
    });

    it('shows ended and not-started states', () => {
        const ended = createBar(START + 200 * MINUTE);
        ended.bar.update(buildSnapshot());
        expect(ended.item.text).toBe('$(mortar-board) Ended · #2');
        expect(ended.item.backgroundColor).toBeUndefined();

        const upcoming = createBar(START - 25 * MINUTE);
        upcoming.bar.update(buildSnapshot({ contestNotStarted: true }));
        expect(upcoming.item.text).toBe('$(mortar-board) Starts in 25m');

        const unknown = createBar(START);
        unknown.bar.update(buildSnapshot({
            contestNotStarted: true,
            contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' },
        }));
        expect(unknown.item.text).toBe('$(mortar-board) Not started');
    });

    it('shows no timing segment when the contest has no start time', () => {
        const { bar, item } = createBar(START);

        bar.update(buildSnapshot({ contest: { publicId: 'k3m9x2p7q8w1a', name: 'Regional Final' } }));

        expect(item.text).toBe('$(mortar-board)');
        expect(item.text).not.toContain('Running');
        expect(item.tooltip).not.toContain('Status:');
    });

    it('trusts the clock over a sticky not-started flag once the contest has started', () => {
        const { bar, item } = createBar(START + 48 * MINUTE);

        bar.update(buildSnapshot({ contestNotStarted: true }));

        expect(item.text).toBe('$(mortar-board) 2h 12m left · #2');
        expect(item.tooltip).toContain('Status: 2h 12m left');
        expect(item.tooltip).toContain('Solved: ');

        const ended = createBar(START + 200 * MINUTE);
        ended.bar.update(buildSnapshot({ contestNotStarted: true }));
        expect(ended.item.text).toBe('$(mortar-board) Ended · #2');
        expect(ended.clearInterval).not.toHaveBeenCalled();
        expect(ended.setInterval).not.toHaveBeenCalled();
    });

    it('adds a spinning Judging segment while verdicts are pending', () => {
        const { bar, item } = createBar(START + 48 * MINUTE);
        bar.update(buildSnapshot());

        bar.setPendingCount(1);
        expect(item.text).toBe('$(mortar-board) 2h 12m left · #2 · $(sync~spin) Judging');

        bar.setPendingCount(2);
        expect(item.text).toBe('$(mortar-board) 2h 12m left · #2 · $(sync~spin) Judging 2');

        bar.setPendingCount(0);
        expect(item.text).toBe('$(mortar-board) 2h 12m left · #2');
    });

    it('ticks every 30 seconds while running and stops once the contest ends', () => {
        const { bar, item, clock, setInterval, clearInterval } = createBar(START + 170 * MINUTE);
        bar.update(buildSnapshot());

        expect(setInterval).toHaveBeenCalledTimes(1);
        expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 30 * 1000);

        // A second update reuses the running timer.
        bar.update(buildSnapshot());
        expect(setInterval).toHaveBeenCalledTimes(1);

        clock.now = START + 181 * MINUTE;
        setInterval.mock.calls[0][0]();

        expect(item.text).toBe('$(mortar-board) Ended · #2');
        expect(clearInterval).toHaveBeenCalledWith('timer-1');
    });

    it('stops the timer when hidden and on dispose', () => {
        const { bar, item, clearInterval } = createBar(START + 48 * MINUTE);
        bar.update(buildSnapshot());

        bar.update(null);
        expect(clearInterval).toHaveBeenCalledTimes(1);
        expect(item.visible).toBe(false);

        bar.update(buildSnapshot());
        bar.dispose();
        expect(clearInterval).toHaveBeenCalledTimes(2);
        expect(item.dispose).toHaveBeenCalled();
    });
});
