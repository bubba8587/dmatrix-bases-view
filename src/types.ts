import type { TFile, BasesPropertyId } from 'obsidian';
import type { Cell } from './scoring.ts';
import type { Criterion } from './weights.ts';

export interface MatrixCriterion extends Criterion {
	id: BasesPropertyId;
	/** A note property takes edits in the view; a formula is read-only. */
	editable: boolean;
	/** Checkbox criteria edit as a checkbox. */
	logical: boolean;
}

export interface DecisionItem {
	id: string;
	file: TFile;
	title: string;
	/** Per criterion, in criteria order. */
	cells: Cell[];
}

export interface ItemGroup {
	key: string;
	items: DecisionItem[];
}

export const DEFAULT_WEIGHTS_PROPERTY = 'weights';
