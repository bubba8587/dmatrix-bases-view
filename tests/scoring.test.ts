// Mirrors solenoid tests/graph/decisionMatrix.test.ts, so the view and the node rank alike.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatrix, parseNormalize } from '../src/scoring.ts';
import type { Cell, Normalize } from '../src/scoring.ts';
import { scoreColumns, scoreRow, cellsOf, setScore } from '../src/scores.ts';
import { resolveWeights, setWeight, setNorm, defaultFrame, layoutOf } from '../src/weights.ts';

// Options A, B, C; criteria quality and cost.
const quality: Cell[] = [8, 6, 10];
const cost: Cell[] = [3, 1, 9];

const run = (weights: (number | null)[], normalize: Normalize, columns: Cell[][] = [quality, cost], norms: (Normalize | null)[] = []) =>
	scoreMatrix({ columns, weights, norms, normalize });

describe('scoreMatrix', () => {
	it('scores the weighted average and ranks best first', () => {
		const r = run([], 'none');
		assert.deepEqual(r.scores, [5.5, 3.5, 9.5]);
		assert.deepEqual(r.ranks, [2, 3, 1]);
	});

	it('divides by Σ|weight|', () => {
		assert.deepEqual(run([3, 0], 'none').scores, [8, 6, 10]);
	});

	it('a negative weight penalizes, and equal scores share a rank', () => {
		const r = run([1, -1], 'none');
		assert.deepEqual(r.scores, [2.5, 2.5, 0.5]);
		assert.deepEqual(r.ranks, [1, 1, 3]);
		assert.deepEqual(r.tied, [true, true, false]);
	});

	it('a missing weight is 1', () => {
		const r = run([5], 'none');
		assert.equal(r.ranks[2], 1);
		assert.equal(r.weights[1], 1);
	});

	it('rank normalizing compares incompatible scales', () => {
		const r = run([1, -1], 'rank', [quality, [100, 50, 900]]);
		assert.deepEqual(r.scores, [0, 0, 0]);
	});

	it('÷max scales each criterion by its largest magnitude', () => {
		assert.deepEqual(run([1, 0], 'max').scores, [0.8, 0.6, 1]);
	});

	it('ranks on the rounded score', () => {
		const r = run([], 'none', [[1.00001, 1.00002]]);
		assert.deepEqual(r.scores, [1, 1]);
		assert.deepEqual(r.ranks, [1, 1]);
	});

	it('reads a blank as 0 and a checkbox as 1 or 0', () => {
		const r = run([], 'none', [[true, false], [null, 4]]);
		assert.deepEqual(r.scores, [0.5, 2]);
	});

	it('contributions are signed and sum to the score', () => {
		const r = run([1, -1], 'none');
		assert.deepEqual(r.contributions[1], [-1.5, -0.5, -4.5]);
		r.scores.forEach((s, i) => assert.ok(Math.abs(r.contributions[0][i] + r.contributions[1][i] - s) < 1e-4));
	});

	it('rank contributions are the weighted fraction beaten', () => {
		assert.deepEqual(run([], 'rank').contributions[0], [0.25, 0, 0.5]);
	});

	it('a per-criterion norm overrides the default', () => {
		const r = run([1, 0], 'none', [quality, cost], ['max', null]);
		assert.deepEqual(r.modes, ['max', 'none']);
		assert.deepEqual(r.scores, [0.8, 0.6, 1]);
	});

	it('all-zero weights score 0', () => {
		assert.deepEqual(run([0, 0], 'none').scores, [0, 0, 0]);
	});
});

describe('parseNormalize', () => {
	it('reads the Norm spellings', () => {
		assert.equal(parseNormalize('Raw'), 'none');
		assert.equal(parseNormalize(' ÷ Max '), 'max');
		assert.equal(parseNormalize('divmax'), 'max');
		assert.equal(parseNormalize('RANK'), 'rank');
		assert.equal(parseNormalize('median'), null);
		assert.equal(parseNormalize(3), null);
	});
});

describe('Weights frame', () => {
	const criteria = [
		{ name: 'cost', label: 'Cost' },
		{ name: 'build_quality', label: 'Build Quality' },
		{ name: 'battery', label: 'battery' },
	];

	it('aligns by name, case-insensitive, first row winning; a missing criterion weighs 1', () => {
		const frame = [
			{ Criterion: ' COST ', Weight: -3, Norm: 'Rank' },
			{ Criterion: 'Build Quality', Weight: 4, Norm: null },
			{ Criterion: 'cost', Weight: 99 },
		];
		const r = resolveWeights(frame, criteria);
		assert.deepEqual(r.weights, [-3, 4, 1]);
		assert.deepEqual(r.norms, ['rank', null, null]);
		assert.deepEqual(r.listed, [true, true, false]);
	});

	it('prefers a Weight column by name over the first number column', () => {
		const frame = [{ name: 'cost', Order: 1, Value: 7 }];
		assert.deepEqual(resolveWeights(frame, criteria).weights, [7, 1, 1]);
		assert.deepEqual(layoutOf(frame), { criterionKey: 'name', weightKey: 'Value', normKey: null });
	});

	it('a non-number weight is 1', () => {
		assert.deepEqual(resolveWeights([{ Criterion: 'cost', Weight: 2 }, { Criterion: 'battery', Weight: 'lots' }], criteria).weights, [2, 1, 1]);
	});

	it('no frame weighs everything 1', () => {
		assert.deepEqual(resolveWeights(null, criteria).weights, [1, 1, 1]);
	});

	it('writes a weight into its row, or adds the row', () => {
		const frame = defaultFrame(criteria.slice(0, 1));
		const next = setWeight(setWeight(frame, criteria[0], -2), criteria[2], 5);
		assert.deepEqual(next, [
			{ Criterion: 'cost', Weight: -2, Norm: null },
			{ Criterion: 'battery', Weight: 5 },
		]);
		assert.deepEqual(frame[0].Weight, 1);
	});

	it('writes Norm with the text Solenoid reads, and clears it', () => {
		const frame = setNorm(defaultFrame(criteria.slice(0, 1)), criteria[0], 'max');
		assert.equal(frame[0].Norm, '÷Max');
		assert.equal(setNorm(frame, criteria[0], null)[0].Norm, null);
	});
});

describe('Scores frame', () => {
	it('takes number and checkbox columns across notes, in first-appearance order', () => {
		const rows = [
			{ cost: 950, vendor: 'Acme', backlit: null },
			null,
			{ backlit: true, cost: 800, released: '2026-03-01', speed: 4 },
		];
		assert.deepEqual(scoreColumns(rows), [
			{ name: 'cost', logical: false },
			{ name: 'backlit', logical: true },
			{ name: 'speed', logical: false },
		]);
	});

	it('reads a note\'s first row, and nothing from a non-frame', () => {
		assert.deepEqual(scoreRow([{ a: 1 }, { a: 2 }]), { a: 1 });
		assert.equal(scoreRow(5), null);
		assert.equal(scoreRow([]), null);
		assert.deepEqual(cellsOf({ a: 'x', b: false }, [{ name: 'a', logical: false }, { name: 'b', logical: true }, { name: 'c', logical: false }]), [null, false, null]);
	});

	it('sets a cell, making a one-row frame when there is none', () => {
		assert.deepEqual(setScore(undefined, 'cost', 900), [{ cost: 900 }]);
		const before = [{ cost: 1, speed: 2 }];
		assert.deepEqual(setScore(before, 'speed', null), [{ cost: 1, speed: null }]);
		assert.equal(before[0].speed, 2);
	});
});
