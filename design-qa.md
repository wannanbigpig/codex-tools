# Design QA

- Source visual truth: user-provided dashboard screenshots in the current conversation (no local file path exposed).
- Implementation screenshot: unavailable; the implementation is a VS Code extension webview and no permitted capture surface is available in this run.
- Intended viewport: narrow VS Code dashboard panel, approximately 550 CSS px wide, dark theme.
- Source pixels: screenshots displayed at approximately 548 × 262 and 532 × 240 pixels; density metadata unavailable.
- Implementation pixels/CSS size/density: unavailable.
- State: saved-account cards with quota data; active-account overview with trend graph and two quota meters; compact settings overlay.

## Full-view comparison evidence

Blocked. The source screenshots are visible in the conversation, but the installed VS Code webview could not be captured into a comparable image. Build/type verification is not a substitute for rendered visual evidence.

## Focused region comparison evidence

Blocked for the same reason. The intended focused regions are the saved-account header/metric/footer layout and the overview trend-plus-meter stack.

## Findings

- No visual severity can be assigned without a rendered implementation capture.
- Code inspection confirms the intended structure: content-sized grid cards; a separate table mode with one account per dense row, two quota columns, and icon actions; a compact usage-change bar graph derived from decreases between consecutive quota snapshots across all accounts, with account hover data; then one overview row split into 30% Weekly, 30% 5-hour, and 40% action icons. The account summary strip is removed, reset is always shown as a short badge, and Details is in More.

## Comparison history

- Initial implementation: no valid rendered comparison was available.
- Latest implementation: compiled, packaged, and installed; visual comparison remains unavailable.

## Required manual verification

- Reload VS Code and open Codex Accounts: Show Quota Summary.
- Confirm Weekly, 5-hour, and actions appear in one 30/30/40 row below the graph.
- Refresh quota after observed activity and confirm a usage-change bar appears; hover it to verify account, approximate consumed quota points, and time.
- Confirm each meter's reset information remains directly below its own bar.
- Confirm account cards have no reserved blank vertical area at approximately 550 px and at a narrow single-column width.
- Switch to Table view and confirm every account becomes one dense row, with narrow panels folding each row into two compact lines.
- Confirm the Saved Accounts search/filter/sort/metric/view toolbar remains one horizontal row at every tested viewport.
- Confirm the Saved Accounts toolbar begins directly below the heading, with no descriptive subtitle row.
- Confirm the heading shows consecutive Total, Active, Valid, Invalid, and average Weekly remaining quota badges without creating another summary row.
- Confirm only cards with an available reset credit show its badge and reset action; `Reset 0` and `Credit 0` are absent.
- Confirm card action buttons are smaller but retain readable hover labels and keyboard focus states in Grid and Table views.
- Confirm all four overview information tiles have equal heights and long subscription/account values clamp to two lines with full values available on hover.
- Confirm automatic next-account selection ranks highest 5-hour quota first, then highest Weekly quota when 5-hour values tie.
- Confirm Table view does not reserve a large blank identity column before the two quota bars.
- Confirm Grid is selected on first launch after migration and the density, Grid, and Table controls use distinct readable icons.
- Confirm saved-account cards show one `Current` pill rather than duplicate `Primary` and `Current` pills.
- Confirm the overview identity shows only its plan pill; it has no redundant Current or health pill.
- Confirm every saved account with a known subscription expiry shows a compact days-left value; seven days or fewer and expired values are red.
- Confirm `Expiring soon` sorts known subscription expiries earliest first, with unknown dates last.
- Confirm auto-switch ranks equal 5-hour quotas by known expiry before weekly quota: expired/free-tier accounts first, then the soonest upcoming expiry, with unknown dates last.
- Confirm each overview quota tile places reset time in the header between label and percentage, leaving only the progress bar below.
- Confirm healthy accounts show no health pill; only warnings and errors add a health-state badge.
- Confirm graph values use `%` rather than `pt`; account identity appears only in the bar tooltip, with no persistent legend.
- Confirm Settings shows quota-history sample count, a Never-to-90-days retention slider defaulted to 30 days, and an icon-only clear action.
- Confirm Grid view uses masonry packing, with no blank row gaps beneath shorter cards; Table view must remain one row per account.
- Hover a graph point and confirm account, range, remaining percentage, and sample time are readable without clipping.
- Open Settings around 650 px wide and confirm simple controls form two balanced columns while refresh, expanded automation, thresholds, and debug span the full row.
- Narrow Settings below 560 px and confirm every control becomes one column without clipped labels, toggles, selects, or horizontal scrolling.
- Confirm disabled simple settings show only their title, short description, and toggle; redundant blue status notes should not be visible.
- Confirm refresh and warning sliders remain keyboard-operable and their values and scale labels stay legible in the compact layout.

final result: blocked
