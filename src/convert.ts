/**
 * Converting a decision from Decision Matrix 0.7, which kept each score in its own note property and
 * each weight in a `weight_<property>` property on the decision note, to the Scores and Weights
 * frames. The criteria are found the way 0.7 found them: the numeric properties in the view's column
 * order, or every numeric property when the view lists none. 0.7's score prefix only changed how a
 * name was shown, so it comes off the column name here. No Obsidian imports, so `npm test` covers it.
 */
import { listedCriteria } from './weights.ts';
import type { WeightsRecord } from './weights.ts';

/** What 0.7 never took as a criterion. */
const SKIP = new Set(['title', 'name', 'status', 'tags', 'projects', 'file']);

type Frontmatter = Record<string, unknown>;

export interface ConvertInput {
	/** Each option note's frontmatter. */
	notes: Frontmatter[];
	/** The decision note's frontmatter, or null when the view has no decision note. */
	decision: Frontmatter | null;
	/** The view's column order, as bare property names. */
	order: string[];
	/** 0.7's score prefix setting. */
	prefix: string;
	scoresKey: string;
	weightsKey: string;
}

export interface ConvertPlan {
	/** Old property → Scores column. */
	columns: Map<string, string>;
	/** Per note, the new Scores frame and the old properties to remove; null when it has none. */
	notes: ({ scores: WeightsRecord[]; remove: string[] } | null)[];
	/** The decision note's new Weights frame and the weight_ properties to remove; null when none. */
	weights: { frame: WeightsRecord[]; remove: string[] } | null;
	/** How many values move, for the confirmation. */
	moved: number;
}

const isNumberLike = (v: unknown): boolean =>
	typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));

const toNumber = (v: unknown): number | null => (isNumberLike(v) ? Number(v) : null);

const isRecordList = (v: unknown): v is WeightsRecord[] =>
	Array.isArray(v) && v.every(r => typeof r === 'object' && r !== null && !Array.isArray(r));

function isCandidate(key: string, input: ConvertInput): boolean {
	return !SKIP.has(key) && !key.startsWith('weight_') && key !== input.scoresKey && key !== input.weightsKey;
}

/** 0.7's criteria: numeric properties, in the view's order, else in first-appearance order. */
export function legacyCriteria(input: ConvertInput): string[] {
	const numeric = (key: string) => input.notes.some(fm => isNumberLike(fm[key]));
	if (input.order.length > 0) return input.order.filter(k => isCandidate(k, input) && numeric(k));
	const seen: string[] = [];
	for (const fm of input.notes) for (const k of Object.keys(fm)) if (!seen.includes(k) && isCandidate(k, input) && numeric(k)) seen.push(k);
	return seen;
}

export function columnName(property: string, prefix: string): string {
	return prefix && property.startsWith(prefix) && property.length > prefix.length ? property.slice(prefix.length) : property;
}

export function planConversion(input: ConvertInput): ConvertPlan {
	const props = legacyCriteria(input);
	const columns = new Map(props.map(p => [p, columnName(p, input.prefix)]));
	let moved = 0;

	const notes = input.notes.map(fm => {
		const present = props.filter(p => p in fm);
		if (present.length === 0) return null;
		const existing = isRecordList(fm[input.scoresKey]) ? (fm[input.scoresKey] as WeightsRecord[]) : [];
		const row: WeightsRecord = { ...(existing[0] ?? {}) };
		for (const p of present) {
			const col = columns.get(p)!;
			// A value already in the frame wins over the loose property.
			if (row[col] === undefined || row[col] === null) row[col] = toNumber(fm[p]);
			moved++;
		}
		return { scores: [row, ...existing.slice(1)], remove: present };
	});

	let weights: ConvertPlan['weights'] = null;
	const decision = input.decision;
	if (decision) {
		const legacy = Object.keys(decision).filter(k => k.startsWith('weight_') && k.length > 'weight_'.length);
		if (legacy.length > 0) {
			const existing = isRecordList(decision[input.weightsKey]) ? (decision[input.weightsKey] as WeightsRecord[]) : [];
			const listed = new Set(listedCriteria(existing.length ? existing : null).map(n => n.trim().toLowerCase()));
			const frame = [...existing];
			for (const k of legacy) {
				const criterion = columnName(k.slice('weight_'.length), input.prefix);
				if (listed.has(criterion.toLowerCase())) continue;
				listed.add(criterion.toLowerCase());
				frame.push({ Criterion: criterion, Weight: toNumber(decision[k]) ?? 1, Norm: null });
				moved++;
			}
			weights = { frame, remove: legacy };
		}
	}

	return { columns, notes, weights, moved };
}

/** Whether the plan has anything to move. */
export function hasWork(plan: ConvertPlan): boolean {
	return plan.moved > 0 || plan.notes.some(n => n !== null) || plan.weights !== null;
}
