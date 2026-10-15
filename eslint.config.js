import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/** AGENTS.md: every boolean starts with one of these. */
const BOOLEAN_PREFIXES = [
	'is',
	'has',
	'should',
	'can',
	'did',
	'will',
	'was',
	'are',
	'allow',
	'needs'
];

/** AGENTS.md: booleans carry a prefix. Not object-literal properties: those are mostly options of platform and framework APIs, and a property we own is declared in a type. */
const BOOLEAN_NAMING = [
	'error',
	{
		selector: [
			'variable',
			'parameter',
			'typeProperty',
			'classProperty',
			'parameterProperty',
			'accessor'
		],
		leadingUnderscore: 'allow',
		types: ['boolean'],
		format: ['PascalCase'],
		prefix: BOOLEAN_PREFIXES
	}
];

export default ts.config(
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'drizzle/',
			'static/',
			'worker-configuration.d.ts',
			'.claude/',
			'tools/setup/node_modules/'
		]
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// TypeScript checks undefined names itself, and no-undef flags its ambient types.
			'no-undef': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			],
			// A warning, not an error: about forty existing uses are tracked for a typing pass and
			// forcing them here would mix type changes into the lint rollout.
			'@typescript-eslint/no-explicit-any': 'warn',
			// The rule is for state that must react. Every hit builds a throwaway URLSearchParams,
			// Map or Set inside a function, where a reactive copy would add cost and no behaviour.
			'svelte/prefer-svelte-reactivity': 'off',
			// prettier-plugin-svelte writes `{' '}` itself to keep a space it would otherwise collapse.
			'svelte/no-useless-mustaches': 'off'
		}
	},
	{
		// The entry is outside `src`, so it does not see the ambient Worker types any other way.
		files: ['workers/entry.ts'],
		rules: { '@typescript-eslint/triple-slash-reference': 'off' }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: {
			parserOptions: {
				parser: ts.parser,
				projectService: true,
				extraFileExtensions: ['.svelte']
			}
		}
	},
	{
		files: ['src/**/*.{ts,svelte}'],
		ignores: ['**/*.d.ts'],
		languageOptions: {
			parserOptions: { projectService: true, extraFileExtensions: ['.svelte'] }
		},
		rules: {
			'@typescript-eslint/naming-convention': BOOLEAN_NAMING
		}
	},
	{
		// Server and shared code is imported by workers and tests that have no DOM or SvelteKit
		// runtime, so a pull towards UI code makes them unloadable there (it once did for palette).
		files: ['src/lib/server/**/*.ts', 'src/lib/shared/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['#lib/components/*', '**/components/*', '$app/*'],
							message:
								'server/ and shared/ must not depend on UI code (see docs/architecture.md, Layering).'
						}
					]
				}
			]
		}
	},
	{
		// The setup CLI has its own package.json and tsconfig; the project service finds that tsconfig
		// for each file, so the type-aware rules see its Node types and not the Worker ones.
		files: ['tools/setup/**/*.ts'],
		languageOptions: { parserOptions: { projectService: true } },
		rules: {
			'@typescript-eslint/naming-convention': BOOLEAN_NAMING,
			// Explicit `any` appears only where a recorded cf response is read in a test.
			'@typescript-eslint/no-explicit-any': 'off'
		}
	}
);
