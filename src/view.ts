/**
 * What both views share: the Solenoid Properties check, the criteria and scores, the Weights frame
 * on the decision note, the toolbar (Normalize, Output, the Weights chip, Copy as Markdown), the
 * leader line, option links, criterion edits, and focus that survives a re-render.
 */
import { BasesView, Menu, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { App, BasesAllOptions, BasesEntry, BasesEntryGroup, HoverParent, HoverPopover, QueryController } from 'obsidian';
import { groupsOf, readMatrix } from './data.ts';
import type { PluginColumnTypes } from './frame.ts';
import { flipWeights, formatScore, leadOf, scoreMatrix } from './scoring.ts';
import type { Detail, MatrixResult, Normalize } from './scoring.ts';
import { assignFrameType, frameChip, loadColumnTypes, releaseChips, solenoid } from './solenoid.ts';
import { DEFAULT_SCORES_PROPERTY, DEFAULT_WEIGHTS_PROPERTY } from './types.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { dropScore, renameScore, setScore } from './scores.ts';
import {
	addCriterion, defaultFrame, isFrameYaml, removeCriterion, renameCriterion, resolveWeights, setNorm, setWeight, weightsProblems,
} from './weights.ts';
import type { ResolvedWeights, WeightsRecord } from './weights.ts';

export const HOVER_SOURCE = 'decision-matrix';

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
	/** Per criterion, the weight at which first place changes hands. */
	flips: (number | null)[];
	detail: Detail;
	/** Whether criteria can be added, renamed and weighed (there is a Weights note with a frame or room for one). */
	canEditCriteria: boolean;
}

interface FocusMemo { key: string; value: string; dirty: boolean; start: number | null; end: number | null }

export abstract class DecisionView extends BasesView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	protected rootEl: HTMLElement;
	protected model: Model | null = null;
	/** Solenoid Properties' picked column types, refreshed after each render. */
	private picks: PluginColumnTypes = {};
	private picksJson = '{}';
	/** A criterion just added: the first render that has its column scrolls to it. */
	protected reveal: string | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement, cls: string) {
		super(controller);
		this.rootEl = containerEl.createDiv(`dmv-root ${cls}`);
	}

	onload(): void {
		// The decision note is outside the query, so a Weights edit never reaches onDataUpdated.
		this.registerEvent(this.app.metadataCache.on('changed', (file) => {
			if (file === this.weightsNote()) this.render();
		}));
		// A column type picked in a note's own Frame editor changes no YAML, so look again on the way back.
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => void this.refreshPicks()));
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

	private entries(): BasesEntry[] {
		return this.data?.groupedData.flatMap((g: BasesEntryGroup) => g.entries) ?? [];
	}

	// ── Writes ────────────────────────────────────────────────

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
		void this.editWeights(f => setWeight(f, c, w, this.weightPicks));
	}

	protected setNorm(c: MatrixCriterion, mode: Normalize | null): void {
		void this.editWeights(f => setNorm(f, c, mode, this.weightPicks));
	}

	/** Sets one cell of the option's Scores frame, making the frame when the note has none. */
	protected async writeCell(item: DecisionItem, c: MatrixCriterion, value: number | boolean | null): Promise<void> {
		const key = this.scoresProperty;
		assignFrameType(this.app, key);
		await this.app.fileManager.processFrontMatter(item.file, (fm: Record<string, unknown>) => {
			fm[key] = setScore(fm[key], c.name, value);
		});
	}

	/** Rewrites every option's Scores frame that `edit` changes (null means leave the note alone). */
	private async editScores(edit: (value: unknown) => WeightsRecord[] | null): Promise<void> {
		const key = this.scoresProperty;
		for (const entry of this.entries()) {
			const before = this.app.metadataCache.getFileCache(entry.file)?.frontmatter?.[key];
			if (edit(before) === null) continue;
			await this.app.fileManager.processFrontMatter(entry.file, (fm: Record<string, unknown>) => {
				const next = edit(fm[key]);
				if (next) fm[key] = next;
			});
		}
	}

	private nameTaken(name: string, except?: MatrixCriterion): boolean {
		const key = name.trim().toLowerCase();
		return (this.model?.criteria ?? []).some(c => c !== except && c.name.trim().toLowerCase() === key);
	}

	protected addCriterion(name: string): void {
		name = name.trim();
		if (!name) return;
		if (this.nameTaken(name)) { new Notice(`There is already a criterion named ${name}.`); return; }
		this.reveal = name;
		void this.editWeights(f => addCriterion(f, name, this.weightPicks));
	}

	protected async renameCriterion(c: MatrixCriterion, to: string): Promise<void> {
		to = to.trim();
		if (!to || to === c.name) return;
		if (this.nameTaken(to, c)) { new Notice(`There is already a criterion named ${to}.`); return; }
		await this.editScores(v => renameScore(v, c.name, to));
		if (this.weightsFrame(this.weightsNote())) await this.editWeights(f => renameCriterion(f, c, to, this.weightPicks));
	}

	protected removeCriterion(c: MatrixCriterion): void {
		const key = this.scoresProperty;
		const notes = this.entries().filter(e => dropScore(this.app.metadataCache.getFileCache(e.file)?.frontmatter?.[key], c.name) !== null).length;
		const where = notes === 1 ? '1 note' : `${notes} notes`;
		new ConfirmModal(this.app, `Remove ${c.label}?`, `Its scores are deleted from ${where} and its row from the Weights frame.`, 'Remove', async () => {
			await this.editScores(v => dropScore(v, c.name));
			if (this.weightsFrame(this.weightsNote())) await this.editWeights(f => removeCriterion(f, c, this.weightPicks));
		}).open();
	}

	// ── Option links ──────────────────────────────────────────

	protected optionLink(parent: HTMLElement, item: DecisionItem, cls = 'dmv-link'): HTMLElement {
		const link = parent.createEl('a', { text: item.title, cls, href: '#' });
		link.addEventListener('click', (e) => {
			e.preventDefault();
			void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(item.file);
		});
		link.addEventListener('mouseover', (event) => {
			this.app.workspace.trigger('hover-link', {
				event, source: HOVER_SOURCE, hoverParent: this, targetEl: link, linktext: item.file.path, sourcePath: '',
			});
		});
		link.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			this.app.workspace.trigger('file-menu', menu, item.file, HOVER_SOURCE);
			menu.showAtMouseEvent(e);
		});
		return link;
	}

	// ── Render ────────────────────────────────────────────────

	protected render(): void {
		if (!this.data) return;
		const root = this.rootEl;
		const memo = this.rememberFocus();
		let scrollLeft = root.querySelector('.dmv-table-wrap')?.scrollLeft ?? 0;
		releaseChips(this.app, root);
		root.empty();
		this.model = null;

		if (!solenoid(this.app)) {
			state(root, 'Decision Matrix needs the Solenoid Properties plugin. Install and enable it, then reopen this view.');
			return;
		}

		const entries = this.entries();
		const note = this.weightsNote();
		const frame = this.weightsFrame(note);
		const matrix = readMatrix(this.app, entries, this.scoresProperty, frame ?? null, this.weightsProperty, this.picks);
		const criteria = matrix.criteria;
		const canEditCriteria = note !== null && frame !== null;

		this.renderToolbar(root.createDiv('dmv-toolbar'), note, frame, criteria);
		this.renderProblems(root, frame ?? null, matrix.problems);
		void this.refreshPicks();

		if (entries.length === 0) {
			state(root, 'No options. The base\'s filters match no notes.');
			return;
		}
		if (criteria.length === 0) {
			const empty = root.createDiv('dmv-state');
			empty.createDiv({ text: `No criteria yet. Give the notes a ${this.scoresProperty} Frame with a number column per criterion.` });
			if (canEditCriteria) {
				draftInput(empty.createDiv('dmv-state-action'), 'dmv-input dmv-name-input', '', (name) => this.addCriterion(name), {
					inputmode: 'text', placeholder: 'Criterion name', 'aria-label': 'New criterion', 'data-dmv-key': 'new-criterion',
				});
			}
			this.restoreFocus(memo);
			return;
		}

		const groups = groupsOf(this.data.groupedData, matrix.cells);
		const items = groups.flatMap(g => g.items);
		const resolved = resolveWeights(frame ?? null, criteria, this.weightPicks);
		const result = scoreMatrix({
			columns: criteria.map((_, j) => items.map(it => it.cells[j])),
			// A criterion no note scores yet is not in Solenoid's Scores frame, so it weighs nothing here either.
			weights: resolved.weights.map((w, j) => (criteria[j].pending ? 0 : w)),
			norms: resolved.norms,
			normalize: this.normalize,
		});
		const row = new Map(items.map((it, i) => [it.id, i]));
		this.model = {
			criteria, groups, items, result, row, resolved,
			flips: flipWeights(result),
			detail: this.detail,
			canEditCriteria,
		};

		const reveal = this.reveal?.toLowerCase();
		if (reveal && criteria.some(c => c.name.toLowerCase() === reveal)) {
			this.reveal = null;
			scrollLeft = Number.MAX_SAFE_INTEGER;
		}

		const body = root.createDiv('dmv-body');
		this.renderLead(body, this.model);
		this.renderBody(body, this.model);
		const wrap = root.querySelector('.dmv-table-wrap');
		if (wrap) wrap.scrollLeft = scrollLeft;
		this.restoreFocus(memo);
	}

	private get weightPicks() {
		return this.picks[this.weightsProperty] ?? {};
	}

	/** Re-renders when Solenoid Properties' picks have changed since the last read. */
	private async refreshPicks(): Promise<void> {
		const next = await loadColumnTypes(this.app);
		const json = JSON.stringify(next);
		if (json === this.picksJson) return;
		this.picks = next;
		this.picksJson = json;
		this.render();
	}

	/** Frames that read differently than they look: said once, above the table. */
	private renderProblems(parent: HTMLElement, frame: WeightsRecord[] | null, scores: { name: string; notes: DecisionItem[] }[]): void {
		const weights = weightsProblems(frame, this.weightPicks);
		if (weights.length === 0 && scores.length === 0) return;
		const box = parent.createDiv('dmv-problems');
		for (const text of weights) box.createDiv({ text, cls: 'dmv-problem' });
		for (const p of scores) {
			const line = box.createDiv('dmv-problem');
			line.createSpan({ text: `${p.name} is not a criterion: ` });
			const shown = p.notes.slice(0, 3);
			shown.forEach((item, k) => {
				if (k > 0) line.createSpan({ text: k === shown.length - 1 && p.notes.length <= 3 ? ' and ' : ', ' });
				this.optionLink(line, item, 'dmv-link dmv-problem-note');
			});
			if (p.notes.length > 3) line.createSpan({ text: ` and ${p.notes.length - 3} more` });
			line.createSpan({ text: ` ${p.notes.length === 1 ? 'has' : 'have'} text in that column.` });
		}
	}

	private renderLead(parent: HTMLElement, m: Model): void {
		const { leaders, margin } = leadOf(m.result);
		if (m.items.length < 2 || leaders.length === 0) return;
		const line = parent.createDiv('dmv-lead');
		const names = leaders.map(i => m.items[i]);
		if (names.length === 1) {
			this.optionLink(line, names[0], 'dmv-link dmv-lead-name');
			const next = Math.min(...m.result.ranks.filter(r => r > 1));
			const runnersUp = m.items.filter((_, i) => m.result.ranks[i] === next);
			if (runnersUp.length === 1) {
				line.createSpan({ text: ' leads ' });
				this.optionLink(line, runnersUp[0], 'dmv-link dmv-lead-name');
				line.createSpan({ text: ' by ' });
			} else {
				line.createSpan({ text: ' leads by ' });
			}
			line.createSpan({ text: formatScore(margin ?? 0), cls: 'dmv-lead-margin' });
			return;
		}
		names.forEach((item, k) => {
			if (k > 0) line.createSpan({ text: k === names.length - 1 ? ' and ' : ', ' });
			this.optionLink(line, item, 'dmv-link dmv-lead-name');
		});
		line.createSpan({ text: names.length === m.items.length ? ' all tie' : ' tie for first' });
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
			const btn = weights.createEl('button', { text: 'Create Weights', cls: 'dmv-btn', attr: { title: 'Add a Weights frame to the decision note' } });
			btn.disabled = criteria.length === 0;
			btn.addEventListener('click', () => {
				assignFrameType(this.app, key);
				void this.writeWeights(defaultFrame(criteria));
			});
		} else if (frame === null) {
			weights.createSpan({ text: `${key} on ${note.basename} is not a Frame`, cls: 'dmv-muted dmv-error' });
		} else {
			const chip = weights.createSpan('dmv-chip');
			// The editor saves its column types beside the YAML, a moment after this fires.
			frameChip(this.app, chip, key, frame, (next) => {
				void this.writeWeights(next);
				window.setTimeout(() => void this.refreshPicks(), 400);
			});
			weights.createSpan({ text: note.basename, cls: 'dmv-muted' });
		}

		const more = bar.createEl('button', { cls: 'dmv-icon-btn', attr: { 'aria-label': 'More' } });
		setIcon(more, 'more-horizontal');
		more.addEventListener('click', (e) => {
			const menu = new Menu();
			menu.addItem(i => i.setTitle('Copy as Markdown').setIcon('copy').setDisabled(!this.model).onClick(() => void this.copyMarkdown()));
			if (this.model?.canEditCriteria) {
				menu.addItem(i => i.setTitle('Reset Weights').setIcon('rotate-ccw').onClick(() => {
					new ConfirmModal(this.app, 'Reset every weight to 1?', 'Norm overrides are cleared too.', 'Reset', async () => {
						await this.writeWeights(defaultFrame(this.model?.criteria ?? criteria));
					}).open();
				}));
			}
			showMenu(menu, more, e);
		});
	}

	/** The ranking best first as a Markdown table, with the contributions under Breakdown. */
	private async copyMarkdown(): Promise<void> {
		const m = this.model;
		if (!m) return;
		const cell = (s: string) => s.replace(/\|/g, '\\|');
		const breakdown = m.detail === 'breakdown';
		const head = ['Rank', 'Option', ...(breakdown ? m.criteria.map(c => cell(c.label)) : []), 'Score'];
		const order = m.items.map((_, i) => i).sort((a, b) => m.result.ranks[a] - m.result.ranks[b]);
		const lines = [
			`| ${head.join(' | ')} |`,
			`| ${head.map((_, k) => (k === 1 ? '---' : '---:')).join(' | ')} |`,
			...order.map(i => {
				const cells = [
					rankText(m.result.ranks[i], m.result.tied[i]),
					cell(m.items[i].title),
					...(breakdown ? m.result.contributions.map(col => formatScore(col[i])) : []),
					formatScore(m.result.scores[i]),
				];
				return `| ${cells.join(' | ')} |`;
			}),
		];
		await navigator.clipboard.writeText(lines.join('\n'));
		new Notice('Ranking copied as Markdown');
	}

	// ── Focus across re-renders ───────────────────────────────

	private rememberFocus(): FocusMemo | null {
		const el = this.rootEl.ownerDocument.activeElement;
		if (!(el instanceof HTMLInputElement) || !this.rootEl.contains(el) || !el.dataset.dmvKey) return null;
		return {
			key: el.dataset.dmvKey,
			value: el.value,
			dirty: el.value.trim() !== (el.dataset.settled ?? ''),
			start: el.selectionStart,
			end: el.selectionEnd,
		};
	}

	private restoreFocus(memo: FocusMemo | null): void {
		if (!memo) return;
		const el = Array.from(this.rootEl.querySelectorAll<HTMLInputElement>('input[data-dmv-key]')).find(i => i.dataset.dmvKey === memo.key);
		if (!el) return;
		if (memo.dirty) el.value = memo.value;
		el.focus();
		if (memo.start !== null) el.setSelectionRange(memo.start, memo.end ?? memo.start);
	}
}

class ConfirmModal extends Modal {
	constructor(app: App, private heading: string, private message: string, private action: string, private onConfirm: () => Promise<void>) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.heading);
		this.contentEl.createEl('p', { text: this.message });
		const buttons = this.contentEl.createDiv('modal-button-container');
		buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		buttons.createEl('button', { text: this.action, cls: 'mod-warning' }).addEventListener('click', () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** Opens a menu under its button; a right-click opens it at the pointer. */
export function showMenu(menu: Menu, anchor: HTMLElement, e: MouseEvent): void {
	if (e.type === 'contextmenu') { menu.showAtMouseEvent(e); return; }
	const r = anchor.getBoundingClientRect();
	menu.showAtPosition({ x: r.left, y: r.bottom + 4, width: r.width, overlap: true, left: false }, anchor.ownerDocument);
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

/**
 * A value field that commits on Enter or clickaway and reverts on Escape. The settled text rides
 * `data-settled`, so a caller that commits by other means (a stepped weight) can settle it too.
 */
export function draftInput(
	parent: HTMLElement,
	cls: string,
	value: string,
	onCommit: (text: string) => void,
	attrs: Record<string, string> = {},
): HTMLInputElement {
	const input = parent.createEl('input', { cls, type: 'text', attr: { inputmode: 'decimal', spellcheck: 'false', ...attrs } });
	input.value = value;
	input.dataset.settled = value;
	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
		if (e.key === 'Escape') { input.value = input.dataset.settled ?? ''; input.blur(); }
	});
	input.addEventListener('blur', () => {
		const text = input.value.trim();
		if (text === input.dataset.settled) return;
		input.dataset.settled = text;
		onCommit(text);
	});
	return input;
}

export function rankText(rank: number, tied: boolean): string {
	return tied ? `=${rank}` : String(rank);
}
