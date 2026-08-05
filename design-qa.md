## 2026-08-05: Local Gateway Usage Statistics

**Findings**

- [P2, fixed] Local usage statistics were implemented as a settings tab while the existing usage-record page remains remote-station backed.
  Location: `src/features/settings/pages/SettingsPage.tsx`, `src/features/usage-stats/`, `src-tauri/src/local_usage_store.rs`, `src-tauri/src/services/gateway.rs`.
  Fix: Gateway requests are persisted locally and aggregated with cache-normalized tokens, costs, trends, providers, models, and request details.
- [P2, fixed] Provider/model filters and cache-write availability now follow the CC Switch dependency and protocol rules.
  Evidence: desktop and 390x844 mobile captures; tabs, date presets, request detail drawer, pricing disclosure, and responsive toolbar were exercised in the local preview.

**Open Questions**

- The RelayHub navigation shell remains around the cloned content because this is an existing application. The comparison evaluates the usage-statistics content region.

**Evidence**

- Source visual truth: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-0b582928-f080-4869-9341-7be646222c80.png`
- Desktop capture: `D:\work\newapi\output\playwright\usage-stats-desktop.png`
- Mobile capture: `D:\work\newapi\output\playwright\usage-stats-mobile.png`
- Verification: frontend build/typecheck passed; Vitest 36 files / 82 tests passed; Rust 119 tests passed, 4 ignored.

final result: passed

**Findings**

- [P1, fixed] Mobile shell compressed the usage page into a narrow column.
  Location: `src/index.css`, `src/App.css`.
  Evidence: the initial 390 x 844 capture retained the desktop sidebar and the usage content was clipped.
  Fix: remove the desktop minimum width below 768px, turn navigation into a horizontal scroll area, and let the content surface use the full available width.

- [P2, fixed] Distribution-card tables displayed an internal horizontal scrollbar.
  Location: `src/components/Sub2ApiPages.css`.
  Evidence: the initial 1360px desktop capture clipped metric columns in the model/group/endpoint cards.
  Fix: use a fixed, full-width table layout with concise cell padding and ellipsis for long labels.

- [P2, fixed] Usage summary cards did not match the source card hierarchy.
  Location: `src/components/Sub2ApiPages.css`.
  Evidence: the first capture used a top-aligned, neutral icon while the visual target uses left-aligned, colored icon tiles.
  Fix: lay out the usage cards as an icon column plus text column and assign the blue, amber, green, and purple source-like tones.

**Open Questions**

- The reference is a content-only Sub2API screen. The implementation retains RelayHub's native desktop navigation shell, as required by this project. The QA comparison evaluates the 1360px-wide content region rather than treating the shell as a mismatch.

**Implementation Checklist**

1. Confirmed the usage page includes all requested statistic cards, time controls, distribution charts, token trend, filters, column settings, CSV export, responsive records, and source URL fields.
2. Confirmed the API-key and usage source selectors support all stations and individual stations.
3. Confirmed no mobile horizontal overflow and no browser console errors.

**Follow-up Polish**

- [P3] Production data shows `-` for optional remote fields that the connected station does not return; this intentionally avoids inventing usage metadata.

## Evidence

- Source visual truth: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-28362195-944e-4fce-b1af-a4c579e94716.png`
- Implementation screenshot: `D:\work\newapi\qa-usage-desktop.png`
- Side-by-side comparison: `D:\work\newapi\qa-usage-comparison.png`
- Source pixels: 1360 x 1200 at 1x.
- Implementation viewport: 1584 x 1200 CSS px at 1x. Its 1360px main-content region is compared with the 1360px source; the remaining width is the project navigation shell.
- State: all stations selected, hourly aggregation, sample synchronized usage records.
- Focused comparison: statistic cards, distribution-card tables, time range controls, trend chart, and filter panel were all readable in the combined image. No separate crop was required.
- Primary interactions tested: usage source filter (`demo-alpha` returned two records), API-key source filter (`demo-alpha` returned two keys), source URL display in mobile cards, desktop and mobile responsive layouts.
- Console errors: none reported by the browser-rendered local preview.

## Comparison History

1. Initial desktop/mobile review found the P1 mobile shell compression and P2 chart-table overflow; both were fixed before the final capture.
2. A second desktop comparison found the neutral, vertically stacked summary cards; the layout and icon tones were updated.
3. Final combined comparison in `qa-usage-comparison.png` found no remaining actionable P0, P1, or P2 visual differences within the project-shell constraint.
4. Follow-up annotation removed the inner usage-page wrapper card while preserving the workspace container, title, and refresh action. Browser verification confirmed the usage page itself has a `0px` border and no shadow, while the workspace container remains intact.

previous result: passed

## 2026-07-26: Dashboard, API Keys, Channel Status

**Findings**

- [P2, fixed] The mobile API-key station and status selectors collapsed to icon-width controls.
  Location: `src/components/Sub2ApiPages.css`, `.sub2-key-filters`.
  Evidence: initial 375px browser capture showed two dropdown arrows without their selected text.
  Fix: use a two-column mobile grid, with search spanning both columns. Final browser capture shows `全部站点` and `全部状态`, each 166px wide.

- No remaining actionable P0, P1, or P2 differences were found for the rebuilt page roots. The implementation intentionally retains RelayHub's existing navigation shell and maps unavailable source fields to `-` rather than inventing remote data.

**Open Questions**

- Connected stations expose only their latest sync state. The channel monitor therefore labels the 60-point strip as sync status and renders one current point plus unavailable history, rather than presenting it as an availability record.

**Implementation Checklist**

1. Dashboard rebuilt with Sub2API-style statistic groups, date/granularity controls, model distribution, token trend, recent usage, and quick actions.
2. API-key management rebuilt around source-style filters, refresh/column/create controls, source station plus URL, and responsive records.
3. Channel status rebuilt with the source-style period selector, overall chip, refresh controls, responsive monitor cards, metric pairs, and 60-point sync timeline.
4. Page roots have no large wrapper border or shadow; only source-style internal units retain borders.

**Follow-up Polish**

- [P3] When station monitor APIs later expose latency and historical availability, populate the existing `-` metric slots and timeline with those real values.

## Evidence

- Source visual truth: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-28362195-944e-4fce-b1af-a4c579e94716.png`, plus `D:\work\newapi\copy\sub2api-main\frontend\src\views\user\DashboardView.vue`, `KeysView.vue`, and `ChannelStatusView.vue`.
- Implementation: browser-rendered `http://127.0.0.1:1420/`, captured at desktop 1265px wide and mobile 390px / browser CSS viewport 375px after shell sizing.
- State: three connected stations; all stations selected; synchronized sample usage and keys; 30-day channel tab plus auto-refresh enabled.
- Full-view comparison: the source reference and current rendered dashboard/keys/channel captures were opened during this QA run. The target preserves source card hierarchy, neutral border/radius treatment, dashboard chart pairing, table-toolbar order, and monitor-grid composition.
- Focused checks: API-key source column (station and URL); dashboard date controls/charts; mobile filter labels; channel monitor metric/timeline region. Source uses the same small-card visual language; no separate crop was needed.
- Responsive verification: dashboard, keys, and channel pages each reported page-root `border: 0px`, `box-shadow: none`, and `scrollWidth === clientWidth` on mobile.
- Primary interactions tested: dashboard quick navigation, API-key station filter (Alpha Gateway returned two rows), 30-day monitor tab, auto-refresh toggle, and mobile card/table switching.
- Console errors: none reported by the browser-rendered local preview.

## Comparison History

1. Initial rebuilt-page capture confirmed the dashboard and API-key desktop composition. The channel full-page stitch appeared to stack the control strip, but the actual 390px viewport capture and computed layout showed the source-style horizontal/wrapped controls correctly.
2. Mobile API-key capture identified unreadable selector labels. The selector grid was fixed and recaptured; both labels are now visible with no horizontal overflow.
3. Final browser captures found no actionable P0, P1, or P2 visual issues within the project-shell constraint.
4. Follow-up toolbar review found the status selector wrapping below the search and station selector on desktop. The toolbar now uses a no-wrap filter/action row; final 1265px capture places all six controls at `y: 24px`, with no page overflow.
5. API-key source-table comparison found that the previous view still combined the API key and name and used a list-count header. It was rebuilt as a source-style data table with API key/copy, name, source, group, concurrency, quota/usage, status, dates, and row actions. Final desktop capture confirms a 256px search field, two 160px left-side selects with 35px right padding, ten table columns, and no page overflow; the 375px capture switches to source-style responsive records without overflow.

final result: passed

## 2026-07-31: Merchant title entry

**Verification**

- The custom child-window title `商家信息` is now a semantic button labeled `打开商家端`.
- In Tauri it emits the merchant-center navigation event, then shows and focuses the main window; the main shell listens for that event and switches to `merchantCenter`.
- The title button, refresh control, close control, model selector, and sorting selector remain visible in the 340px preview.
- `pnpm build` and `git diff --check` passed.

final result: passed

## 2026-07-31: Native model selector

**Verification**

- Replaced the checkbox popover with a native select matching the supplied reference control.
- Model options are `全部`, `claude`, `chatgpt`, and `grok`; sorting remains a matching native select beside it.
- Selecting `claude` filters the cards while preserving the same card layout and value emphasis; resetting to `全部` restores the full list.
- `pnpm build` and `git diff --check` passed.

final result: passed

## 2026-07-31: Merchant model filter and quota currency

**Verification**

- Added a multi-select model list to the left of sorting with `claude`, `chatgpt`, and `grok`; all three are selected by default.
- Verified unchecking `claude` changes the counter to `模型（2/3）` and removes the corresponding demo cards from both tabs.
- Verified free quota values render with a leading `$` and retain the smaller gray `元` unit.
- Browser-rendered preview reported zero console errors; `pnpm build` and `git diff --check` passed.

final result: passed

## 2026-07-31: Merchant marketplace card list

**Findings**

- No remaining actionable P0, P1, or P2 visual findings.
- The merchant marketplace now follows the supplied reference structure within the requested 340 × 840副窗口: sorting is at the upper right, cards are stacked, and the primary value occupies the former action area.
- Multiplier values render as a large, light blue number with a smaller gray `X`; free quota values use the same treatment with a smaller gray `元` unit.
- Contact/import actions share the lower-right action position, compact long-button sizing, and no divider between the stat and action cells. Long merchant names, descriptions, group names, and station URLs truncate with ellipses.

**Open Questions**

- The reference image is a wider dark relay list while the product requirement is a narrow light merchant window; comparison therefore evaluates hierarchy, ordering, card density, value emphasis, and action placement rather than theme or exact viewport proportions.

**Implementation Checklist**

1. Confirmed 50 demo multiplier cards and 50 demo free-quota cards render in the narrow viewport.
2. Confirmed tabs, upper-right sorting, merchant links, contact/import actions, and refresh/close controls are present.
3. Confirmed value sorting selects the largest free quota first and multiplier values display as numeric values only plus the gray unit.
4. Confirmed browser-rendered preview has no console errors; the desktop-only toast visible in the non-Tauri browser preview is an expected platform fallback.

**Evidence**

- Source visual truth: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-bfb66261-abad-4c6b-a5dd-bd7a292e9813.png`.
- Card reference: `C:\Users\Wecoo\AppData\Local\Temp\codex-clipboard-597beb96-df8e-4238-a85c-f60a95ef11f2.png`.
- Implementation screenshots: `D:\work\newapi\design-qa-merchant-340x840.png` and `D:\work\newapi\design-qa-merchant-free-340x840.png`.
- Side-by-side comparison: `D:\work\newapi\design-qa-merchant-comparison.png`.
- Viewport: 340 × 840 CSS px, 1x; comparison source is 884 × 454 px and intentionally wider than the implementation.
- States: multiplier tab/latest sort and free-quota tab/latest sort; value sort also verified on the free-quota tab.
- Focused comparison: card header/value region, lower stat/action row, tabs, and upper-right sort control were readable in the combined comparison image.
- Console errors: none reported by the browser-rendered local preview.

**Comparison History**

1. Initial card-list implementation replaced the table and added upper-right sorting.
2. Values and action controls were swapped into the requested positions; the value was enlarged and given a unit treatment while actions moved to the lower-right cell.
3. Final pass removed value backgrounds, made values blue and lighter, added gray `X`/`元` units, aligned group label/name on one line, removed the stat/action divider, and added ellipsis behavior for long text.

final result: passed

## 2026-07-26: API Key Table and Create Dialog Follow-up

**Verification**

1. API-key table and column settings now share the same nine labels: 名称, API 密钥, 分组, 当前并发, 用量, 过期时间, 状态, 创建时间, 操作.
2. Each column setting changes the corresponding desktop table column. The 当前并发 verification set the header display to `none`, then restored it.
3. The refresh button calls the same full key-data synchronization sequence as post-mutation refreshes and shows a loading state while it runs.
4. In the create dialog, 来源站点 is the first field. Changing it resets the group selection and loads the selected station's groups through `list_station_groups`; local snapshot groups remain the immediate fallback.

**Build**

- `tsc --noEmit`: passed.
- `npm run build`: passed.

final result: passed
