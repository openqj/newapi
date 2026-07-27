# RelayHub feature architecture

Each new business area belongs in `src/features/<name>/` and exposes only its public API through `index.ts`.

## Required frontend boundary

- `api.ts` owns every desktop command used by the feature. Components must not import Tauri `invoke`.
- `types.ts` owns feature-specific request and display types when they are shared outside one component.
- `components/` and `pages/` contain feature UI. Reuse `src/components/ui` for headings, panels, forms, feedback, dialogs, and tables.
- `index.ts` exports the page/component and API intended for `App.tsx` or another application shell. Do not import another feature's private files.

## Adding a page

1. Add its domain command/service and retain the existing serde command shape if it is public.
2. Add the typed wrapper in the feature `api.ts` using `invokeDesktop`.
3. Build the page from shared UI primitives, then export it from the feature entry point.
4. Register the page in `src/app/routes.ts`; the application shell should compose it without command-specific logic.
5. Add unit coverage for the API/formatting behavior and a Playwright smoke assertion for the navigation or critical workflow.

## Backend compatibility

- `src-tauri/src/command_contract.rs` records every public command name. Keep it synchronized with `generate_handler!`.
- Do not change SQLite migration ordering, credential key names, command parameter names, or serialized response fields while extracting services.
- Place pure helpers in focused Rust modules first; move a command with its service only after its existing tests pass unchanged.

## Large-file physical migration gate

For a page embedded in a large legacy file, do not treat a textual function boundary as a filesystem move boundary. A migration may start only when all of the following are true:

- The target feature already has its public `index.ts` and `api.ts` boundary, and the page has no direct Tauri invocation.
- `rg` confirms every import, exported symbol, type, helper, and stylesheet used by the candidate slice; shared dependencies are moved or explicitly imported first.
- The source and target are reviewed as an independently compilable slice. Whole-file moves may use a rename; embedded pages must be copied into the target, wired through the feature entry, compiled, and only then deleted from the legacy file.
- The current working-tree changes are preserved. A migration must not reset, overwrite, or fold unrelated edits into its patch.
- Each slice finishes with `pnpm build`; interactive pages also retain their focused unit or smoke test. Rust extraction additionally runs `cargo test` and checks `command_contract` coverage.

If any gate is not met, leave the source intact and first extract the missing types, helpers, or feature API. This keeps every migration independently reviewable and reversible.

## UI rules

- Keep native desktop window controls; never create a browser title bar.
- Use `button-primary`, `button-secondary`, and `test-mode-button` for actions.
- Use `DataTable` (or the `data-table` shell for an existing responsive composite table), `FormDialog`, `ConfirmationProvider`, and `ToastProvider` rather than one-off equivalents.
