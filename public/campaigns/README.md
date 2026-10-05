Campaign template assets

The three screenshots are optimized copies of the real Moreamoreceramics
storefront views used in the Poeruum Instagram ad, created on 2026-10-04.
Administrators can replace them with their own photos or storefront screenshots.
phone-demo.mp4 is a 9.4-second, 30 fps capture of the same real storefront UI
used by the homepage phone. It scrolls into product details and back, swipes
between the three products, and selects an alternate gallery photo. The Reel
preview and MP4 export decode the same frames at the campaign timeline time.
It is used when the phone template retains its three reference screenshots;
custom photos/screenshots instead animate their own content. Static posts and
stories continue using the selected images.

To refresh the demo after storefront changes, start Vite and run:
  node scripts/capture-campaign-phone.mjs path/to/store-data.json
The snapshot contains public store/products data, in the order used by the
original campaign stills; it is not bundled or sent to campaign users. This
developer-only capture needs Playwright Chromium and ffmpeg. Production video
generation runs entirely in the browser with the bundled clip.

The editor stores per-scene element transforms in the campaign document's
optional layouts field. Older snapshots use the new defaults: a larger phone
and no opening logo/copy, with branding in the end card. Empty authored copy is
allowed; the AI response contract remains strict. Preview, JPGs and MP4s use
the same scene geometry. Guides and selection handles are DOM overlays and are
never exported.

Vertical safe guides use conservative working margins of 269 px at the top,
672 px at the bottom and 65 px at each side of a 1080 × 1920 frame, for both
Reels and Stories. These are guides for key copy/logo/CTA, not a promise that
every Instagram interface leaves the same area clear. Phone/photo edges may
bleed beyond them. Feed images have a 5% design inset. The end card's default
copy stays entirely inside the vertical guide. Meta's Reels guide explicitly
reserves the bottom 35% for its interface:
https://d3m889aznlr23d.cloudfront.net/img/events/458925814/assets/e042d2be.reels_ads_guide1.pdf
Placement guidance: https://www.facebook.com/business/help/980593475366490

The logo matches src/Brand.tsx. Manrope is distributed under the SIL Open Font
License; see Manrope-OFL.txt.

soundtrack.m4a is the original, synthesized 12-second Poeruum ad soundtrack.
It contains no third-party samples. The AAC file is muxed into the rendered MP4
without microphone access, network audio generation, or a browser AAC encoder.

Video encoding requires browser support for H.264 through WebCodecs. Completed
JPGs and text remain downloadable if video encoding fails or is canceled.

Selected stores use the optional phoneContent snapshot instead of the bundled
reference clip. The compact phone panel lists published stores, freezes 1–6
selected products (up to four gallery images each), and provides ordered product,
scroll, swipe, gallery and search actions. Each action lasts 1–10 seconds; content
is capped at 27 seconds, followed by the existing three-second brand card. Search
queries must match their destination product. Existing campaigns without a store
snapshot keep the original 12-second reference tour.

Product and logo images are embedded once in a raster-only asset dictionary.
Only presentation settings and public product fields are copied. Seller readiness
is preserved as a boolean without copying seller identity or contact details.
The snapshot budget is 2.6 MB, within the campaign document's 4 MB database limit.
Refresh the store explicitly through “Vaheta poodi või tooteid”; loading a saved
campaign never reads current store content. Compatible actions survive a refresh.

CampaignStoreFrame mounts the real Storefront in a fixed 390 × 804 iframe, with
analytics, automatic navigation and CSS animation disabled. html-to-image captures
its product details, galleries and search UI. The action renderer moves between
these frozen views deterministically; preview, static phone artwork and MP4 all
use the same captures. The iframe is removed after capture. Canvas backing stores
are copied into the parent document first (Chromium clears canvases belonging to
a detached iframe). The final soundtrack repeats/trims AAC packets to the selected
video duration. No server browser, microphone or screen-recording permission is
required. Capture errors are explicit and retryable; they never substitute a
different store's footage.
