# SlopZap accessibility validation

The 8 October 2026 development checks cover narrow-layout reflow, native browser zoom, accessible control names and keyboard behavior. They reproduced and fixed horizontal popup overflow. These automated checks and targeted screenshot inspections do not replace the manual screen-reader audit required by SPEC.md §§28.4 and 31.

## Reflow fix

At a 320 CSS-pixel viewport, `popup.html` previously produced a 350-pixel document and required horizontal scrolling. The shared app container now keeps its preferred 350-pixel width while limiting itself to available space. Larger options, onboarding and comparison layouts retain their existing widths. No classification, storage, permission or model behavior changed.

## Automated coverage

| Surface or behavior                        | Verified scope                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Popup, Settings, onboarding and comparison | No horizontal document scrolling at 320 CSS pixels; axe checks pass                                                               |
| Native 200% and 400% browser zoom          | Each extension page at a 1280-pixel viewport; zoom factor and device-pixel ratio verified, with 640/320 CSS-pixel document widths |
| Onboarding                                 | All four steps, including view/site selection and saved confirmation, pass reflow and axe checks                                  |
| Comparison                                 | Expanded invented casebook reflows; mocked result tables scroll inside named regions rather than widening the page                |
| Injected controls on light and dark hosts  | Meaningful button names, logical Tab order, focus can leave controls, host key events remain unprevented, no extra classification |
| Existing regressions                       | Keyboard correction/reveal focus, forced colors, reduced motion, enlarged fonts and keyboard-only setup                           |

The zoom tests use Chrome's native [`tabs.setZoom` and per-tab zoom settings](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom), not CSS transforms or font-size substitution. These APIs are used only by tests in disposable extension profiles; no production zoom feature or additional permission is shipped. `popup.html` is tested in a browser tab, not the toolbar popup window.

Screenshots contain only invented fixtures and extension UI. Targeted inspections covered the 400% popup/onboarding viewport captures, dark-host controls and narrow mocked comparison tables. Viewport captures verify the visible fold; they are not full-page visual inspections. Automated document-width and axe checks cover the remainder.

## Manual audit still required

- Use a screen reader to navigate setup, Settings and the real toolbar popup; check headings, groups, selected modes, form labels, errors and user-triggered status messages.
- Inspect injected score/correction/reveal controls in a permitted public discussion. Confirm Show/Hide expanded state, logical reading order, ancestor context and focus recovery without unsolicited score announcements.
- Check keyboard-only entry and exit, visible focus, host shortcuts and popup dismissal in the actual browser chrome.
- Review real-window 200%/400% zoom, high contrast, reduced motion and both host themes, including content below the initial viewport.
- Record browser/OS/screen-reader versions, findings and reviewer approval without retaining live page text or editor/message content.

Local verification passed 83 unit tests, the full 53-test Chromium suite, all twelve short benchmark scenarios and reproducible hashes for 28 packaged files. After strengthening the onboarding heading checks, both affected reflow/zoom cases passed again. The first full run overlapped a package rebuild and failed during extension-install setup; the clean completed-build run passed without changing assertions or timeouts.

`docs/release-evidence.json` retains `accessibilityManualAudit:false`. Passing these regressions is development evidence, not release signoff.
