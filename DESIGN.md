# Freightfolio — The living portfolio

The website is a demonstration of the service: distinctive design, a clear offer, and someone handling the details. The site remains static HTML, CSS and vanilla JavaScript on Cloudflare Pages. No framework or animation dependency has been added.

## Identity

Warm ivory #f3f2ec, ink #20211e and chartreuse #cfef62. The accent is reserved for conversion, the brand marker and the final invitation. A dark service chapter creates a deliberate change in rhythm. Typography uses a system sans-serif with a Georgia italic for editorial emphasis: no third-party font request or font-loading shift on the agency pages.

The hero states the service and $0 upfront / $149 per month within its opening copy. A full-width browser stage presents the existing Studio 601 and TailWaggers concepts, with user-controlled project and desktop/mobile choices. The stage is a same-origin sandboxed frame, scaled to a real viewport width, with navigation disabled inside the stage; a clearly labeled link opens the full demonstration. It does not claim to be completed client work.

## Implementation

- css/site.css retains layout rules needed by existing service and design-lab templates.
- css/overhaul.css defines the new identity, page composition, responsive layouts and legacy resets. Keep future redesign rules here; consolidate legacy CSS only after visual regression testing.
- js/site.js owns accessible navigation and preserved timeline toggles. No particles, tilt or perpetual animation loop.
- js/showcase.js owns the two-concept stage and responsive viewport scaling.
- js/request.js retains the original lead payload and endpoint, with programmatic error associations and focused success feedback.
- /api/lead now requires a real storage or delivery outcome before success.

Motion is brief and purposeful: restrained hero entrance, button hover and preview-size feedback. Reduced motion disables it. Content stays visible without enhancement. There is no autoplay or loading sequence.

## Quality review status

The source review corrected inherited active-link contrast, blog asset paths, header/footer gutters, form colors/focus, pricing hover movement, a missing screenshot dependency, and conflicting Growth-plan feature descriptions. The source checks and mocked API checks pass. These are not substitutes for rendered approval.

Visual review, touch testing, screenshots and live performance measurement remain blocked by runtime socket permission and an unreachable network proxy. No Awwwards-level, WCAG-conformance or performance-score claim has been made. Final clipart review is INCOMPLETE until the exact rendered version, including embedded concept references, is inspected. Do not release this branch until those checks and owner review are complete.
