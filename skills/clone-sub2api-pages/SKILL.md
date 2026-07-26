---
name: clone-sub2api-pages
description: Recreate Sub2API's responsive user dashboard, API-key management, usage records, and channel-status pages in this React/Tauri project. Use when aligning any of those four pages with `copy/sub2api-main`, replacing legacy page UI, adding source-station filtering or provenance columns, or validating Sub2API-style responsive behavior.
---

# Clone Sub2API Pages

Use the Sub2API source as the visual and interaction authority while preserving this project's React/Tauri architecture, multi-station aggregation, and native desktop window controls.

## Source And Target

- Read the matching source view before editing:
  - `copy/sub2api-main/frontend/src/views/user/DashboardView.vue`
  - `copy/sub2api-main/frontend/src/views/user/KeysView.vue`
  - `copy/sub2api-main/frontend/src/views/user/UsageView.vue`
  - `copy/sub2api-main/frontend/src/views/user/ChannelStatusView.vue`
- Reuse the target implementation surfaces first:
  - `src/components/Sub2ApiPages.tsx`
  - `src/components/Sub2ApiPages.css`
  - `src/App.tsx`
  - `src-tauri/src/lib.rs` for remote data mapping or key commands.
- Do not copy Vue files or Vue-specific dependencies into the React application.

## Workflow

1. Inspect the selected Sub2API view, its imported components, and the current React page before changing code. Capture a source screenshot when visual fidelity is requested.
2. List the required modules, filters, columns, empty states, actions, and responsive states. Implement only those modules.
3. Map data from the existing synchronized station payloads. Keep station IDs for filtering and expose provenance as station name plus base URL.
4. Render unavailable remote fields as `-`; do not invent API key names, group, endpoint, IP, billing, or timing data.
5. Preserve real operations. API-key create/edit/delete/reveal, refresh, filters, column settings, pagination, and CSV export must operate on actual project state or backend commands.
6. Make the desktop and narrow-screen layout match the source hierarchy, then verify both in a real browser.

## Page Requirements

### Dashboard

- Use Sub2API-style summary cards, channel overview, usage summary, and recent records.
- Aggregate existing connected stations. Keep each station's name, URL, status, last sync, and error visible where Sub2API shows a service or channel state.

### API Keys

- Replace legacy keys UI rather than rendering both pages.
- Provide all-stations and single-station selection, search, source station plus URL, group, quota/usage, status, dates, and responsive record cards.
- Use existing Tauri key commands. Do not transmit undefined edit fields as JSON `null` when the remote API interprets them as destructive updates.

### Usage Records

- Include Sub2API-style stat cards, date range and granularity controls, model/group/endpoint distributions, token trend, filters, column settings, CSV export, records, and pagination.
- Include source station and URL in the desktop table and in mobile cards.
- Keep the title and refresh action unless the user explicitly asks to remove them.
- Do not apply the generic first-child page-card rule to any `.sub2-page` root. Dashboard, API keys, usage, and channel status remain borderless, unshadowed, and unpadded at page level; retain the surrounding `.content-surface` workspace container.

### Channel Status

- Present each synchronized station as a Sub2API-style status/monitor card with URL, status, last sync, type, and last error or healthy state.
- Use actual sync outcomes; do not display fabricated uptime or incident history.

## Styling And Responsiveness

- Prefer existing `Sub2ApiPages` components, Chart.js charts, and project button classes: `button-primary` for black primary actions and `button-secondary` for light-gray secondary actions.
- Preserve the desktop sidebar and native window controls. Do not add a duplicate title bar.
- Avoid page sections wrapped in extra cards. Use cards only for source-equivalent stat, chart, table, and monitor modules.
- At narrow widths, change the app shell into a horizontal navigation strip, allow the content surface to fill the viewport, switch dense tables to record cards, stack charts, and prevent horizontal document overflow.
- Keep source labels and controls readable. For chart breakdowns, use fixed table layout and truncate long labels instead of adding card-internal horizontal scrolling.

## Validation

1. Run `tsc --noEmit` and `npm run build`; run `cargo test` when Rust mapping or commands change.
2. Launch the local app and check the selected page at a desktop viewport and a 390px-wide viewport.
3. Test all-stations and one-station filters on keys and usage, verify the source URL is visible, and check `document.documentElement.scrollWidth === document.documentElement.clientWidth` on mobile.
4. Check browser console errors. When working from a screenshot, update `design-qa.md` with the source, implementation capture, findings, and final result.
