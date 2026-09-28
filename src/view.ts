/**
 * What both views share: the Solenoid Properties check, the criteria and scores, the Weights frame
 * on the decision note, and the toolbar (Normalize, Output, the Weights chip).
 */
import { BasesView, TFile } from 'obsidian';
import type { BasesAllOptions, BasesEntryGroup, QueryController } from 'obsidian';
import { detectCriteria, groupsOf } from './data.ts';
import { scoreMatrix } from './scoring.ts';
import type { Detail, MatrixResult, Normalize } from './scoring.ts';
import { assignFrameType, frameChip, releaseChips, solenoid } from './solenoid.ts';
import { DEFAULT_SCORES_PROPERTY, DEFAULT_WEIGHTS_PROPERTY } from './types.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { setScore } from './scores.ts';
import { defaultFrame, isFrameYaml, resolveWeights, setNorm, setWeight } from './weights.ts';
import type { ResolvedWeights, WeightsRecord } from './weights.ts';

export const NORMALIZE_OPTIONS: { value: Normalize; label: string; title: string }[] = [
	{ value: 'none', label: 'Raw', title: 'Use the numbers as they are. Right when every criterion shares one scale.' },
	{ value: 'max', label: '÷ Max', title: 'Divide each criterion by its biggest value so each tops out at 1. Puts dollars and out-of-10 scores on the same footing.' },
	{ value: 'rank', label: 'Rank', title: 'Keep only each criterion\'s order, worst 0 to best 1.' },
];

const DETAIL_OPTIONS: { value: Detail; label: string; title: string }[] = [
	{ value: 'summary', label: 'Summary', title: 'Show each option\'s values, Score and Rank' },
	{ value: 'breakdown', label: 'Breakdown', title: 'Show each criterion\'s signed contribution. The contributions sum to the Score.' },
];

export function viewOptions(): BasesAllOptions[] {
	return [
		{
			type: 'dropdown',
			key: 'normalize',
			displayName: 'Normalize',
			default: 'max',
			options: { none: 'Raw', max: '÷ Max', rank: 'Rank' },
		},
		{
			type: 'dropdown',
			key: 'detail',
			displayName: 'Output',
			default: 'summary',
			options: { summary: 'Summary', breakdown: 'Breakdown' },
		},
		{
			type: 'text',
			key: 'scoresProperty',
			displayName: 'Scores property',
			default: DEFAULT_SCORES_PROPERTY,
			placeholder: DEFAULT_SCORES_PROPERTY,
		},
		{
			type: 'text',
			key: 'weightsProperty',
			displayName: 'Weights property',
			default: DEFAULT_WEIGHTS_PROPERTY,
			placeholder: DEFAULT_WEIGHTS_PROPERTY,
		},
		{
			type: 'file',
			key: 'weightsNote',
			displayName: 'Weights note',
			placeholder: 'The note this base is embedded in',
			filter: (file) => file.extension === 'md',
		},
	];
}

export interface Model {
	criteria: MatrixCriterion[];
	groups: ItemGroup[];
	items: DecisionItem[];
	result: MatrixResult;
	/** Per item id, its row in `result`. */
	row: Map<string, number>;
	resolved: ResolvedWeights;
	detail: Detail;
}

export abstract class DecisionView extends BasesView {
	protected rootEl: HTMLElement;

	constructor(controller: QueryController, containerEl: HTMLElement, cls: string) {
		super(controller);
		this.rootEl = containerEl.createDiv(`dmv-root ${cls}`);
	}

	onload(): void {
		// The decision note is outside the query, so a Weights edit never reaches onDataUpdated.
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file === this.weightsNote()) this.render();
		}));
	}

	onunload(): void {
		releaseChips(this.app, this.rootEl);
	}

	onDataUpdated(): void {
		this.render();
	}

	protected abstract renderBody(body: HTMLElement, model: Model): void;

	// ── Config ────────────────────────────────────────────────

	protected get normalize(): Normalize {
		const v = this.config.get('normalize');
		return v === 'none' || v === 'rank' ? v : 'max';
	}

	protected get detail(): Detail {
		return this.config.get('detail') === 'breakdown' ? 'breakdown' : 'summary';
	}

	protected get weightsProperty(): string {
		const v = this.config.get('weightsProperty');
		return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_WEIGHTS_PROPERTY;
	}

	protected get scoresProperty(): string {
		const v = this.config.get('scoresProperty');
		return typeof v === 'string' && v.trim() ? v.trim() : DEFAULT_SCORES_PROPERTY;
	}

	/** The picked Weights note, else the note this base is embedded in. */
	protected weightsNote(): TFile | null {
		const picked = this.config.get('weightsNote');
		if (typeof picked === 'string' && picked) {
			const file = this.app.metadataCache.getFirstLinkpathDest(picked.replace(/^\[\[|\]\]$/g, ''), '')
				?? this.app.vault.getAbstractFileByPath(picked);
			if (file instanceof TFile) return file;
		}
		const active = this.app.workspace.getActiveFile();
		return active?.extension === 'md' ? active : null;
	}

	/** The Weights property's value: a frame, `undefined` when absent, `null` when it is something else. */
	protected weightsFrame(note: TFile | null): WeightsRecord[] | null | undefined {
		if (!note) return undefined;
		const v = this.app.metadataCache.getFileCache(note)?.frontmatter?.[this.weightsProperty];
		if (v === undefined) return undefined;
		return isFrameYaml(v) ? v : null;
	}

	protected async writeWeights(next: unknown): Promise<void> {
		const note = this.weightsNote();
		if (!note) return;
		await this.app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
			fm[this.weightsProperty] = next;
		});
	}

	protected async editWeights(edit: (frame: WeightsRecord[]) => WeightsRecord[]): Promise<void> {
		const frame = this.weightsFrame(this.weightsNote());
		if (frame === null) return;
		assignFrameType(this.app, this.weightsProperty);
		await this.writeWeights(edit(frame ?? []));
	}

	protected setWeight(c: MatrixCriterion, w: number): void {
		void this.editWeights(f => setWeight(f, c, w));
	}

	protected setNorm(c: MatrixCriterion, mode: Normalize | null): void {
		void this.editWeights(f => setNorm(f, c, mode));
	}

	/** Sets one cell of the option's Scores frame, making the frame when the note has none. */
	protected async writeCell(item: DecisionItem, c: MatrixCriterion, value: number | boolean | null): Promise<void> {
		const key = this.scoresProperty;
		assignFrameType(this.app, key);
		await this.app.fileManager.processFrontMatter(item.file, (fm: Record<string, unknown>) => {
			fm[key] = setScore(fm[key], c.name, value);
		});
	}

	protected openNote(item: DecisionItem, e?: MouseEvent): void {
		void this.app.workspace.getLeaf(e ? e.ctrlKey || e.metaKey : false).openFile(item.file);
	}

	// ── Render ────────────────────────────────────────────────

	protected render(): void {
		if (!this.data) return;
		releaseChips(this.app, this.rootEl);
		const root = this.rootEl;
		root.empty();

		if (!solenoid(this.app)) {
			state(root, 'Decision Matrix needs the Solenoid Properties plugin. Install and enable it, then reopen this view.');
			return;
		}

		const entries = this.data.groupedData.flatMap((g: BasesEntryGroup) => g.entries);
		const criteria = detectCriteria(this.app, entries, this.scoresProperty);
		const note = this.weightsNote();
		const frame = this.weightsFrame(note);

		this.renderToolbar(root.createDiv('dmv-toolbar'), note, frame, criteria);

		if (criteria.length === 0) {
			state(root, `No criteria yet. Give the notes a ${this.scoresProperty} Frame with a number or checkbox column per criterion.`);
			return;
		}
		if (entries.length === 0) {
			state(root, 'No options. The base\'s filters match no notes.');
			return;
		}

		const groups = groupsOf(this.app, this.data.groupedData, criteria, this.scoresProperty);
		const items = groups.flatMap(g => g.items);
		const resolved = resolveWeights(frame ?? null, criteria);
		const result = scoreMatrix({
			columns: criteria.map((_, j) => items.map(it => it.cells[j])),
			weights: resolved.weights,
			norms: resolved.norms,
			normalize: this.normalize,
		});
		const row = new Map(items.map((it, i) => [it.id, i]));
		this.renderBody(root.createDiv('dmv-body'), { criteria, groups, items, result, row, resolved, detail: this.detail });
	}

	private renderToolbar(bar: HTMLElement, note: TFile | null, frame: WeightsRecord[] | null | undefined, criteria: MatrixCriterion[]): void {
		const normalizeGroup = bar.createDiv('dmv-field');
		normalizeGroup.createSpan({ text: 'Normalize', cls: 'dmv-caption', attr: { title: 'The fallback for a criterion whose Norm cell is blank' } });
		segToggle(normalizeGroup, NORMALIZE_OPTIONS, this.normalize, (v) => { this.config.set('normalize', v); this.render(); });

		const detailGroup = bar.createDiv('dmv-field');
		detailGroup.createSpan({ text: 'Output', cls: 'dmv-caption' });
		segToggle(detailGroup, DETAIL_OPTIONS, this.detail, (v) => { this.config.set('detail', v); this.render(); });

		const weights = bar.createDiv('dmv-field dmv-weights');
		weights.createSpan({ text: 'Weights', cls: 'dmv-caption' });
		const key = this.weightsProperty;
		if (!note) {
			weights.createSpan({ text: 'All 1. Embed this base in a note to weigh criteria.', cls: 'dmv-muted' });
		} else if (frame === undefined) {
			const btn = weights.createEl('button', { text: 'Create Weights', cls: 'dmv-btn', attr: { title: `Add a ${key} Frame to ${note.basename}` } });
			btn.disabled = criteria.length === 0;
			btn.addEventListener('click', () => {
				assignFrameType(this.app, key);
				void this.writeWeights(defaultFrame(criteria));
			});
		} else if (frame === null) {
			weights.createSpan({ text: `${key} on ${note.basename} is not a Frame`, cls: 'dmv-muted dmv-error' });
		} else {
			const chip = weights.createSpan('dmv-chip');
			frameChip(this.app, chip, key, frame, (next) => void this.writeWeights(next));
			weights.createSpan({ text: note.basename, cls: 'dmv-muted' });
		}
	}
}

export function state(parent: HTMLElement, text: string): void {
	parent.createDiv({ text, cls: 'dmv-state' });
}

export function segToggle<T extends string>(
	parent: HTMLElement,
	options: { value: T; label: string; title: string }[],
	value: T,
	onChange: (v: T) => void,
): void {
	const seg = parent.createDiv({ cls: 'dmv-seg', attr: { role: 'radiogroup' } });
	for (const o of options) {
		const btn = seg.createEl('button', {
			text: o.label,
			cls: o.value === value ? 'dmv-seg-btn is-active' : 'dmv-seg-btn',
			attr: { title: o.title, role: 'radio', 'aria-checked': String(o.value === value) },
		});
		btn.addEventListener('click', () => { if (o.value !== value) onChange(o.value); });
	}
}

/** A value field that commits on Enter or clickaway and reverts on Escape. */
export function draftInput(
	parent: HTMLElement,
	cls: string,
	value: string,
	onCommit: (text: string) => void,
	attrs: Record<string, string> = {},
): HTMLInputElement {
	const input = parent.createEl('input', { cls, type: 'text', attr: { inputmode: 'decimal', spellcheck: 'false', ...attrs } });
	input.value = value;
	let settled = value;
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
		if (e.key === 'Escape') { input.value = settled; input.blur(); }
	});
	input.addEventListener('blur', () => {
		const text = input.value.trim();
		if (text === settled) return;
		settled = text;
		onCommit(text);
	});
	return input;
}

export function rankText(rank: number, tied: boolean): string {
	return tied ? `=${rank}` : String(rank);
}
