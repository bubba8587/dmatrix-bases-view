/**
 * The Decision Matrix scoring rules, ported from Solenoid's `decisionMatrix` verb
 * (solenoid `src/graph/frameVerbs.ts`, spec `tree/specs/computation/frame-verbs.md`
 * § Decision Matrix). Keep the two in step: the same notes must rank the same in both.
 *
 * No Obsidian imports here, so `npm test` runs it under plain Node.
 */

export type Normalize = 'none' | 'max' | 'rank';
export type Detail = 'summary' | 'breakdown';

/** A criterion cell as read from a note: a number, a checkbox, or not scored yet. */
export type Cell = number | boolean | null;

export interface MatrixInput {
	/** One column per criterion, one cell per option (all columns the same length). */
	columns: Cell[][];
	/** One weight per criterion; a missing or non-finite weight is 1. */
	weights: (number | null | undefined)[];
	/** One mode per criterion; a missing one falls back to `normalize`. */
	norms: (Normalize | null | undefined)[];
	normalize: Normalize;
}

export interface MatrixResult {
	/** Per option, rounded to 4 decimals. */
	scores: number[];
	/** Per option, competition rank on the rounded score (1 is best). */
	ranks: number[];
	/** Per option, whether another option shares its rank. */
	tied: boolean[];
	/** `[criterion][option]`: the signed contribution, which sum to the score. */
	contributions: number[][];
	/** `[criterion][option]`: the value after normalizing. */
	effective: number[][];
	/** The weight each criterion was scored with. */
	weights: number[];
	/** The mode each criterion was normalized with. */
	modes: Normalize[];
}

export function cellToScore(v: Cell): number {
	if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
	if (typeof v === 'boolean') return v ? 1 : 0;
	return 0;
}

export function normalizeColumn(vals: number[], mode: Normalize): number[] {
	if (mode === 'none') return vals;
	if (mode === 'max') {
		const denom = vals.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
		return denom === 0 ? vals.map(() => 0) : vals.map(v => v / denom);
	}
	const n = vals.length;
	if (n <= 1) return vals.map(() => 1);
	return vals.map(v => vals.filter(o => o < v).length / (n - 1));
}

/** Rounds on compute, not display, and flattens −0, so two options that print the same share a rank. */
export function round4(n: number): number {
	const r = Math.round(n * 1e4) / 1e4;
	return r === 0 ? 0 : r;
}

export function scoreMatrix(input: MatrixInput): MatrixResult {
	const rows = input.columns[0]?.length ?? 0;
	const weights = input.columns.map((_, j) => {
		const w = input.weights[j];
		return typeof w === 'number' && Number.isFinite(w) ? w : 1;
	});
	const modes = input.columns.map((_, j) => input.norms[j] ?? input.normalize);
	const effective = input.columns.map((col, j) =>
		normalizeColumn(Array.from({ length: rows }, (_, i) => cellToScore(col[i] ?? null)), modes[j]),
	);
	const sumAbsW = weights.reduce((s, w) => s + Math.abs(w), 0);

	const contributions = effective.map((col, j) =>
		col.map(v => round4(sumAbsW > 0 ? (v * weights[j]) / sumAbsW : 0)),
	);
	const scores = Array.from({ length: rows }, (_, i) => {
		let sw = 0;
		for (let j = 0; j < effective.length; j++) sw += effective[j][i] * weights[j];
		return round4(sumAbsW > 0 ? sw / sumAbsW : 0);
	});

	const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
	const ranks = new Array<number>(rows).fill(0);
	for (let k = 0; k < order.length; k++) {
		ranks[order[k].i] = k > 0 && order[k].s === order[k - 1].s ? ranks[order[k - 1].i] : k + 1;
	}
	const perRank = new Map<number, number>();
	for (const r of ranks) perRank.set(r, (perRank.get(r) ?? 0) + 1);
	const tied = ranks.map(r => (perRank.get(r) ?? 0) > 1);

	return { scores, ranks, tied, contributions, effective, weights, modes };
}

/** Reads a Norm cell the way Solenoid does: Raw / none, ÷Max / max, Rank; anything else inherits. */
export function parseNormalize(v: unknown): Normalize | null {
	if (typeof v !== 'string') return null;
	const s = v.trim().toLowerCase().replace(/[÷\s]/g, '');
	if (s === 'raw' || s === 'none') return 'none';
	if (s === 'max' || s === 'divmax') return 'max';
	if (s === 'rank') return 'rank';
	return null;
}

/** The text a Norm cell is written with, matching Solenoid's own Weights hint. */
export const NORM_TEXT: Record<Normalize, string> = { none: 'Raw', max: '÷Max', rank: 'Rank' };

export function formatScore(n: number): string {
	return String(round4(n));
}

/**
 * Per criterion, the nearest weight at which a different option would take first place, with every
 * other weight held; null when no weight changes the leader or first place is already tied.
 * Every option's score shares the denominator Σ|w|, so the order between two options is the sign of
 * Σ (a_j − b_j)·w_j, linear in each weight, and each rival crosses the leader at one weight.
 */
export function flipWeights(result: MatrixResult): (number | null)[] {
	const { effective, weights, ranks, tied } = result;
	const leader = ranks.indexOf(1);
	if (leader < 0 || tied[leader]) return effective.map(() => null);
	const n = ranks.length;
	return effective.map((col, k) => {
		const w = weights[k];
		let best: number | null = null;
		for (let x = 0; x < n; x++) {
			if (x === leader) continue;
			const slope = col[leader] - col[x];
			if (slope === 0) continue;
			let rest = 0;
			for (let j = 0; j < effective.length; j++) {
				if (j !== k) rest += (effective[j][leader] - effective[j][x]) * weights[j];
			}
			const at = -rest / slope;
			if (!Number.isFinite(at) || Math.abs(at - w) < 1e-9) continue;
			if (best === null || Math.abs(at - w) < Math.abs(best - w)) best = at;
		}
		return best === null ? null : Math.round(best * 100) / 100;
	});
}

/** The leader and how far ahead it is: the top − runner-up margin Solenoid's Decision Sensitivity reports. */
export function leadOf(result: MatrixResult): { leaders: number[]; margin: number | null } {
	const leaders = result.ranks.flatMap((r, i) => (r === 1 ? [i] : []));
	const top = leaders.length ? result.scores[leaders[0]] : null;
	const rest = result.scores.filter((_, i) => result.ranks[i] !== 1);
	const second = rest.length ? Math.max(...rest) : null;
	return { leaders, margin: top !== null && second !== null && leaders.length === 1 ? round4(top - second) : null };
}

/** The median of the finite numbers, or null when there are none. */
export function median(values: number[]): number | null {
	const v = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (v.length === 0) return null;
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export interface FilledColumns {
	columns: Cell[][];
	/** Per criterion, the median a blank scores as, or null when nothing was filled. */
	medians: (number | null)[];
	/** `[criterion][option]`: whether that cell scores as the median rather than its own value. */
	filled: boolean[][];
}

/**
 * A blank, or a value a number column cannot read, scores as that criterion's median across the
 * options, so an option nobody has scored yet is neither rewarded nor penalized there. The median is
 * of the raw values, before normalizing. A checkbox left blank stays unchecked. This is the one place
 * the view departs from Solenoid's Decision Matrix, which scores a blank as 0; `scoreMatrix` itself
 * stays Solenoid's.
 */
export function fillBlanks(columns: Cell[][], logical: boolean[]): FilledColumns {
	const medians: (number | null)[] = [];
	const filled: boolean[][] = [];
	const out = columns.map((col, j) => {
		const blank = col.map(c => !logical[j] && (c === null || (typeof c === 'number' && !Number.isFinite(c))));
		const m = logical[j] ? null : median(col.filter((c): c is number => typeof c === 'number'));
		const fill = m !== null && blank.some(Boolean);
		medians.push(fill ? m : null);
		filled.push(blank.map(b => b && fill));
		return fill ? col.map((c, i) => (blank[i] ? m : c)) : col;
	});
	return { columns: out, medians, filled };
}
