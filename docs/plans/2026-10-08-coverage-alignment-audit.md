# Coverage/alignment audit: one bounded shift ablation against the same prior bank

**Goal:** Of 435 original-bank baseline misses, 434 lie within +/-150 ms of a signal-derived sub-opening opportunity but only 92 pair with a mature-match proposal (23/90 cap2). Distinguish (a) *alignment mismatch* of the fixed trailing-MWI absolute-bandpass-maximum center, from (b) *absence / immaturity / unavailability* of a prior template. One predeclared, bounded shape-only ablation. No classifier, no new covariate, no tuning, no detector intervention, no promotion.

**Architecture:** Research-only, `web/tests`. A subclass `AlignmentMonitor` of the existing `OpportunityMonitor` evaluates, at the **same original query instant and against the same immutable bank snapshot**, the baseline vector (shift 0, identical to the saved query) plus the other predeclared shifted vectors. The bank is queried (never taught) before the current-step emission learns. Reuse `investigateQueries` (additive `createMonitor` option and `refs/missed` in `onBank`), `classifyMature`, `summarizeQueries`, the context/energy study (`runContextStudy`) and `verifyPriorProjections`. `web/src` untouched; earlier saved reports are not rewritten.

**Tech stack:** Node.js ES modules, node:test, local WFDB replay, frozen 101-record `validation.json`, independent original(control) and cap2 shadow banks. No external APIs, no nested agents.

## Frozen protocol (recorded before the first alignment result run)

### Measurement and shift definitions

- Opportunity enumeration, original alignment center `c0` (earliest absolute bandpass maximum in the trailing MWI window), query instant `queriedAt` (first sample after confirmation and complete +/-80 ms vector at `c0`), bank snapshot, `SHADOW_PROTOCOL` (4 templates, signed correlation >= 0.90, maturity 3 prior observations, expiry 30 s, +/-80 ms, EMA 0.125), normalization (centered, unit-norm, signed dot product, no abs) are all frozen and reused.
- **Shift grid (chosen before any result, not tuned):** `ms in {-20,-10,0,+10,+20}`; integer samples `s = sign(ms)*round(|ms|*fs/1000)` (360 Hz: -7,-4,0,+4,+7; 500 Hz: -10,-5,0,+5,+10). Rationale: +/-20 ms is a quarter of the +/-80 ms vector radius and about half a normal QRS duration; 10 ms spacing is the lag already used by `localShape`/`causalSlope`. The grid is symmetric, small, and fixed. Positive `s` = later center.
- Shifted vector = `causalVector(bp, (c0+s)/fs, fs, sampleIndex)` where `sampleIndex` is the sample index of the original query. **No padding, no future signal, no later query time.** A shift whose vector would need samples beyond `sampleIndex`, before sample 0, or non-finite samples is **unavailable** for that opportunity and counted, never imputed. Shift 0 reproduces the saved baseline query exactly (asserted).
- All shifted queries use the same `queriedAt` and the same bank object state (query is read-only; bank snapshot is identical for every shift). Nothing learns from queries or shifted vectors; emitted events are identical enabled/disabled (verified 101 original + 101 cap2).
- **Selection (hypothetical shadow search, not an intervention):** among available shifts whose query has live templates (finite signed similarity), the **highest signed similarity**; tie -> smaller |ms|, then the earlier (negative) shift. If no shift has live templates, the shifted result is the shift-0 query (or, if shift 0 itself is unavailable, the smallest-|ms| available shift; if none, the baseline query). Status of the selected shift is the shifted status (`mature-match` if similarity >= 0.90 and prior support >= 3 of the best live template of that shift, etc.). Because shift 0 is always a candidate, similarity is never lower than baseline, but a different best template can turn mature into immature (reported as regression).
- **Optimism of max over shifts:** a maximum over up to 5 correlated shifts inflates similarity for every opportunity including noise. This is acknowledged and measured by a posthoc control: baseline-nonmature -> shifted-mature conversion rates per posthoc stratum (near missed ref / near only already-detected ref / no reference nearby). Annotations never enter selection, alignment or bank state.

### Timestamp / scoring (avoid confound)

- **Primary (shape-only):** every opportunity keeps its original estimated timestamp `t` and the original posthoc +/-150 ms scoring, greedy one-to-one pairing of mature proposals to baseline misses, and strata. Only the status/similarity may change.
- **Secondary (separate denominators, labelled):** shifted-center timestamp `t + s_selected/fs`, same scoring. Never merged with the primary numbers.
- Pairing/strata exactly as in the earlier studies (`classifyMature`): paired / duplicateMissNeighborhood / alreadyDetectedNeighborhood / noReferenceNeighborhood. Paired = hypothetical proximity coverage, **not TP**; unmatched = proposal burden, **not clinical FP**.

### Descriptions and denominators (control = primary bank; cap2 reported separately)

Per bank and per record, plus all-101 totals and an excluding-228 diagnostic projection:
1. Unique-miss denominators: 435 baseline misses (control), unique misses near any query (434), baseline mature-paired (92) vs shifted mature-paired, **net gain = shiftedPaired - baselinePaired**, gained (shifted\baseline), lost (baseline\shifted), gained/lost by symbol.
2. Unmatched burden: baseline matureUnmatched (14,949) vs shifted, delta, delta per net gain, strata (duplicate / already-detected / no reference).
3. Opportunity-level status transition matrix baseline -> shifted (5 statuses; improved / unchanged / regressed), for strata: all queries; queries near a missed reference; queries with all five shifts available.
4. Shift availability (vector available/unavailable per ms, all queries and near-missed queries); selected-shift (lag) distribution for all, for shifted-mature, and for converted-near-missed queries.
5. Bank maturity at query: queries with no live template / live but no mature template / at least one mature live template (all, near-missed, converted).
6. **Unique-miss decomposition (overlapping flags, clearly labelled, and an exclusive hierarchy):** flags per unique miss using queries within +/-150 ms: no nearby opportunity; nearby but only cold-start/unavailable queries; any live template; any live template with mature support; any no-match / immature / mature. **Exclusive hierarchy by best baseline status over nearby queries**, priority high to low: mature-paired (greedy), mature-unpaired (matched mature but lost the one-to-one pairing), immature-match, live-no-match (<0.90), cold/unavailable only, no nearby opportunity. Same hierarchy for the shifted primary run, a baseline -> shifted hierarchy cross-count, and best-similarity bins (`<0.5, [0.5,0.7), [0.7,0.8), [0.8,0.9), >=0.9, none`) per miss, baseline and shifted.
7. Intervals: all 61 30-s intervals of 108 and 207 per bank retained (queries, misses, baseline/shifted pairs and unmatched under the global pairing). Difficult records 228/108/207/210 keep full per-record detail.
8. The saved shadow templates reflect **matured emitted labels, not truth**: the bank is emission-trained and can be contaminated by false emissions and missed beat types; it is not a ground-truth morphology reference. 101 records are development/regression, not independent validation.

### Interpretation limits

- Failing 0.90 for every **evaluated** shift in {-20..+20 ms} means no correspondence in that tested neighborhood only; it does not prove absence of the morphology in any template or at any shift. A shift gain shows alignment sensitivity of the signed-correlation match, not detection performance. Opportunities are correlated; many refs share neighbors.
- Max over shifts is optimistic; positive shifts are often unavailable at the original query instant by construction (asymmetric availability is reported, not repaired). No later-delay variant is run in this subtask.

### Frozen closure criterion (control bank, primary shape-only run; cap2 reported, cannot substitute)

Descriptive-positive (limited) requires **all**:
1. net gain (shifted paired - baseline paired) >= 10 unique missed references over 92;
2. non-228 records with net gain >= 3 count at least 3;
3. marginal burden `(shiftedUnmatched - baselineUnmatched) / net gain <= 14,949/92 = 162.489` (baseline unmatched per pair); a non-positive delta passes.

Else: **conclude alignment alone is not enough (or the evidence is insufficient to replicate) and stop this bounded investigation**: no more variants, no further shifts, no later-delay arm. Reasons (gain / replication / burden) reported separately. Even if the criterion is met: descriptive only, **no promotion**, no threshold or classifier, no product/CPU claim.

## Tasks and commands

1. Additive hooks: `createMonitor` option and `refs`/`missed` payload in `investigateQueries`; extra `hooks` in `runContextStudy`.
2. New `web/tests/qrs-alignment-audit.mjs` + `.test.mjs`: shift zero reproduces baseline; analytic shifted-waveform signed detection; query snapshot immutable; unavailable future shifts + prefix/future perturbation; sample gaps; same-step query before learn; constant timestamp in primary; duplicates vs unique; enabled/off equality.
3. From `web`: targeted `node --test` of the six shadow/query/energy/context/alignment test files; `node tests\qrs-alignment-audit.mjs --all --output ..\docs\plans\2026-10-08-coverage-alignment-audit-results.json`; repeat to `...-repeat.json`, compare SHA256, remove only that named file; `npm test`; `node --check` changed/new modules; `git diff --check`; `git diff -- web/src` empty.
4. Verify unchanged: saved query, energy and context projections (records, totals, protocols) 101/101; frozen controls and on/off events. Append SDD section 19 with actual measurements and the stop/next decision.

## Completion / handoff

Executed once as frozen. Control: paired 92 -> 105 (+13 gained, 0 lost), unmatched 14,949 -> 24,234 (marginal 714.2 per gain vs 162.5); non-228 net +7 and 0 records with net >= 3. Cap2 23 -> 32. Outcome: `not-met-alignment-alone-insufficient-stop` (replication and burden fail); bounded investigation closed, no variants, no promotion. Results: `2026-10-08-coverage-alignment-audit-results.json` (731,824 bytes, SHA256 ACD10AA8...0FDE02, repeat run identical). Tests 46/46 targeted, 245/245 `npm test`. Details in SDD section 19. **Subtask is uncommitted; the parent persists/publishes (nothing committed, pushed or merged here).**