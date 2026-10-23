# Performance audit

The earlier optimization fixed the expensive first-tap texture generation and reduced GPU allocations, but did not resolve fast scrolling. The earlier claim that the experience was fixed was based on an insufficiently demanding test.

## Method and limits

Compared production builds of commit `f4d6a6b` and the current working tree using the supplied 52-record share. Instrumentation and diagnostic changes ran in temporary copies, leaving application source unchanged during this audit. Tests used one browser tab, two scroll round trips from 0 to 2400 CSS pixels and back in four seconds each, and two record open/close cycles.

Desktop: Chrome with WebGPU, 1440 × 900 CSS pixels, DPR 2. The user's actual Chrome window was 1440 × 829, DPR 2, with a 2880 × 1658 canvas. Mobile: iPhone 17 Simulator, iOS 26.5 Safari, 402 × 714, DPR 3 with the application canvas capped at DPR 2; this used the WebGL fallback.

These are lab results, not physical-device results. Scripted scrolling exercises scene churn but does not measure native touch/trackpad input latency. Desktop idle animation-frame cadence varied from approximately 8.3 to 33.3 ms across runs, so desktop FPS comparisons are inconclusive. Shader and HTTP caches also affect cold versus warm runs. Allocation figures below come from Three.js renderer accounting, not measured total process memory. Cover fetch counts include HTTP-cache hits.

Aggregate measurements are in [performance-audit-results.json](performance-audit-results.json).

## Results

| iOS scenario | First scroll p95 / worst frame | Repeat scroll p95 / worst frame | Renderer allocations with record open |
| --- | --- | --- | --- |
| Before earlier changes | 104 / 140 ms | 102 / 135 ms | 354 MiB |
| Current implementation | 97 / 177 ms | 94 / 103 ms | 153 MiB |
| Current, shadows disabled | 96 / 114 ms | 93 / 124 ms | 121 MiB |
| Current, retain visited sleeves | 33 / 101 ms | 20 / 25 ms | 227 MiB |

The retention experiment kept visited sleeves rather than destroying their materials and textures. It is deliberately unbounded and unsuitable for shipping as-is. Its second scroll had no frames over 50 ms, compared with 13 in the current implementation. The memory increase demonstrates why a production solution needs a cache budget and texture-resolution policy.

The earlier worker change reduced first-open setup on iOS from 1099 ms to 1 ms in these runs. A 166 ms first-opening frame still remained. On desktop, the same setup code fell from 450 ms to below 1 ms, and allocations with an open record fell from about 471 to 273 MiB. A separate initial desktop observation still showed an approximately 343 ms opening pause and 250 ms closing pause; warm runs often did not reproduce those pauses. This does not establish a consistent overall desktop regression, and it does not establish a consistently smooth desktop experience either.

## Findings

1. **Resource churn is a major mobile scrolling problem.** `ShelfScene.deactivate()` aborts cover work, disposes the texture and front material, and removes the sleeve. Returning to the same row repeats creation, decoding/painting, upload, and renderer setup. The desktop sequence issued 108 cover fetches. Retaining visited sleeves substantially improved the mobile experiment and reduced its cover-fetch count from 74 to 30. These counts are not equivalent to upstream network requests.

2. **Preview animation redraws unnecessary background work.** The desktop scroll reached 356 draw calls and 329,563 triangles per frame. An open record still reached 232 draw calls and 208,765 triangles. A diagnostic hiding background geometry and freezing shadow updates reduced the open preview to 11 draw calls and 5,763 triangles. A production implementation would need to retain a static background image rather than merely hide it.

3. **Dynamic shadows are expensive, but are not the main mobile stutter fix.** Disabling shadows reduced desktop scroll draw calls from 356 to 130 and saved roughly 32 MiB of renderer allocations. Mobile p95 barely changed. Treat this as an energy/render-budget improvement, not a complete fix.

4. **Startup and animation design also affect perceived speed.** Initialization waits for shared vinyl maps even before a record is selected. The shelf stays hidden until every activated nearby sleeve has a texture, including the observer's offscreen preload region. Opening is intentionally sequenced as 0.75 seconds of travel followed by 0.9 seconds of sliding. Closing takes about 1.39 seconds. Details have a 0.75-second animation delay. These waits remain even with perfect frame delivery.

5. **Full-window rendering scales with the browser window.** At desktop DPR 2 the audit canvas contained 5.18 million pixels, although the collection content is capped at 1048 CSS pixels wide. DPR 1 reduced pixels by 75% and renderer allocations with a record open by about 44 MiB, with a sharpness tradeoff. The desktop frame cadence prevents claiming a measured FPS gain from this experiment.

6. **Switching backends alone is not a solution.** Forced WebGL increased desktop draw calls from 356 to 446 and showed a 600 ms opening frame in that run. The existing non-procedural wood fallback also increases draw calls because it uses multiple face materials. It needs batching/material work before being considered a reliable faster mode.

7. **Native scrolling and a main-thread fixed canvas remain an architectural risk.** The browser can move the document independently of JavaScript repainting the 3D scene. Lenis also adds a second animation loop on desktop. The current measurements do not isolate this synchronization issue; it requires native wheel/touch recordings and visual alignment checks. A DOM shelf removes that synchronization requirement for the collection itself.

## Alternatives

| Direction | Changes | Benefit and tradeoff |
| --- | --- | --- |
| Preserve the full 3D shelf | Bounded sleeve/material/texture cache; smaller shelf textures with a high-resolution selected cover; prewarm reusable preview materials; cache static shadow/background work; batch repeated material groups; progressive first paint; shorter interruptible transitions | Closest visual match and an incremental path. The retention experiment supports it, but caching trades memory for smoothness and first-time uploads still require a frame budget. Medium implementation effort with continued tuning. |
| Hybrid shelf and preview | Render browsing shelves and covers with HTML/CSS and baked wood imagery; use a small 3D scene for the selected record; load and warm it after first paint; use native scrolling | Recommended for reliable browsing across desktop and phones while preserving the signature 3D record reveal. Removes per-row GPU setup and the scroll/canvas synchronization requirement. A moderate structural change; shelf hover/depth effects need CSS approximations or a deliberate simplification. |
| CSS-based 2.5D experience | Use DOM cover images, a CSS vinyl disc, transforms and compositor animations throughout | Smallest rendering dependency and simplest performance model. Gives up physically shaded grooves, lighting and true 3D shelf geometry. Moderate implementation effort and a larger visual tradeoff. |

## Recommendation and acceptance checks

The initial audit recommended the hybrid direction. After visually comparing the prototype, the user chose to retain the full 3D shelf. The follow-up below implements bounded caching and faster motion in that renderer; it keeps the lighting, geometry, shadows, wood and DPR settings.

Before adopting a direction, validate a representative slice with native trackpad/touch input, cold and warm opens of several different records, repeated return scrolling, fast direction changes, and a real iPhone. Record worst pauses and frames over 33/50/100 ms as well as percentiles. Track memory until it reaches a stable plateau. A 120 Hz desktop needs a different frame budget from a 60 Hz phone. Exercise both WebGPU and WebGL paths, and separate time spent waiting on loading/animation from actual stalled rendering.

## Hybrid comparison outcome

An HTML/CSS browsing shelf with a selected-record 3D preview was evaluated
against the full 3D version. The user preferred full 3D, and the hybrid
implementation, variant query handling, and comparison picker were removed.
The alternatives and measurements above remain as historical context.

## Full 3D optimization follow-up

The 3D renderer remains the default. Inactive sleeves now retain their resources
in a least-recently-used cache capped at 24 entries and an estimated 64 MiB of
artwork (source blobs, decoded bitmaps and GPU mip chains). Cached meshes are
detached, so retention does not add draw calls. Active and selected records stay
pinned. Eviction, slot removal and scene disposal abort pending artwork work and
release resources; disposal waits for any pending shader compilation.

Browsing covers use 512px textures, sufficient for the largest shelf cover at the
existing DPR cap. Selection upgrades the cover separately to 1024px and restores
the browsing map on close. A single disc mesh, material and label texture is
reused between records. After first paint, only that detached preview object is
asynchronously precompiled against the actual scene. Opening retains the existing
pull/arc/slide path but takes about 670ms instead of 1630ms; closing takes about
570ms instead of 1400ms. Details appear sooner. Reduced motion remains immediate.

Fresh measurements compare a frozen pre-change working tree with production
copies of the cache-only and combined changes. The supplied 52-record share,
viewports and two 2400px scroll round trips match the original audit. The app
itself contains no audit globals. Full observations, including unfavorable runs,
are in [performance-3d-optimization-results.json](performance-3d-optimization-results.json).

| iPhone Simulator scenario | First scroll p95 / worst | Repeat scroll p95 / worst | Repeat frames >50ms | Renderer allocations with record open |
| --- | --- | --- | --- | --- |
| Pre-change 3D shelf | 97 / 134ms | 99 / 102ms | 13 | 152.6 MiB |
| Cache and artwork sizing only | 27 / 60ms | 21 / 25ms | 0 | 136.6 MiB |
| Cache, preview reuse/precompile and faster motion | 28 / 59ms | 21 / 28ms | 0 | 136.6 MiB |

The standard combined run's two opening maxima were 73/62ms, versus 187/117ms
before these changes. Desktop WebGPU retained approximately 9ms scroll p95 with
no frames over 50ms; combined preview maxima were below 10ms in that run.
Desktop renderer allocations with a record open fell from 273.4 to 209.4 MiB.
Cover fetch calls fell from 108 to 52 on desktop and 74 to 30 on iOS. These include
HTTP-cache hits and are not counts of upstream network transfers. Draw calls and
triangles remain unchanged: this preserves the full scene rather than reducing
its geometry or shadows.

Additional checks deliberately started scrolling immediately after readiness and
traversed the entire collection three times. Immediate scrolling retained a
20–22ms repeat p95 with no repeat frames over 50ms. Across full-collection sweeps,
the retained cache stayed at 24 entries, about 58 MiB estimated artwork. Texture
allocations leveled off after the first sweep. Desktop had no >50ms frames across
all sweeps and five different previews. The iOS third full sweep had a 26ms p95,
63ms maximum and eight frames over 50ms: distant records exceed the cache's working
set, and uploading evicted artwork still costs time. Renderer-reported uniform
buffers increased about 22 KiB per iOS full sweep; texture stability does not
establish a total-memory plateau or prove absence of renderer bookkeeping growth.

One immediate-scroll run included a 362ms first-opening frame outside measured
scene setup/update/render CPU work (the largest render call was 15ms). A diagnostic
suppressing Spotify's external scripts/iframe had opening maxima of 69/67ms;
a normal repeat with Spotify enabled had 67/67ms maxima as well.
These comparisons do not establish Spotify as the cause: asynchronous GPU,
compositor and simulator scheduling remain possible. Ordinary new-cover opens
still produced 50–73ms upload pauses. This is a substantial measured improvement
in scrolling, not a claim that every cold interaction is smooth. Physical-iPhone
touch recordings and longer memory observation remain necessary.

Validation includes cache eviction by count and bytes, async cover/high-resolution
races, selected-record pinning, unmount/disposal during compilation, reusable
preview resources, interruptible motion and reduced motion. All 95 tests,
type checking and the production build pass.

## Safari scroll-start flicker follow-up

The supplied 6.3-second simulator recording shows the entire 3D canvas briefly
vanishing as Safari changes its bottom toolbar height. This exposed a gap that
the frame-time benchmarks did not test: the canvas ResizeObserver called
`renderer.setSize()` after animation callbacks and before paint, immediately
clearing its drawing buffer. Redrawing was deferred to the following animation
frame. Repeated toolbar resizes could therefore expose blank canvas frames.

ResizeObserver now only requests a frame. The animation callback reads the latest
canvas dimensions, resizes only when those dimensions have changed, updates the
camera and objects, and draws before returning. Multiple resize notifications
coalesce into that callback. Geometry, shadows, artwork sizing and cache budgets
are unchanged by this fix.

`npm test -- src/components/shelf/scene-resize.test.ts` reproduced three failures
before the fix: a blank interval after resize, duplicate buffer clears, and
clearing an unchanged viewport. All three now pass. A live WebGL resize loop
previously recorded six clears outside animation callbacks followed by later
draws; afterward it recorded zero such clears. The WebGPU loop also recorded zero.
An automated iPhone Simulator Safari check at 402×714 likewise recorded six
resizes, each redrawn in the same callback, with zero clear-to-next-frame gaps.
The native capture tool returned blank images, so this verifies resize ordering
rather than a replacement native scroll video. The recorded callback sequences
are included in `performance-3d-optimization-results.json`.
All 98 tests, type checking and the production build pass.
