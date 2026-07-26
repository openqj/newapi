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
