# Target Expressionist

> **Rank any gene across 33 TCGA cancers — and make it your plot.**

A little retro computer for cancer genomics. Type any gene, get an instant **ranked box plot of its expression across all 33 TCGA cancer types**, then drop onto an interactive canvas to style it into a **publication-ready figure** — export it as PNG/SVG or share it as a link.

No backend. Real TCGA data. A pixel-art CRT you can actually type into.

<!-- Add a hero GIF here once recorded: ![demo](docs/demo.gif) -->

**🔗 Live demo → https://qin-tjo.github.io/Target-dashboard/**

<sub>(First deploy: in the repo, **Settings → Pages → Build and deployment → Source: “GitHub Actions.”** The included workflow builds and publishes on every push to `main`.)</sub>

---

## What it does

- 🖥️ **Type a gene on a retro CRT** — a pixel keyboard you can click or type on, with cBioPortal-style autocomplete (powered by [MyGene.info](https://mygene.info)).
- 📊 **Instant ranked box plot** across the **33 TCGA cancer types**, sorted by median expression, in `log2(TPM+1)`.
- 🎨 **Interactive canvas** — editable/resizable title & axes, colorblind-checked palettes, rotatable x-axis, hover tooltips, a beeswarm/points overlay, and an outlier toggle.
- 💥 **Playful animations** — bars animate in with a stagger, deleting a bar **shatters it into pieces** while the rest re-rank, resetting **crumples the figure into a trash can**, and generating a plot **zooms you “into the computer.”**
- 🖼️ **Export** a clean **PNG** (hi-DPI) or vector **SVG**, or **copy a shareable link** that reconstructs the exact figure (gene + every edit).
- 📝 **Self-documenting footnote** — every figure carries a copy-ready methods/provenance caption (gene, Ensembl id, n, data source, date).

## The data — and why you can trust it

The plot is built from a **scientifically defensible pipeline**, applied identically whether the figure loads from the bundled cache or live:

- **Source:** UCSC Xena’s **Toil recompute of TCGA RSEM TPM** (`tcga_RSEM_gene_tpm`) — uniformly reprocessed, comparable across cohorts.
- **Unit:** `log2(TPM+1)` (back-transformed from the hub’s `log2(TPM+0.001)`).
- **Primary tumors only:** sample types **`01`/`03`/`09`** (so LAML uses blood-derived `03`, SKCM uses its `01` primaries; metastatic/recurrent/normal/control excluded). One uniform rule — all 33 cohorts retained.
- **One sample per patient**, chosen **value-independently** (priority then lexicographic — *not* by max, which would bias medians).
- **Drops** exact duplicates and missing values; flags small-n cohorts.
- **Gene-symbol drift handled:** the dataset uses GENCODE v23 symbols, so renamed targets (e.g. `NECTIN4` → `PVRL4`) are resolved via previous/alias symbols, **validated against the gene’s Ensembl id** to avoid alias collisions.

Box stats are **precomputed for ~19,000 protein-coding genes** and bundled (sharded by first letter) for instant, offline plots; the ~20 most-common targets ship with full per-sample data for the beeswarm overlay; anything else resolves live from Xena on demand.

> ⚠️ **For research/education only — not for clinical use.** Cross-cohort single-gene TPM comparison is exploratory, not a formal differential-expression test.

## Tech

React + TypeScript + Vite · D3 (scales/quantiles) · Framer Motion (animation) · Tailwind. Static site — deploys to GitHub Pages. Data queried client-side from CORS-enabled public APIs (UCSC Xena, MyGene.info); no server.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # QC pipeline unit tests (Vitest)
npm run build      # production build → dist/
```

### Rebuilding the data (optional)

The bundled data (`public/stats/*.json`, `src/data/`) is committed, so you don’t need this to run the app. To regenerate it from UCSC Xena:

```bash
npm run build-data                 # full rebuild (~25 min; fetches ~19k genes)
npm run build-data -- --aliases-only   # fast pass: only resolve renamed genes
```

## Credits & data sources

- **TCGA / GDC** — the source tumor cohorts. [PanCanAtlas](https://gdc.cancer.gov/about-data/publications/pancanatlas)
- **UCSC Xena** — Toil uniform recompute + hub API. Vivian et al., *Nat Biotechnol* 2017. [xenabrowser.net](https://xenabrowser.net)
- **MyGene.info** — gene autocomplete & id resolution. [mygene.info](https://mygene.info)

## License

[MIT](./LICENSE) © 2026 Qin Tjokrosurjo

_Built to demonstrate that data rigor and a genuinely fun interface aren’t mutually exclusive._
