# Decision Matrix Bases View

A weighted decision matrix for [Obsidian Bases](https://help.obsidian.md/bases). Each note in the base is an option with a Scores frame, one column per criterion, and a Weights frame on your decision note says how much each criterion counts. The view scores and ranks the options by the same rules as [Solenoid](https://solenoid-ngc.vercel.app)'s Decision Matrix node, so a decision reads the same in both.

![The Decision Matrix and Rankings views in the Solenoid look](assets/screenshot.png)

## Requirements

- Obsidian **1.10.2** or later.
- The **[Solenoid Properties](https://github.com/bubba8587/Solenoid-Properties)** plugin, enabled. The Scores and Weights frames are Solenoid Properties Frame properties, and the view edits them with Solenoid's Frame editor. The view is styled for Solenoid Properties' Solenoid look, so turn that on in its settings.

## Views

- **Decision Matrix**: a table with an option per row and a criterion per column. Each criterion's Weight and Norm sit under its name. Values edit in place and save to the option's Scores frame.
- **Decision Matrix Rankings**: every option best first as a labeled bar.

Both views have two controls, saved with the view:

- **Normalize**: Raw, ÷ Max (the default) or Rank. It puts criteria on one footing, so dollars and out-of-10 ratings compare. ÷ Max divides each criterion by its largest value. Rank keeps only the order, worst 0 to best 1. A criterion's own Norm overrides it.
- **Output**: Summary or Breakdown. Breakdown shows each criterion's signed contribution, which add up to the Score, so a negative weight reads as the penalty it is. In the Rankings view each bar splits into those contributions.

## Working in the matrix

- **Enter** or **↓** moves down a column and **↑** moves up, like a spreadsheet. A blank cell shows a faint dashed 0 so gaps are easy to spot.
- In a Weight field, **↑** and **↓** step it by 1, and by 0.1 with **Shift**.
- **Add Criterion** under the table names a new criterion and adds its row to the Weights frame. Its column is ready for values straight away, and it starts counting once a note has a value, which keeps the scores the same as Solenoid's.
- A criterion's header menu has **Rename** (the Scores frame on every note and the Weights row), **Lower Is Better** (flips the weight's sign) and **Remove Criterion**.
- **New Option** starts a note in the base with a Scores row holding every criterion.
- Hover an option's name for a page preview, or right-click it for the file menu.
- The Rank, Option and Score columns stay put while a wide matrix scrolls.
- **⋯** in the toolbar has **Copy as Markdown**, which copies the ranking as a table (with the contributions under Breakdown), and **Reset Weights**.

## How close is the call?

Above each view a line names the leader, the runner-up and the margin between them, or says who is tied for first.

Under each weight, **Flips at** is the weight at which a different option would take first place if every other weight stayed put. A flip point near the current weight means the decision hangs on that weight; **never** means no weight on that criterion changes the winner. Clicking a flip point sets the weight to it.

## Scoring

- Score = `Σ(value × weight) / Σ|weight|`, rounded to 4 decimal places.
- Options rank on the rounded score. Equal scores share a rank, shown as `=2`.
- A blank value counts as 0, and a checkbox counts as 1 or 0. Dates and text are never criteria.
- A negative weight favors lower values, like cost or risk.

## The Scores frame

Each option note keeps its scores in one Frame property named `scores`: a single row with a column per criterion. Number and checkbox columns are the criteria; text and date columns are ignored, so a note can carry a vendor name or a release date beside its scores.

```yaml
scores:
  - cost: 950
    performance: 9
    backlit: true
```

The criteria are every such column across the notes in the base, so a note missing a column scores 0 there. Typing a value into the matrix for a note with no Scores frame creates one. Stacked note by note, these rows are the Scores frame Solenoid's Decision Matrix takes.

## The Weights frame

The decision note is the note that embeds the base (`![[my-decision.base]]`). Give it a Frame property named `weights`, one row per criterion:

```yaml
weights:
  - Criterion: cost
    Weight: -3
    Norm: Rank
  - Criterion: performance
    Weight: 5
    Norm: null
```

- **Criterion** matches a Scores column name, ignoring case.
- **Weight** defaults to 1 for a criterion the frame leaves out.
- **Norm** is optional: Raw, ÷Max or Rank. Blank follows the view's Normalize.

This is the same table Solenoid's Decision Matrix takes on its Weights input, so the note imports straight into Solenoid.

**Create Weights** in the toolbar writes a frame with every criterion at weight 1. After that the toolbar shows the frame's chip, which opens Solenoid's Frame editor. The weight fields and Norm menus in the table write to the same frame.

Each view has three options in the Bases view settings: **Scores property** and **Weights property**, to use other property names, and **Weights note**, to read the Weights frame from a note other than the embedding one.

## Examples

Settings → Decision Matrix → **Create Examples** adds a "Decision Matrix Examples" folder: four laptops with Scores frames, a base with both views, and a decision note with a Weights frame that embeds both.

## Development

`npm run build` builds `main.js`; `npm test` runs the scoring tests, which mirror Solenoid's own Decision Matrix tests.

## License

MIT
