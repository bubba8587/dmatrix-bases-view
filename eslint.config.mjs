import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
	{ ignores: ["main.js", "node_modules/**", "scripts/**", "tests/**", "esbuild.config.mjs", "eslint.config.mjs"] },
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: { parser: tseslint.parser, parserOptions: { project: "./tsconfig.json" } },
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", { brands: ["Solenoid", "Solenoid Properties", "Decision Matrix", "Markdown", "Bases"] }],
		},
	},
);
