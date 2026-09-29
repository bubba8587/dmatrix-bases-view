import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { joinScores, splitScores } from '../src/joined.ts';
import type { JoinedOption } from '../src/joined.ts';

const options: JoinedOption[] = [
	{ title: 'Laptop A', scores: [{ cost: 950, performance: 9 }] },
	{ title: 'Laptop B', scores: [{ cost: 1200, backlit: true, vendor: 'Acme' }] },
	{ title: 'Laptop C', scores: null },
];
const joined = joinScores(options);
/** What Solenoid Properties' editor saves: every row carries every key. */
const saved = (edit: (rows: Record<string, unknown>[]) => void = () => {}) => {
	const rows = joined.rows.map(r => ({ ...r }));
	edit(rows);
	return rows;
};

describe('joinScores', () => {
	it('stacks each first row under Option, every column in every row', () => {
		assert.equal(joined.optionKey, 'Option');
		assert.deepEqual(joined.columns, ['cost', 'performance', 'backlit', 'vendor']);
		assert.deepEqual(joined.rows[0], { Option: 'Laptop A', cost: 950, performance: 9, backlit: null, vendor: null });
		assert.deepEqual(joined.rows[2], { Option: 'Laptop C', cost: null, performance: null, backlit: null, vendor: null });
	});

	it('names the option column Option2 when a score column is called Option', () => {
		assert.equal(joinScores([{ title: 'X', scores: [{ Option: 1 }] }]).optionKey, 'Option2');
	});
});

describe('splitScores', () => {
	it('writes nothing for an unchanged save', () => {
		const s = splitScores(joined, saved(), options);
		assert.deepEqual(s, { writes: [], unmatched: [], renames: [], dropped: [] });
	});

	it('writes only the edited note, adding no blank columns to it', () => {
		const s = splitScores(joined, saved(r => { r[0].cost = 900; }), options);
		assert.deepEqual(s.writes, [{ index: 0, frame: [{ cost: 900, performance: 9 }] }]);
	});

	it('gives a note without a frame one, with only what was filled in', () => {
		const s = splitScores(joined, saved(r => { r[2].performance = 7; }), options);
		assert.deepEqual(s.writes, [{ index: 2, frame: [{ performance: 7 }] }]);
	});

	it('clears a cell to null on a note that had the column', () => {
		const s = splitScores(joined, saved(r => { r[1].backlit = null; }), options);
		assert.deepEqual(s.writes, [{ index: 1, frame: [{ cost: 1200, backlit: null, vendor: 'Acme' }] }]);
	});

	it('renames a column in place, on every note that has it', () => {
		const renamed = saved(r => r.forEach((row, i) => { r[i] = Object.fromEntries(Object.entries(row).map(([k, v]) => [k === 'cost' ? 'price' : k, v])); }));
		const s = splitScores(joined, renamed, options);
		assert.deepEqual(s.renames, [['cost', 'price']]);
		assert.deepEqual(s.writes.map(w => w.frame[0]), [{ price: 950, performance: 9 }, { price: 1200, backlit: true, vendor: 'Acme' }]);
	});

	it('drops a removed column from every note', () => {
		const s = splitScores(joined, saved(r => r.forEach(row => { delete row.vendor; })), options);
		assert.deepEqual(s.dropped, ['vendor']);
		assert.deepEqual(s.writes, [{ index: 1, frame: [{ cost: 1200, backlit: true }] }]);
	});

	it('reads the last column removed and a blank one added as that, not a rename', () => {
		const s = splitScores(joined, saved(r => r.forEach(row => { delete row.vendor; row.weight = null; })), options);
		assert.deepEqual(s.renames, []);
		assert.deepEqual(s.dropped, ['vendor']);
	});

	it('matches rows by option name, so a sorted save lands on the right notes', () => {
		const s = splitScores(joined, saved(r => { r.reverse(); r[2].cost = 1; }), options);
		assert.deepEqual(s.writes, [{ index: 0, frame: [{ cost: 1, performance: 9 }] }]);
	});

	it('reports a row no option is named by and writes nothing for it', () => {
		const s = splitScores(joined, saved(r => { r.push({ Option: 'Laptop D', cost: 5, performance: null, backlit: null, vendor: null }); }), options);
		assert.deepEqual(s.unmatched, ['Laptop D']);
		assert.deepEqual(s.writes, []);
	});

	it('keeps the other rows of a many-row Scores frame, and a list the editor shows as blank', () => {
		const many: JoinedOption[] = [{ title: 'A', scores: [{ cost: 1, tags: ['x'] }, { cost: 2 }] }];
		const j = joinScores(many);
		const rows = j.rows.map(r => ({ ...r, cost: 3, tags: null }));
		assert.deepEqual(splitScores(j, rows, many).writes, [{ index: 0, frame: [{ cost: 3, tags: ['x'] }, { cost: 2 }] }]);
	});

	it('two options with one name take the saved rows in order', () => {
		const twins: JoinedOption[] = [{ title: 'Same', scores: [{ n: 1 }] }, { title: 'Same', scores: [{ n: 2 }] }];
		const j = joinScores(twins);
		const s = splitScores(j, j.rows.map((r, i) => ({ ...r, n: i + 10 })), twins);
		assert.deepEqual(s.writes.map(w => w.index), [0, 1]);
	});
});
