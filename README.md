# SGVC project page

Static project page for **Streaming Generative Video Compression with Embedding Alignment and In-Context Propagation**.

Project URL: https://chigland.github.io/SGVC/

Website sources and assets are kept on the independent `gh-pages` branch. The repository's default `main` branch is reserved for the code release.

## Preview

Use the included Node.js preview server, which supports the HTTP byte-range requests needed for video seeking:

```bash
node preview.mjs
```

Then open http://127.0.0.1:8000/SGVC/. Opening `index.html` directly with `file://` does not allow the browser to fetch the media manifest. A server without byte-range support can reset a video's seek position to zero, so use this preview server when testing synchronized playback.

## Files

- `index.html`: title, authors, resource buttons, comparison player, Motivation, Framework, the main BD-rate table, and the paper's qualitative comparison.
- `style.css`: responsive layout and visual style.
- `app.js`: dataset/method selection, synchronized playback, seeking, looping, and the comparison divider.
- `preview.mjs`: optional local preview server with MP4 byte-range support; no dependencies required.
- `assets/media-manifest.json`: authoritative paths, display labels, source metadata, and figure captions.
- `assets/`: publication figures and browser-compatible reconstruction videos prepared from the supplied source files.

The website has no build step, third-party scripts, external fonts, analytics, or npm dependencies. All asset URLs are relative so the page works under `/SGVC/` on GitHub Pages.

## GitHub Pages

Install Git and the GitHub CLI (`gh`), then sign in to the **Chigland** account and run the supplied PowerShell publisher from this directory:

```powershell
gh auth login --hostname github.com
.\publish.ps1
```

The script verifies the account and access to the existing public `Chigland/SGVC` repository, commits local page changes when needed, and pushes local `HEAD` to the remote `gh-pages` branch. The repository's `main` branch is reserved for the code release and its current placeholder; the script never pushes to `main` or creates a repository. If `gh-pages` already exists, its history must be an ancestor of local `HEAD`; divergent histories stop publication and are never force-pushed.

The script configures GitHub Pages to publish the `gh-pages` branch and `/ (root)` folder. `.nojekyll` disables Jekyll processing. Source publication does not verify a successful deployment: confirm the build in the repository's Pages settings and open the public URL before sharing it.

## Add released resources

The GitHub, ModelScope, and arXiv controls are intentionally disabled and marked **Soon**. When the corresponding resource is available, replace its disabled `<button class="resource-button">` in `index.html` with an `<a class="resource-button" href="ACTUAL_URL">`, remove the `disabled` attribute and `Soon` span, and update its accessible label. Use the actual released URL; do not add a placeholder link.

## Video comparison

UVG is selected by default, with YODA as the initial reference. SGVC is always on the right. The selected ground-truth or comparison reconstruction appears on the left. All methods are loaded from the media manifest. Both videos share play/pause, seeking, and looping controls. Method changes preserve the current playback position; dataset changes reset playback. The divider and timeline support keyboard arrows. Both videos start paused and remain paused until the viewer presses Play. Playback is muted.

The initial comparison uses two JPEG previews taken from source frame index 1, the first P frame. Neither video has a media source attached until Play is requested, so opening the page or browsing previews downloads no MP4s. The divider works immediately on the previews; seeking becomes available once the videos are ready. While preparing playback, the previews cover the video elements until both have sought to the first P frame, avoiding a flash of the initial I frame. When switching methods after playback has started, the SGVC video is reused and the reference is aligned to the same playback time.

Slow downloads keep waiting while data arrives, with buffered progress shown in the player. Initial playback waits for 1.5 seconds of buffered video on both sides; after a stall, the pair waits for 2 seconds (or the remaining clip). The 60-second timeout measures inactivity, rather than total download time. Failed requests can be retried with Play, without reloading the page. Media waits observe progress and readiness events together to support browsers that defer `canplay` while paused.

The visible comparison is drawn to two native-resolution canvases. Each decoder's `requestVideoFrameCallback` captures pixels immediately into a bounded three-frame cache; only matching frame indices are presented, with both canvases updated in the same JavaScript task. During buffering or seeking, the last matched pair stays visible. Recovery aligns the decoders behind those canvases, and a small buffering badge replaces the former full-image dimming overlay. Source changes and seeks invalidate the frame caches; paused targets are captured after both seeks have decoded their target frames. Older browsers without video-frame callbacks use a playback-time-based fallback.

The display window starts at `firstDisplayFrame / playbackFps = 1/12` seconds and shows 95 P frames (about 7.92 seconds). Seeking to the beginning and looping both return to that point. The original 96-frame MP4s are unchanged: this is a presentation offset, not a re-encoding or a new codec evaluation. BPP labels still include the initial I frame and all 95 P frames from the complete evaluation.

Method controls form borderless, solid-fill tabs attached to the video's left edge, with the active tab extending farther outward. Inactive tabs use a muted blue-gray fill; the selected tab uses a deep blue fill with white text. The 500-weight labels and 8px outer corners retain the utility-control proportions inspired by the [Notion DESIGN.md analysis](https://getdesign.md/notion/design-md). On small screens, the tabs attach to the video's top edge with 44px touch targets. Dataset selection retains its original pill controls.

The supplied videos are presentation exports. Display playback frame rates are reported as such; they must not be interpreted as codec decoding speed. All labels and bitrates must be grounded in the media or paper. The page does not estimate bitrates from presentation MP4 sizes.

The left-side controls are ordered **GT, YODA, S²VC, GVC-RT**. S²VC was regenerated with the official model release (commit `d849ea1e2cfeb302a30a7de03628068f1e9eb2c8`) for the same first 96 frames of BasketballDrive, Jockey, and videoSRC02. The source evaluations use one initial I frame followed by 95 P frames (IP96), matching the supplied SGVC videos; the page displays only the P-frame portion, and the paper table below uses its separately stated IP32 protocol. All 96 input RGB8 hashes per sequence match the SGVC reference inputs.

S²VC uses native discrete rate checkpoints near each SGVC bitrate. Its displayed `≈` rate includes estimated I-frame y bits, fixed I-frame FSQ z bits, and actual P-frame payload bits. The release does not provide a complete independent I-frame bitstream decoder. A fresh-process replay from the saved I decoder state verifies all 95 P-frame reconstructions and recurrent states exactly, without reading original images. This rate basis is also available in the S²VC button and rate-label tooltips.

Display exports preserve every reconstructed frame at 12 fps. Lossless RGB exports are verified pixel for pixel before creating H.264 CRF16, YUV420p, BT.709 presentation copies using the same export recipe as the other methods. The comparison rates come from codec records, not these presentation files.

| Sequence | S²VC bpp (hybrid rate above) | SGVC bpp |
| --- | ---: | ---: |
| BasketballDrive | 0.011228 | 0.009637 |
| Jockey | 0.012327 | 0.011111 |
| videoSRC02 | 0.016037 | 0.014475 |

The selected native P/I rate pairs are 3.7/7.4 for BasketballDrive and Jockey, and 2.6/4.6 for videoSRC02. For the latter, 3.7/7.4 was also measured at 0.011965 bpp; 2.6/4.6 is closer to SGVC in log-rate distance.

## Content provenance

The title, author order, affiliations, and email addresses follow the prepared `SGVC_arxiv` release. The displayed research content follows the user-selected `SGVC_CVPR27/sections` sources:

- Motivation: `01_introduction.tex`, with `figs/intro_new.pdf` exported as `assets/figures/motivation.png`.
- Framework: `02_related_work.tex`, with `figs/framework_new.pdf` exported as `assets/figures/framework.png`.
- Qualitative comparison: `04_experiments.tex`, figure `fig:qualitative`, with `figs/main_rec_main.pdf` exported as `assets/figures/qualitative-comparison.png` (3600 × 1381). The original labels and BPP / DISTS / PSNR annotations are preserved; the full-resolution PDF is linked directly.
- BD-rate table: all 54 numeric values and the column-wise best-result formatting from `table_bdrate_s2vc.tex`. The table is relative to S²VC; the first 96 frames, intra period 32, and LPIPS-VGG follow `04_experiments.tex`. The table source currently exists separately with its manuscript input commented out; the website does not claim that this table appears in the arXiv PDF.

The three linked figure PDFs are byte-identical to their source PDFs. Display PNGs are exported with transparency after removing only the full-page white vector background from temporary PDF copies; text, strokes, colored regions, and intentional white diagram elements are preserved. The page presents SGVC as an adaptation of a pretrained latent video DiT into a causal pixel-space refiner; streaming does not imply measured real-time decoding.

## Visual direction

The figure suggests the broad blue/sage color family; the website uses an independently tuned palette with slate text, blue accents (`#355c87`), and a soft paper canvas (`#fafbfc`). Fine rules reference the [IBM analysis](https://getdesign.md/ibm/design-md); rounded resource buttons, readable sans-serif labels, and calm reading hierarchy draw on the [Notion analysis](https://getdesign.md/notion/design-md), discovered through [Awesome DESIGN.md](https://github.com/VoltAgent/awesome-design-md). The compact title, centered comparison heading, and softly rounded video surface reference [AVSR-Diff](https://kaist-viclab.github.io/AVSR-Diff/), while retaining SGVC's palette, vertical method selector, and single-line main title. All title words use a consistent style. The results retain a three-rule academic table. No third-party page code or branding is copied.
