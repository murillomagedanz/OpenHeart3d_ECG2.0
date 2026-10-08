# Template Energy Shadow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Describe, causally and without any detector decision, whether mature subthreshold proposals paired to baseline misses and mature unmatched proposals occupy different energy ranges relative to the *prior emitted* energy of the same template.

**Architecture:** Extend the research-only `ShadowBank` so every template also carries the centered mean-square energy of the same +/-80 ms vectors it already normalizes, updated solely by emissions. Queries stay strictly read-only and report energy against pre-query template state. Reuse the existing replay, query monitor, greedy labels and posthoc pairing through one extracted classifier; a thin runner adds descriptive energy summaries and regenerates the prior report projection as an exactness check. Production `web/src` stays unchanged.

**Tech Stack:** Node.js ES modules, node:test, existing WFDB/FileSource/SignalPipeline, local 101-record frozen report and the saved subthreshold query report.

---

## Predeclared protocol (written before any energy result run)

Frozen and untouched: `SHADOW_PROTOCOL` (four templates, signed centered unit-norm correlation >=0.90, maturity after three prior observations, 30 s expiry, +/-80 ms vector, EMA 0.125), the below-opening enumeration, trailing-MWI alignment, query timing, one-to-one greedy pairing to baseline misses, original and cap2 banks. No energy value enters any matching, maturity, expiry, eviction, query status, event, veto or threshold. No query learns, refreshes or touches template state.

### Measurement definitions

- **Energy** of a vector `v` of `n` samples (causal internal bandpass window, +/-80 ms around the aligned center, the exact vector that is mean-removed and L2-normalized for shape): `E(v) = (1/n) * sum((v_i - mean(v))^2)`. It is finite and >0 by construction when the shape vector is available (the existing flat guard `norm > 1e-12` applies); invalid/short/non-finite/flat vectors yield **unavailable** energy with an explicit reason. Queried and emitted vectors use the same bandpass signal and the same window width, so energies are directly comparable. The query MWI feature and the emitted candidate `maxFeat` are **never** compared: they are different quantities (MWI sum versus bandpass window) and the query alignment (trailing-MWI absolute maximum) is not the emission alignment; this alignment discrepancy is a limit, not corrected.
- **Template energy state**, created with the template and discarded with it (expiry, eviction, gap): `energy` = EMA of emitted-window energies with the same weight 0.125 (initialised to the first emitted energy), plus `energyMin` / `energyMax` of the emitted energies since template creation (a predeclared prior range; no outlier trimming). Updated only inside `observe` on a matched or created emission, after the match decision and after reading the prior state. `observe` returns the *pre-update* state it compared against.
- **Prior-state query block** `query.energy`: `{ status: 'ok' | 'unavailable', reason, query, prior, priorMin, priorMax, ratio }`. `ratio = query / prior` is present only when both are finite and >0 and a matched live template exists (status `ok`). Reasons for unavailability: `invalid-query-vector`, `flat-query-vector`, `non-finite-energy` (overflow guard), `no-matched-template`, `prior-energy-unavailable`. A signed shape change does not alter energy; scaling the query by `k` multiplies `ratio` by `k^2`.
- Analysis scale: `L = log2(ratio)` (one unit = factor 2 in energy, i.e. sqrt(2) in amplitude). Nothing is thresholded on `L`.

### Populations (mature actual matches only, no retrospective enrichment)

Rows are the existing `mature-match` queries, grouped by the *same* one-to-one posthoc pairing to baseline misses used by the prior report (extracted, not reimplemented):

`paired` (also split by reference symbol), `unmatched` = `duplicateMissNeighborhood` + `alreadyDetectedNeighborhood` + `noReferenceNeighborhood` (existing mutually exclusive strata and priority). Original and cap2 banks stay separate. Query templateId is only used for mature matches; best no-match templates are not used.

### Reported descriptive measures (per bank pooled, per bank/record, and for 228/108/207/210 as ordinary records)

Per group: `n` mature, `withRatio`, unavailable counts by reason, distinct records and templates (key `record|templateId`), `L` quantiles (min, p10, p25, median, p75, p90, max by index `round((n-1)p)`), fixed octave histogram of `L` with predeclared edges `-4,-2,-1,0,1,2,4` (descriptive bins, not cutoffs), quantiles of `supportBefore` and template `ageS`, and the position of the query energy relative to the template's prior min/max (`below`, `within`, `above`, `unavailable`).

Comparisons `paired` versus `unmatched` and versus each unmatched stratum:

- Pooled **rank statistic** `P(L_paired > L_other)` with ties counted 0.5 (Mann-Whitney AUC as a descriptive overlap statistic; 0.5 means no difference) and the overlap fractions "share of the other group inside the paired p10-p90 interval" and "share of paired inside the other group's p10-p90 interval".
- **Within-template**: for every template (bank/record/templateId) with at least one row in each group, the AUC inside the template; the weighted-by-pair-count stratified AUC; counts of templates with AUC >0.5, <0.5, =0.5. Templates with >=3 rows in each group are listed compactly (predeclared support floor), with n, median `L`, median support/age per group and AUC. Explicit strata: templates paired-only, unmatched-only and both (templates and proposals). Energy is a changing prior state: ratio is always against the prior at query time, never a fixed cluster truth, and the pooled statistic is not read as separation when within-template statistics differ (between-template mixture is reported by comparing both).
- Record level repeats the descriptions with the same predeclared quantiles; record-level AUC is only given when both groups have >=3 ratios.

No clinical TP/FP language: paired = hypothetical coverage of a baseline miss by proximity; unmatched = proposal burden.

### Verification design

- Prior projection: the new runner uses the unchanged `investigateQueries` path and checks that the regenerated `records` and `totals` serialize identically to the saved `2026-10-08-subthreshold-shadow-query-results.json` (all per-record counters, 101 frozen controls, cap2 scores, symbols and 108/207 intervals). The saved report is only read, never rewritten.
- Event invariance: the existing query on/off event comparison for both banks and all 101 records remains active.
- Per-template state is O(1) (energy, min, max); statistics keep only per-row scalars for the run and the report contains compact quantiles, not raw rows or signals. Deterministic: no clocks, no rounding.

### Task 1: Bank energy state and query block

**Files:** Modify `web/tests/qrs-shadow-bank.mjs` (add `ENERGY_PROTOCOL`, centered energy helper shared with normalization, energy state and blocks, legacy `observe(vector, time)` signature unchanged); test `web/tests/qrs-template-energy.test.mjs`.

1. Test analytic scaling (`k` gives `k^2`, polarity keeps energy, mean offset ignored), pre-update prior, immutability including energy, expiry/gap/eviction discarding energy, unavailable/flat/non-finite guards.
2. Implement; confirm existing bank/query tests pass unchanged.

### Task 2: Reusable classification and energy summaries

**Files:** Modify `web/tests/qrs-subthreshold-query.mjs` (extract `classifyMature`, optional `onBank` hook; same outputs); create `web/tests/qrs-template-energy.mjs`.

1. Tests: summaries analytic cases, within-template versus pooled mixture example (Simpson-type), unavailable accounting, causal prefix/future perturbation of energy blocks, and event/status invariance.
2. Implement summaries and CLI.

### Task 3: Run, verify, document

1. `node --test tests\qrs-shadow-bank.test.mjs tests\qrs-morphology.test.mjs tests\qrs-subthreshold-query.test.mjs tests\qrs-template-energy.test.mjs`
2. `node tests\qrs-template-energy.mjs --all --output ..\docs\plans\2026-10-08-template-energy-shadow-results.json` (run twice; compare bytes), and `node tests\qrs-template-energy.mjs mitdb/228 mitdb/108 mitdb/207 mitdb/210` for the key records.
3. `npm test`, `node --check` on changed/new modules, `git diff --check`, and `git diff -- web/src` empty.
4. Append the actual findings to this file and SDD section 17; no commit, push or merge (parent persists). If energy overlap is large, record the negative result; no threshold, retuning, intervention or veto is derived.

## Completion / handoff

Executed. Files: `web/tests/qrs-shadow-bank.mjs` (additive energy state/blocks), `web/tests/qrs-subthreshold-query.mjs` (extracted `classifyMature`, `onBank` hook), new `web/tests/qrs-template-energy.mjs` and `qrs-template-energy.test.mjs`, `docs/plans/2026-10-08-template-energy-shadow-results.json` (529,233 bytes, SHA256 `E42E9516BD924C7952B1208441438D9D70CB6C93F7AEBE6981D8F258F004F4AC`, byte-identical across two `--all` runs), SDD section 17. Verification: prior saved report projection identical for 101/101 records and protocols; events on/off identical; 227/227 `npm test` (219 + 8 new), benches exit 0; `node --check`, `git diff --check` clean; `web/src` unchanged. Result: paired mature proposals have higher relative energy than unmatched (original median L -3.15 vs -6.39; pooled AUC 0.81, within-template 0.90; cap2 0.77/0.85), but against alreadyDetected (0.70) and duplicateMiss (0.48) neighborhoods separation is weak or absent, overlap is large, and 62/92 paired sit below the prior min. No threshold selected; no detector change. Limits: development corpus, alignment discrepancy, time-varying prior, 92 pairs dominated by record 228, CPU unmeasured, unseen validation pending.
