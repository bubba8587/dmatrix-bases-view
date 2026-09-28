import type { TFile } from 'obsidian';
import type { Cell } from './scoring.ts';
import type { Criterion } from './weights.ts';

export interface MatrixCriterion extends Criterion {
	/** Checkbox criteria edit as a checkbox. */
	logical: boolean;
	/** Named by the Weights frame but scored by no note yet: shown, not scored. */
	pending?: boolean;
}

export interface DecisionItem {
	id: string;
	file: TFile;
	title: string;
	/** Per criterion, in criteria order. */
	cells: Cell[];
	/** Per criterion, the value as written, for showing one a number column cannot read. */
	raw: string[];
}

export interface ItemGroup {
	key: string;
	items: DecisionItem[];
}

export const DEFAULT_WEIGHTS_PROPERTY = 'weights';
export const DEFAULT_SCORES_PROPERTY = 'scores';
