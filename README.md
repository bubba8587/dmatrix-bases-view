# Decision Matrix Bases View

A weighted decision matrix for [Obsidian Bases](https://help.obsidian.md/bases). Each note in the base is an option, its number and checkbox properties are the criteria, and a Weights frame on your decision note says how much each criterion counts. The view scores and ranks the options by the same rules as [Solenoid](https://solenoid-ngc.vercel.app)'s Decision Matrix node, so a decision reads the same in both.

![The Decision Matrix and Rankings views in the Solenoid look](assets/screenshot.png)

## Requirements

- Obsidian **1.10.2** or later.
- The **[Solenoid Properties](https://github.com/bubba8587/Solenoid-Properties)** plugin, enabled. The Weights frame is a Solenoid Properties Frame property, and the view edits it with Solenoid's Frame editor. The view is styled for Solenoid Properties' Solenoid look, so turn that on in its settings.

## Views

- **Decision Matrix**: a table with an option per row and a criterion per column. Each criterion's Weight and Norm sit under its name. Values edit in place and save to the option's note.
- **Decision Matrix Rankings**: every option best first as a labeled bar.

Both views have two controls, saved with the view:

- **Normalize**: Raw, ÷ Max (the default) or Rank. It puts criteria on one footing, so dollars and out-of-10 ratings compare. ÷ Max divides each criterion by its largest value. Rank keeps only the order, worst 0 to best 1. A criterion's own Norm overrides it.
- **Output**: Summary or Breakdown. Breakdown shows each criterion's signed contribution, which add up to the Score, so a negative weight reads as the penalty it is. In the Rankings view each bar splits into those contributions.

## Scoring

- Score = `Σ(value × weight) / Σ|weight|`, rounded to 4 decimal places.
- Options rank on the rounded score. Equal scores share a rank, shown as `=2`.
- A blank value counts as 0, and a checkbox counts as 1 or 0. Dates and text are never criteria.
- A negative weight favors lower values, like cost or risk.

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

- **Criterion** matches a property name or its Bases display name, ignoring case.
- **Weight** defaults to 1 for a criterion the frame leaves out.
- **Norm** is optional: Raw, ÷Max or Rank. Blank follows the view's Normalize.

This is the same table Solenoid's Decision Matrix takes on its Weights input, so the note imports straight into Solenoid.

**Create Weights** in the toolbar writes a frame with every criterion at weight 1. After that the toolbar shows the frame's chip, which opens Solenoid's Frame editor. The weight fields and Norm menus in the table write to the same frame.

Each view has two options in the Bases view settings: **Weights property**, to use another property name, and **Weights note**, to read the frame from a note other than the embedding one.

## Examples

Settings → Decision Matrix → **Create Examples** adds a "Decision Matrix Examples" folder: four laptops, a base with both views, and a decision note with a Weights frame that embeds both.

## Development

`npm run build` builds `main.js`; `npm test` runs the scoring tests, which mirror Solenoid's own Decision Matrix tests.

## License

MIT
