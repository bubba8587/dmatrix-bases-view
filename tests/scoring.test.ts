// Mirrors solenoid tests/graph/decisionMatrix.test.ts, so the view and the node rank alike.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMatrix, parseNormalize, flipWeights, leadOf, fillBlanks } from '../src/scoring.ts';
import type { Cell, Normalize } from '../src/scoring.ts';
import { scoreColumns, scoreRow, scoreTable, setScore, withListed, renameScore, dropScore } from '../src/scores.ts';
import { toFrame, parsePluginColumnTypes, noteColumnType } from '../src/frame.ts';
import { legacyCriteria, planConversion, hasWork } from '../src/convert.ts';
import { resultFrame, uniqueNames } from '../src/result.ts';
import { resolveWeights, setWeight, setNorm, defaultFrame, layoutOf, addCriterion, renameCriterion, removeCriterion, listedCriteria } from '../src/weights.ts';

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

	it('one text cell makes Weight a text column, so every weight is 1, as in Solenoid', () => {
		const frame = [{ Criterion: 'cost', Weight: 2 }, { Criterion: 'battery', Weight: 'lots' }];
		assert.deepEqual(resolveWeights(frame, criteria).weights, [1, 1, 1]);
	});

	it('a blank leading column is text, so it names the criteria, as in Solenoid', () => {
		assert.equal(layoutOf([{ Note: null, Criterion: 'cost', Weight: 2 }]).criterionKey, 'Note');
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

	it('the column type decides: a number column ignores a value it cannot read', () => {
		const rows = [{ cost: 950, vendor: 'Acme' }, { cost: 'n/a', vendor: 'Globex' }, null];
		const t = scoreTable(rows, { cost: 'number', vendor: 'string' });
		assert.deepEqual(t.columns, [{ name: 'cost', logical: false }]);
		assert.deepEqual(t.cells.map(c => c[0]), [950, NaN, null]);
		assert.deepEqual(t.raw.map(r => r[0]), ['950', 'n/a', '']);
		assert.deepEqual(t.names, ['cost', 'vendor']);
		// Never saved in the editor, the column is guessed as Solenoid guesses it: mixed is text.
		assert.deepEqual(scoreColumns(rows), []);
	});

	it('a Weights row names no pending column for a column the notes already have', () => {
		assert.deepEqual(withListed([], ['vendor', 'noise'], ['vendor']), [{ name: 'noise', logical: false, pending: true }]);
	});

	it('reads a note\'s first row, and nothing from a non-frame', () => {
		assert.deepEqual(scoreRow([{ a: 1 }, { a: 2 }]), { a: 1 });
		assert.equal(scoreRow(5), null);
		assert.equal(scoreRow([]), null);
		assert.deepEqual(scoreTable([{ a: 1, b: false }, { a: null, b: true }]).cells, [[1, false], [null, true]]);
	});

	it('sets a cell, making a one-row frame when there is none', () => {
		assert.deepEqual(setScore(undefined, 'cost', 900), [{ cost: 900 }]);
		const before = [{ cost: 1, speed: 2 }];
		assert.deepEqual(setScore(before, 'speed', null), [{ cost: 1, speed: null }]);
		assert.equal(before[0].speed, 2);
	});
});

describe('flipWeights', () => {
	it('finds the weight where the leader changes', () => {
		// Raw, weights [2, -1]: A ∝ 2·8 − 3 = 13, B ∝ 11, C ∝ 11, so A leads.
		const r = run([2, -1], 'none');
		assert.deepEqual(r.ranks, [1, 2, 2]);
		// Quality weight w: A − B = 2w − 2 (ties at 1), A − C = −2w + 6 (ties at 3); both 1 from 2.
		// Cost weight v: A − B = 4 + 2v (ties at −2), A − C = −4 − 6v... A − C = 2·(8 − 10) + (3 − 9)·v = −4 − 6v (ties at −2/3).
		const flips = flipWeights(r);
		assert.ok(flips[0] === 1 || flips[0] === 3);
		assert.equal(flips[1], -0.67);
	});

	it('is null on a tie for first', () => {
		assert.deepEqual(flipWeights(run([1, -1], 'none')), [null, null]);
	});

	it('crossing the flip weight really hands first place over', () => {
		const r = run([3, -2], 'none');
		const leader = r.ranks.indexOf(1);
		flipWeights(r).forEach((at, k) => {
			if (at === null) return;
			const w = [3, -2];
			w[k] = at + Math.sign(at - w[k]) * 0.05;
			const after = scoreMatrix({ columns: [quality, cost], weights: w, norms: [], normalize: 'none' });
			assert.notEqual(after.ranks[leader], 1, `criterion ${k} at ${w[k]}`);
		});
	});
});

describe('leadOf', () => {
	it('reports the margin, or every tied leader', () => {
		assert.deepEqual(leadOf(run([], 'none')), { leaders: [2], margin: 4 });
		assert.deepEqual(leadOf(run([1, -1], 'none')), { leaders: [0, 1], margin: null });
	});
});

describe('criterion edits', () => {
	const cost = { name: 'cost', label: 'cost' };
	it('lists a weights-only criterion as an empty column', () => {
		assert.deepEqual(withListed([{ name: 'cost', logical: false }], ['COST', 'noise', ' ']), [
			{ name: 'cost', logical: false },
			{ name: 'noise', logical: false, pending: true },
		]);
	});

	it('adds, renames and removes a Weights row', () => {
		const added = addCriterion(addCriterion([], 'cost'), 'noise');
		assert.deepEqual(added, [{ Criterion: 'cost', Weight: 1, Norm: null }, { Criterion: 'noise', Weight: 1, Norm: null }]);
		assert.deepEqual(listedCriteria(added), ['cost', 'noise']);
		assert.equal(renameCriterion(added, cost, 'price')[0].Criterion, 'price');
		assert.deepEqual(listedCriteria(removeCriterion(added, cost)), ['noise']);
	});

	it('renames and drops a Scores column in place', () => {
		assert.deepEqual(Object.keys(renameScore([{ a: 1, cost: 2, b: 3 }], 'cost', 'price')![0]), ['a', 'price', 'b']);
		assert.equal(renameScore([{ a: 1 }], 'cost', 'price'), null);
		assert.deepEqual(dropScore([{ a: 1, cost: 2 }], 'cost'), [{ a: 1 }]);
		assert.equal(dropScore('x', 'cost'), null);
	});
});

describe('column types, as Solenoid reads a note Frame', () => {
	it('guesses one family throughout, else text; blank is text', () => {
		assert.equal(noteColumnType([1, null, 2.5]), 'number');
		assert.equal(noteColumnType([true, false]), 'logical');
		assert.equal(noteColumnType([1, true]), 'string');
		assert.equal(noteColumnType(['2026-01-02', null]), 'date');
		assert.equal(noteColumnType([null, '']), 'string');
	});

	it('a picked number column reads text digits and scores the unreadable as NaN', () => {
		const rows = [{ cost: '12' }, { cost: '1,200' }, { cost: 'n/a' }, { cost: true }, null];
		assert.deepEqual(scoreColumns(rows), []);
		const t = scoreTable(rows, { cost: 'number' });
		assert.deepEqual(t.columns, [{ name: 'cost', logical: false }]);
		assert.deepEqual(t.cells.map(c => c[0]), [12, 1200, NaN, NaN, null]);
		// NaN scores 0, as a non-finite cell does in Solenoid.
		assert.deepEqual(scoreMatrix({ columns: [t.cells.map(c => c[0])], weights: [], norms: [], normalize: 'none' }).scores, [12, 1200, 0, 0, 0]);
	});

	it('a picked logical column reads true, false and numbers', () => {
		assert.deepEqual(toFrame([{ f: 'TRUE' }, { f: 0 }, { f: 2 }, { f: 'maybe' }], { f: 'logical' })[0].values, [true, false, true, null]);
	});

	it('a picked Weight column of text digits weighs', () => {
		const frame = [{ Criterion: 'cost', Weight: '-3' }, { Criterion: 'speed', Weight: '2' }];
		const c = [{ name: 'cost', label: 'cost' }, { name: 'speed', label: 'speed' }];
		assert.deepEqual(resolveWeights(frame, c).weights, [1, 1]);
		assert.deepEqual(resolveWeights(frame, c, { Weight: 'number' }).weights, [-3, 2]);
	});

	it('reads Solenoid Properties data.json picks, dropping anything else', () => {
		assert.deepEqual(parsePluginColumnTypes({ columnTypes: { scores: { cost: 'number', x: 'banana' }, bad: 3, empty: {} }, look: true }), { scores: { cost: 'number' } });
		assert.deepEqual(parsePluginColumnTypes(null), {});
	});
});

describe('fillBlanks', () => {
	it('scores a blank or unreadable number as the criterion median, of the raw values', () => {
		const f = fillBlanks([[800, null, 1200, NaN, 950]], [false]);
		assert.deepEqual(f.medians, [950]);
		assert.deepEqual(f.columns, [[800, 950, 1200, 950, 950]]);
		assert.deepEqual(f.filled, [[false, true, false, true, false]]);
	});

	it('takes the middle two for an even count, and leaves checkboxes and full columns alone', () => {
		const f = fillBlanks([[1, 2, 3, 10, null], [true, null], [4, 5]], [false, true, false]);
		assert.deepEqual(f.medians, [2.5, null, null]);
		assert.deepEqual(f.columns[1], [true, null]);
		assert.deepEqual(f.filled[2], [false, false]);
	});

	it('an unscored option is neither rewarded nor penalized on a lower-is-better criterion', () => {
		// cost weighs -1: with a blank as 0, the unpriced option would look cheapest and win.
		const cost: Cell[] = [800, 1200, null], quality: Cell[] = [5, 5, 5];
		const asZero = scoreMatrix({ columns: [cost, quality], weights: [-1, 1], norms: [], normalize: 'max' });
		assert.equal(asZero.ranks[2], 1);
		const filled = fillBlanks([cost, quality], [false, false]);
		const asMedian = scoreMatrix({ columns: filled.columns, weights: [-1, 1], norms: [], normalize: 'max' });
		assert.deepEqual(asMedian.ranks, [1, 3, 2]);
	});

	it('a column nobody has scored fills nothing', () => {
		assert.deepEqual(fillBlanks([[null, null]], [false]), { columns: [[null, null]], medians: [null], filled: [[false, false]] });
	});
});

describe('conversion from 0.7', () => {
	const base = { scoresKey: 'scores', weightsKey: 'weights', prefix: '', order: [] as string[] };
	const laptops = [
		{ title: 'A', cost: 1200, performance: 7, tags: ['x'], year: '2024', note: 'fast' },
		{ title: 'B', cost: '950', performance: 9, backlit: true },
		{ title: 'C', performance: 5 },
	];

	it('finds 0.7 criteria: numeric properties, numeric text too, never title, tags or weight_', () => {
		assert.deepEqual(legacyCriteria({ ...base, notes: laptops, decision: null }), ['cost', 'performance', 'year']);
		assert.deepEqual(legacyCriteria({ ...base, order: ['title', 'performance', 'note', 'cost'], notes: laptops, decision: null }), ['performance', 'cost']);
	});

	it('moves each note\'s values into its Scores frame and the weights into the Weights frame', () => {
		const plan = planConversion({
			...base, order: ['cost', 'performance'], notes: laptops,
			decision: { title: 'D', weight_cost: -3, weight_performance: '5', weight_ghost: 2 },
		});
		assert.deepEqual(plan.notes[0], { scores: [{ cost: 1200, performance: 7 }], remove: ['cost', 'performance'] });
		assert.deepEqual(plan.notes[1], { scores: [{ cost: 950, performance: 9 }], remove: ['cost', 'performance'] });
		assert.deepEqual(plan.notes[2], { scores: [{ performance: 5 }], remove: ['performance'] });
		assert.deepEqual(plan.weights, {
			frame: [
				{ Criterion: 'cost', Weight: -3, Norm: null },
				{ Criterion: 'performance', Weight: 5, Norm: null },
				{ Criterion: 'ghost', Weight: 2, Norm: null },
			],
			remove: ['weight_cost', 'weight_performance', 'weight_ghost'],
		});
		assert.equal(plan.moved, 8);
		assert.ok(hasWork(plan));
	});

	it('strips 0.7\'s score prefix from column and criterion names', () => {
		const plan = planConversion({
			...base, prefix: 'score_', notes: [{ score_cost: 3, score_: 1 }],
			decision: { weight_score_cost: 2 },
		});
		assert.deepEqual([...plan.columns], [['score_cost', 'cost'], ['score_', 'score_']]);
		assert.deepEqual(plan.weights?.frame, [{ Criterion: 'cost', Weight: 2, Norm: null }]);
	});

	it('keeps what is already in a frame', () => {
		const plan = planConversion({
			...base, notes: [{ cost: 5, scores: [{ cost: 9, speed: 2 }] }],
			decision: { weights: [{ Weight: 4, Criterion: 'Cost' }], weight_cost: 1, weight_speed: 3 },
		});
		assert.deepEqual(plan.notes[0]?.scores, [{ cost: 9, speed: 2 }]);
		assert.deepEqual(plan.weights?.frame, [{ Weight: 4, Criterion: 'Cost' }, { Criterion: 'speed', Weight: 3, Norm: null }]);
	});

	it('has nothing to do for a decision already in frames', () => {
		const plan = planConversion({ ...base, notes: [{ title: 'A', scores: [{ cost: 1 }] }], decision: { weights: [] } });
		assert.equal(hasWork(plan), false);
	});
});

describe('result frame', () => {
	it('is Option · Score · Rank best first, like Solenoid\'s output', () => {
		const r = run([], 'none');
		const f = resultFrame(['A', 'B', 'C'], ['quality', 'cost'], r, 'summary');
		assert.deepEqual(f.rows, [
			{ Option: 'C', Score: 9.5, Rank: 1 },
			{ Option: 'A', Score: 5.5, Rank: 2 },
			{ Option: 'B', Score: 3.5, Rank: 3 },
		]);
		assert.deepEqual(f.types, { Option: 'string', Score: 'number', Rank: 'number' });
	});

	it('adds signed contributions under Breakdown, and renames a colliding criterion', () => {
		const r = run([1, -1], 'none');
		const f = resultFrame(['A', 'B', 'C'], ['Score', 'cost'], r, 'breakdown');
		assert.deepEqual(Object.keys(f.rows[0]), ['Option', 'Score', 'cost', 'Score2', 'Rank']);
		assert.deepEqual(f.rows.map(x => x.Option), ['A', 'B', 'C']);
		assert.deepEqual(f.rows[2], { Option: 'C', Score: 5, cost: -4.5, Score2: 0.5, Rank: 3 });
	});

	it('keeps tied options in their order and gives them one rank', () => {
		const f = resultFrame(['A', 'B', 'C'], ['quality', 'cost'], run([1, -1], 'none'), 'summary');
		assert.deepEqual(f.rows.map(x => [x.Option, x.Rank]), [['A', 1], ['B', 1], ['C', 3]]);
	});

	it('makes names unique as Solenoid\'s makeHeaders does', () => {
		assert.deepEqual(uniqueNames(['Rank', 'Rank', ' Rank ', 'rank', '', 'Rank2']), ['Rank', 'Rank2', 'Rank3', 'rank', 'Col5', 'Rank22']);
	});
});
