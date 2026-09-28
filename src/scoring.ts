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
