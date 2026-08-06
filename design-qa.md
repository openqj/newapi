# API Keys Design QA

source visual truth path: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-5f7f37e3-8c4a-4426-8b00-2bcb28da61f0.png`
implementation screenshot path: `C:\Users\Wecoo\AppData\Local\Temp\relayhub-api-keys-group-selector.png`
comparison input path: `C:\Users\Wecoo\AppData\Local\Temp\relayhub-api-keys-group-selector-comparison.png`
viewport: implementation screenshot 1126 x 1272 CSS pixels; source screenshot 455 x 445 pixels; the focused implementation crop is normalized to 455 x 445 pixels.
density normalization: source and focused implementation comparison use equal 455 x 445 pixel regions; no additional density scaling was applied.
state: API keys page, group selector open, empty search, selected `vip` group, multiplier and subtitle visible.

## Evidence

Full-view comparison was not used as the source attachment is a focused group-selector capture rather than a full-page capture. The focused comparison input places the source on the left and the rendered implementation on the right at the same 455 x 445 pixel size.

The focused comparison confirms the search icon remains inside the search field, the trigger uses the combined up/down icon, option subtitles render only when present, the multiplier is right-aligned with the `倍率` suffix, and the selected option has a right-side checkmark.

The status filter trigger and portal menu were also measured in the rendered page: both are 152px wide and share the same left edge. The five requested sortable headers expose working buttons for name, current concurrency, expiration time, status, and creation time.

## Required Fidelity Surfaces

- Fonts and typography: compact system UI sizing and weights remain consistent across the selector trigger, option labels, subtitles, and multiplier pills.
- Spacing and layout rhythm: search field, option rows, right metadata column, checkmark, and portal alignment follow the reference structure.
- Colors and visual tokens: provider-toned option pills, neutral subtitle text, pale selected-row background, and teal/gray controls match the existing Sub2API-inspired tokens.
- Image quality and asset fidelity: no custom raster or hand-drawn UI asset is required; the existing Lucide icon system renders the search, combined chevron, and check icons.
- Copy and content: the visible multiplier suffix is `倍率`; selected state and optional subtitles are exposed in both rendered text and accessible names.

## Interaction Checks

- Open and close the group selector.
- Search field has an embedded search icon and filters the list.
- Selected group displays a right-side checkmark.
- Group trigger keeps the combined up/down icon in both closed and open states.
- Status filter menu aligns to its trigger.
- All five sortable headers are present and toggle ascending/descending state.
- Browser console error log: empty.

## Verification

- `pnpm test`: 39 test files passed, 100 tests passed.
- `pnpm build`: passed.
- `git diff --check`: passed; only existing line-ending warnings were reported.

final result: passed

## Follow-up: API Key Editor Group Select

source visual truth path: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-d7441bf3-d3b5-4742-adea-5fa284eff088.png`
implementation screenshot path: `D:\work\newapi\output\playwright\api-key-editor-group-select-527x677.png`
comparison input path: `D:\work\newapi\output\playwright\api-key-editor-group-select-comparison.png`
viewport: source and implementation are both 527 x 677 pixels; no density scaling was applied.
state: API key editor, group selected, selector closed.

The focused comparison confirms the editor group field is a bordered rounded select, the group title and multiplier stay adjacent on the left, the combined up/down icon stays on the right, and the selected state no longer renders an extra inline `选择分组` label. The empty create state was also checked: it renders only the `选择分组` placeholder and the selector icon without an empty multiplier dash.

Required fidelity surfaces: typography and spacing remain consistent with the existing dialog; the selector border, white surface, neutral badge, multiplier pill, and muted icon use the existing API-key page tokens; no new image assets were required; existing form labels and business data are unchanged.

Interaction checks: open the editor selector, focus the search field, verify group subtitles and right-side selected checkmark, close the menu, and verify the empty selector state. Browser console error and warning log: empty.

Fix history: the initial editor trigger had no normal select border, showed an inline `选择分组` label after a selected value, and pushed the multiplier to the far right. The fix added the editor-only select styling, removed the inline label, hid the empty multiplier dash, and changed the editor trigger layout so the group and multiplier remain adjacent. The follow-up screenshot above is the post-fix evidence.

final result: passed
