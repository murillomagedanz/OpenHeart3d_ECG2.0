# Subthreshold Shadow Query Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Measure causal, read-only morphology queries at signal-derived subthreshold opportunities without changing emitted events.

**Architecture:** Reuse the morphology replay and its independent original/cap2 emission-trained banks. Enumerate signal opportunities without annotations, query before same-step learning, and score only afterward against references not already paired to each emitted baseline. Production `web/src` stays unchanged.

**Tech Stack:** Node.js ES modules, node:test, existing WFDB/FileSource/SignalPipeline, local 101-record frozen report.

---

## Predeclared protocol (before any result run)

- Keep SHADOW_PROTOCOL unchanged: four templates, signed centered unit-norm correlation >=0.90, three prior observations for maturity, 30 s expiry, ±80 ms vector, EMA 0.125. Queries never update vectors, support, timestamps, IDs, counters, expiry or eviction. Read-only age filtering uses query time; templates observed at or after query time are excluded.
- Opportunity: a positive MWI local maximum, after initial detector calibration, whose feature is <= the opening half-threshold recorded **before processing that peak sample**. Confirm first plateau sample by `previous.feat < peak.feat && peak.feat >= next.feat`. No amplitude floor, refractory exclusion, candidate-state gate or annotation-triggered windows; this deliberately includes noise and already-detected neighborhoods. Does not include above-opening weak candidates; this is the bounded below-opening stratum, not exhaustive missed-beat recovery.
- Alignment: largest absolute internal bandpass sample in the trailing MWI window `[peakIndex-mwiLen+1, peakIndex]`, earliest tie. Estimated opportunity time = aligned sample time minus group delay. No reference alignment, future alignment, or correlation maximization.
- Query time: first sample at/after both peak confirmation and aligned index + rounded 80 ms. Use only the complete finite ±80 ms vector then available; unavailable start/gap/flat vectors stay unavailable. No end-of-record future padding or delayed query beyond EOF; count pending EOF opportunities separately.
- On gaps clear pending opportunities and local-max history, clear emission bank as already specified; never bridge gaps. Query before observing any emission from the same pipeline step. Learn solely complete vectors from emitted events, in emission order; queried samples never teach.
- Enumerate full records. Posthoc score in the existing window (1 s through last reference +150 ms), with ±150 ms tolerance. Pair emitted baseline one-to-one using existing greedy labels. Report raw queries near any reference separately from unique coverage of remaining missed references. For mature queries use one-to-one greedy pairing **only to remaining baseline misses**; report unmatched proposals separately (including duplicates and already-detected neighborhoods), never hypothetical clinical TP/FP.
- Report each bank/record: unchanged emitted score; query status cold-start, immature match, no match, unavailable, mature match; raw nearby counts and nearby symbols; missed references/unique coverage by symbol, mature unique pairing by symbol and mature unmatched burden. Preserve 108/207 in full results. Observed corpus is development/regression, not independent validation; no promotion or parameter tuning.

### Task 1: Add read-only query and causal vector helper

**Files:** Modify `web/tests/qrs-shadow-bank.mjs`, `web/tests/qrs-morphology.mjs`; test `web/tests/qrs-subthreshold-query.test.mjs`.

1. Test immutable queries (including stale, invalid, flat, dimensional mismatch, signed polarity), strict previous observation and expiry boundary.
2. Implement `query(vector,time)` with validation, normalized comparison and read-only live filtering; reuse normalization and frozen constants.
3. Export reusable replay/vector helper and optional observer hook executed before emission learning; preserve existing return/events when disabled.
4. Run `node --test tests\qrs-shadow-bank.test.mjs tests\qrs-morphology.test.mjs tests\qrs-subthreshold-query.test.mjs` from `web`.

### Task 2: Enumerate and summarize opportunities

**Files:** Create `web/tests/qrs-subthreshold-query.mjs`; test `web/tests/qrs-subthreshold-query.test.mjs`.

1. Implement local-max state machine, trailing-MWI alignment and pending complete-vector scheduler; gaps invalidate pending/history.
2. Add synthetic causality, prefix/future perturbation, annotation independence, gap reset, same-step query-before-learning and control/cap2 enable/disable event equivalence tests.
3. Reuse `labelEvents`, `readLocalRecord`, frozen report and independent replays; summarize unique baseline-miss coverage and unmatched mature proposals without labeling queries clinical detections.
4. CLI: `node tests\qrs-subthreshold-query.mjs --all --output ..\docs\plans\2026-10-08-subthreshold-shadow-query-results.json`. Deterministic compact JSON includes every frozen record; no signals/event dumps.
5. Assert all 101 controls equal frozen report and all cap2 scores equal query-disabled replay; throw on mismatch, do not tune.

### Task 3: Measure, validate and save handoff

**Files:** Append section 16 to `docs/specs/001-validacao-detector-e-ondas-pt.md`; append completion here; generated compact results as above.

1. Run targeted tests first, then the frozen `--all` command.
2. Inspect totals, per-record 228/108/207/210 and symbol coverage; disclose missed-opportunity scope and burden, not just favorable examples.
3. Run `npm test` from `web`; if random vault IV/gzip failure occurs, report and retry without unrelated edits.
4. Run `node --check` for changed/new modules, `git diff --check`, and ensure `git diff -- web/src` is empty.
5. Save actual results and limitations in section 16 and completion/handoff here. No commit/push/merge, agent nesting or external APIs. Parent persists changes.

## Completion / handoff

Completed autonomously, without commits/push/merge, nested agents, external APIs, production changes or parameter tuning. The protocol above was saved before the first result run; eight new tests also passed within the full suite.

### Files delivered

- Modified `web/tests/qrs-shadow-bank.mjs`: strictly read-only normalized signed query, previous-time and age filtering.
- Modified `web/tests/qrs-morphology.mjs`: reusable finite causal vector and optional replay hook before same-step emission learning.
- Created `web/tests/qrs-subthreshold-query.mjs`: annotation-free local maxima, causal alignment/scheduling, independent banks, posthoc incremental denominators, CLI `--all`, all-record event-on/off and frozen-control assertions.
- Created `web/tests/qrs-subthreshold-query.test.mjs`: immutable state, stale/invalid inputs, polarity, prefix/future changes (synthetic and real signal), annotation independence, sample gaps, current-step ordering and unchanged emissions for both banks.
- Created `docs/plans/2026-10-08-subthreshold-shadow-query-results.json`: 362,077-byte deterministic compact report, every frozen record and every 30 s interval of 108/207.
- Appended section 16 to `docs/specs/001-validacao-detector-e-ondas-pt.md`: reproducibility, actual measured evidence, complete denominator interpretation, difficult intervals, limits and next bounded hypothesis.

### Actual evidence (not clinical query TP/FP)

| Measure | Original | Cap2 |
|---|---:|---:|
| Unchanged emitted TP / FP / FN | 30,418 / 582 / 435 | 30,763 / 632 / 90 |
| Queries scored | 358,799 | 357,680 |
| Cold / immature / no match / unavailable / mature | 1,288 / 5,272 / 337,198 / 0 / 15,041 | 1,249 / 5,188 / 336,197 / 0 / 15,046 |
| Raw reference-nearby / missed-reference-nearby queries | 94,877 / 2,464 | 93,854 / 481 |
| Unique missed references nearby / total misses | 434 / 435 | 90 / 90 |
| Mature proposals paired one-to-one to baseline misses | 92 (N78 V7 F1 a3 E1 L2) | 23 (N11 V5 F1 a3 E1 L2) |
| Mature unmatched proposals | 14,949 | 15,023 |
| Unmatched with no reference nearby | 9,918 | 10,049 |

228 original: all 349 missed N have signal-derived opportunities nearby, but only 72 N are mature-paired; 1,363 mature proposals unmatched. Cap2: only its remaining eight missed N are eligible for incremental coverage, five mature-paired and 1,315 unmatched. 108 original/cap2: one N mature-paired versus 2,444/2,486 unmatched. 207: three/two V mature-paired versus 529/576 unmatched. 210: six misses mature-paired in either bank; no emission veto, including the known new/immature V.

Full record lifecycle: original/cap2 enumerate 360,694/359,575 opportunities, query 360,613/359,494, leave 81/81 pending at EOF, invalidate zero pending due to real gaps. Corpus has no observed detection-lead gaps; gap safety is exercised by synthetic/injected-gap tests, not independently validated from these zero counts.

### Verification and reproducibility

- Targeted `node --test tests\qrs-shadow-bank.test.mjs tests\qrs-morphology.test.mjs tests\qrs-subthreshold-query.test.mjs`: final **20/20 pass**. Initial fixture failure corrected (the NaN was outside the purported crossing vector, not an implementation defect); no research parameters changed.
- `npm test`: **219/219 tests pass**, followed by synthetic detector bench and real-record bench; exit 0. No vault IV/gzip failure occurred in the full-suite runs.
- Full `--all`: every one of 101 frozen controls matches; control/cap2 query-on/off event streams identical in all 101 records per bank (202 comparisons).
- Repeated `--all` regenerates the report byte-for-byte. SHA256: `83a373d0f6f65c1e376cb787543da06cb89bfbdbe8a42ac35e70db920f837033`.
- `node --check` passes for four changed/new modules; `git diff --check` passes; `git diff -- web\src` empty. No lint/TypeScript configuration was introduced; no dependencies/data changed or named scratch artifacts created.

### Handoff decision / remaining limits

Do **not** promote or call matched proposals clinical detections: broad opportunity enumeration reaches most missed references, but mature correspondence is insufficient and highly contaminated by unmatched proposals. This is inspected-corpus development/regression, not independent validation. Above-opening weak candidates, optimal alignment, quality, CPU/global memory measurements, product/streaming integration and unseen-record validation remain outside scope.

Next justified bounded research only: describe query energy relative to the same template's **prior emitted** energy distribution, without query learning, new energy cutoffs, decision changes, or veto of new V. Freeze measurement definitions before that run; the present result does not authorize a detector intervention. Parent reviewed the handoff and persists the plan, report, tests and SDD together on `murillomagedanz-diagnostico-qrs`, PR #13, without merge. The uncommitted state above describes the subtask handoff, not the final publication.
