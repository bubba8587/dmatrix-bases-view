/**
 * The Decision Matrix view: one table, an option per row and a criterion per column, with the
 * criterion's Weight, Norm and flip point under its name. Values edit in place and save to the
 * option's Scores frame; Weight and Norm save to the Weights frame. Enter and the arrow keys move
 * down and up a column like a spreadsheet.
 */
import { Menu, setIcon } from 'obsidian';
import type { QueryController } from 'obsidian';
import { formatScore } from './scoring.ts';
import type { Normalize } from './scoring.ts';
import type { DecisionItem, ItemGroup, MatrixCriterion } from './types.ts';
import { DecisionView, NORMALIZE_OPTIONS, draftInput, rankText, showMenu } from './view.ts';
import type { Model } from './view.ts';

const cellKey = (item: DecisionItem, c: MatrixCriterion) => `cell|${item.id}|${c.name}`;
const weightKey = (c: MatrixCriterion) => `weight|${c.name}`;

export class DecisionMatrixView extends DecisionView {
	type = 'decision-matrix';
	private collapsed = new Set<string>();
	/** The criterion whose header is being renamed, or '' while the add column is open. */
	private naming: string | null = null;
	/** Items top to bottom as drawn, for moving down and up a column. */
	private drawn: DecisionItem[] = [];

	/** The row order last drawn, held while a value cell has focus, so a save never moves the row being typed in. */
	private heldOrder: string[] | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller, containerEl, 'dmv-matrix');
		// Leaving the table lets the rows take their new ranks.
		this.rootEl.addEventListener('focusout', () => window.setTimeout(() => {
			if (this.heldOrder && !this.rootEl.contains(this.rootEl.ownerDocument.activeElement)) {
				this.heldOrder = null;
				this.render();
			}
		}));
	}

	protected renderBody(body: HTMLElement, m: Model): void {
		const wrap = body.createDiv('dmv-table-wrap');
		const table = wrap.createEl('table', { cls: 'dmv-table' });
		this.renderHead(table.createEl('thead'), m);

		const tbody = table.createEl('tbody');
		const span = m.criteria.length + 3;
		const maxAbs = m.result.scores.reduce((a, s) => Math.max(a, Math.abs(s)), 0);
		const sorted = this.config.getSort().length > 0;
		const rank = (it: DecisionItem) => m.result.ranks[m.row.get(it.id)!];
		const held = m.editing ? this.heldOrder : null;
		const heldAt = (it: DecisionItem) => { const k = held?.indexOf(it.id) ?? -1; return k < 0 ? Infinity : k; };
		this.drawn = [];
		for (const group of m.groups) {
			if (group.key !== '') this.renderGroupRow(tbody, group, span);
			if (this.collapsed.has(group.key)) continue;
			const items = sorted ? group.items : [...group.items].sort(held ? (a, b) => heldAt(a) - heldAt(b) : (a, b) => rank(a) - rank(b));
			for (const item of items) {
				this.drawn.push(item);
				this.renderRow(tbody, item, m, maxAbs);
			}
		}

		this.heldOrder = this.drawn.map(it => it.id);

		if (!m.canEditCriteria) return;
		const foot = tbody.createEl('tr', { cls: 'dmv-new-row' }).createEl('td', { cls: 'dmv-td', attr: { colspan: String(span) } }).createDiv('dmv-foot');
		if (this.naming === '') this.nameField(foot, '', 'New criterion', (name) => this.addCriterion(name));
		else textButton(foot, 'Add Criterion', () => { this.naming = ''; this.render(); });
	}

	// ── Head ──────────────────────────────────────────────────

	private renderHead(thead: HTMLElement, m: Model): void {
		const names = thead.createEl('tr', { cls: 'dmv-head' });
		names.createEl('th', { text: 'Rank', cls: 'dmv-th dmv-th-rank' });
		names.createEl('th', { text: 'Option', cls: 'dmv-th dmv-th-option' });
		for (const c of m.criteria) this.renderCriterionHead(names, c, m);
		names.createEl('th', { text: 'Score', cls: 'dmv-th dmv-th-num dmv-th-score', attr: { title: 'Σ(value × weight) / Σ|weight|' } });

		const anyFlip = m.flips.some(f => f !== null);
		const weights = thead.createEl('tr', { cls: 'dmv-weights-row' });
		weights.createEl('th', { cls: 'dmv-th' });
		const caption = weights.createEl('th', { cls: 'dmv-th dmv-th-option' });
		caption.createSpan({ text: 'Weight', cls: 'dmv-caption' });
		caption.createSpan({ text: 'Norm', cls: 'dmv-caption' });
		if (anyFlip) {
			caption.createSpan({ text: 'Flips at', cls: 'dmv-caption', attr: { title: 'The weight at which another option would take first place, with every other weight held' } });
		}
		m.criteria.forEach((c, j) => {
			const cell = weights.createEl('th', { cls: 'dmv-th dmv-th-num' }).createDiv('dmv-weight-cell');
			this.renderWeightInput(cell, c, m.resolved.weights[j], m.canEditCriteria);
			this.renderNormSelect(cell, c, m.resolved.norms[j], m.canEditCriteria);
			if (!anyFlip) return;
			const flip = m.flips[j];
			if (flip === null) {
				cell.createSpan({ text: 'never', cls: 'dmv-flip is-never', attr: { title: 'No weight here changes first place' } });
				return;
			}
			cell.createSpan({ text: String(flip), cls: 'dmv-flip', attr: { 'aria-label': `Flip point of ${c.label}` } });
		});
		weights.createEl('th', { cls: 'dmv-th' });
	}

	private renderCriterionHead(row: HTMLElement, c: MatrixCriterion, m: Model): void {
		const th = row.createEl('th', {
			cls: c.pending ? 'dmv-th dmv-th-num dmv-th-criterion is-pending' : 'dmv-th dmv-th-num dmv-th-criterion',
			attr: c.pending ? { title: 'Not scored yet. It counts once a note has a value.' } : {},
		});
		if (this.naming === c.name) {
			this.nameField(th, c.name, `Rename ${c.label}`, (to) => void this.renameCriterion(c, to));
			return;
		}
		const btn = th.createEl('button', { cls: 'dmv-head-btn', attr: { 'aria-label': `${c.label} options` } });
		btn.createSpan({ text: c.label });
		setIcon(btn.createSpan('dmv-head-chevron'), 'chevron-down');
		const open = (e: MouseEvent) => {
			e.preventDefault();
			const w = m.resolved.weights[m.criteria.indexOf(c)];
			const menu = new Menu();
			menu.addItem(i => i.setTitle('Rename').setIcon('pencil').onClick(() => { this.naming = c.name; this.render(); }));
			menu.addItem(i => i
				.setTitle(w < 0 ? 'Higher Is Better' : 'Lower Is Better')
				.setIcon('arrow-down-up')
				.setDisabled(!m.canEditCriteria || w === 0)
				.onClick(() => this.setWeight(c, -w)));
			menu.addSeparator();
			menu.addItem(i => i.setTitle('Remove Criterion').setIcon('trash-2').setWarning(true).onClick(() => this.removeCriterion(c)));
			showMenu(menu, btn, e);
		};
		btn.addEventListener('click', open);
		btn.addEventListener('contextmenu', open);
	}

	/** A criterion name field: Enter commits, Escape or leaving it cancels. */
	private nameField(parent: HTMLElement, value: string, label: string, onCommit: (name: string) => void): void {
		const done = () => { this.naming = null; this.render(); };
		const input = draftInput(parent, 'dmv-input dmv-name-input', value, (name) => {
			this.naming = null;
			if (name) onCommit(name);
			this.render();
		}, { inputmode: 'text', placeholder: 'Criterion', 'aria-label': label });
		input.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
		input.addEventListener('blur', () => { if (this.naming !== null) done(); });
		window.setTimeout(() => { input.focus(); input.select(); });
	}

	private renderWeightInput(parent: HTMLElement, c: MatrixCriterion, weight: number, editable: boolean): void {
		const input = draftInput(parent, 'dmv-input dmv-weight-input', String(weight), (text) => {
			const w = text === '' ? 1 : Number(text);
			if (Number.isFinite(w)) this.setWeight(c, w);
			else this.render();
		}, {
			'aria-label': `Weight of ${c.label}`,
			title: 'Weight. Negative when lower is better. Up and Down step it by 1, with Shift by 0.1.',
			'data-dmv-key': weightKey(c),
		});
		input.disabled = !editable;
		input.addEventListener('keydown', (e) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			e.preventDefault();
			const step = (e.shiftKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
			const next = Math.round(((Number(input.value) || 0) + step) * 1000) / 1000;
			input.value = String(next);
			input.dataset.settled = input.value;
			this.setWeight(c, next);
		});
	}

	private renderNormSelect(parent: HTMLElement, c: MatrixCriterion, own: Normalize | null, editable: boolean): void {
		const select = parent.createEl('select', {
			cls: own ? 'dmv-norm is-set' : 'dmv-norm',
			attr: { 'aria-label': `Norm of ${c.label}`, title: 'Norm. Blank follows the view\'s Normalize.' },
		});
		const fallback = NORMALIZE_OPTIONS.find(o => o.value === this.normalize)!.label;
		select.createEl('option', { text: `(${fallback})`, value: '' });
		for (const o of NORMALIZE_OPTIONS) select.createEl('option', { text: o.label, value: o.value });
		select.value = own ?? '';
		select.disabled = !editable;
		select.addEventListener('change', () => this.setNorm(c, (select.value || null) as Normalize | null));
	}

	// ── Body ──────────────────────────────────────────────────

	private renderGroupRow(tbody: HTMLElement, group: ItemGroup, span: number): void {
		const tr = tbody.createEl('tr', { cls: 'dmv-group' });
		const td = tr.createEl('td', { attr: { colspan: String(span) } });
		const collapsed = this.collapsed.has(group.key);
		td.createSpan({ cls: collapsed ? 'dmv-chevron is-collapsed' : 'dmv-chevron' });
		td.createSpan({ text: group.key });
		td.createSpan({ text: String(group.items.length), cls: 'dmv-count' });
		tr.addEventListener('click', () => {
			if (collapsed) this.collapsed.delete(group.key);
			else this.collapsed.add(group.key);
			this.render();
		});
	}

	private renderRow(tbody: HTMLElement, item: DecisionItem, m: Model, maxAbs: number): void {
		const i = m.row.get(item.id)!;
		const rank = m.result.ranks[i];
		const tr = tbody.createEl('tr', { cls: rank === 1 ? 'dmv-row is-top' : 'dmv-row' });
		tr.createEl('td', { text: rankText(rank, m.result.tied[i]), cls: 'dmv-td dmv-td-rank' });
		this.optionLink(tr.createEl('td', { cls: 'dmv-td dmv-td-option' }), item);

		m.criteria.forEach((c, j) => {
			const td = tr.createEl('td', { cls: 'dmv-td dmv-td-num' });
			if (m.detail === 'breakdown') {
				const contribution = m.result.contributions[j][i];
				td.createDiv({ text: formatScore(contribution), cls: contribution < 0 ? 'dmv-contrib is-negative' : 'dmv-contrib' });
			}
			this.renderValue(td, item, c, j);
		});

		const score = tr.createEl('td', { cls: 'dmv-td dmv-td-num dmv-td-score' });
		const s = m.result.scores[i];
		score.createSpan({ text: formatScore(s), cls: 'dmv-score' });
		const gauge = score.createDiv('dmv-gauge');
		const fill = gauge.createDiv(s < 0 ? 'dmv-gauge-fill is-negative' : 'dmv-gauge-fill');
		fill.style.width = `${maxAbs > 0 ? (Math.abs(s) / maxAbs) * 100 : 0}%`;
	}

	private renderValue(td: HTMLElement, item: DecisionItem, c: MatrixCriterion, j: number): void {
		const cell = item.cells[j];
		const sub = td.hasChildNodes();
		if (c.logical) {
			const box = td.createEl('input', { type: 'checkbox', cls: sub ? 'dmv-check is-sub' : 'dmv-check', attr: { 'aria-label': `${c.label} of ${item.title}` } });
			box.checked = cell === true;
			box.addEventListener('change', () => void this.writeCell(item, c, box.checked));
			return;
		}
		// A value the number column cannot read is ignored: it scores as blank, and shows as written.
		const ignored = typeof cell === 'number' && Number.isNaN(cell);
		const cls = `dmv-input dmv-value-input${sub ? ' is-sub' : ''}${cell === null ? ' is-blank' : ''}${ignored ? ' is-ignored' : ''}`;
		const input = draftInput(td, cls, cell === null ? '' : ignored ? item.raw[j] : String(cell), (next) => {
			if (next === '') { void this.writeCell(item, c, null); return; }
			const n = Number(next);
			if (Number.isFinite(n)) void this.writeCell(item, c, n);
			else this.render();
		}, {
			'aria-label': `${c.label} of ${item.title}`,
			placeholder: '0',
			'data-dmv-key': cellKey(item, c),
			...(ignored ? { title: 'Not a number, so it counts as blank' } : {}),
		});
		input.addEventListener('keydown', (e) => {
			const down = e.key === 'Enter' || e.key === 'ArrowDown';
			if (!down && e.key !== 'ArrowUp') return;
			// By path: a re-render since this field was drawn makes new row objects.
			const at = this.drawn.findIndex(d => d.id === item.id);
			const target = at < 0 ? undefined : this.drawn[at + (down ? 1 : -1)];
			if (e.key !== 'Enter') e.preventDefault();
			if (!target) return;
			e.preventDefault();
			const el = Array.from(this.rootEl.querySelectorAll<HTMLInputElement>('input[data-dmv-key]'))
				.find(x => x.dataset.dmvKey === cellKey(target, c));
			el?.focus();
		});
		input.addEventListener('focus', () => input.select());
	}
}

function textButton(parent: HTMLElement, text: string, onClick: () => void): void {
	const btn = parent.createEl('button', { cls: 'dmv-text-btn' });
	setIcon(btn.createSpan('dmv-text-btn-icon'), 'plus');
	btn.createSpan({ text });
	btn.addEventListener('click', onClick);
}
