# Relatório do delineador de ondas P/T

Gerado por `npm run report:waves` (determinístico; um teste regenera e compara). Especificação: [SDD 001](../../../docs/specs/001-validacao-detector-e-ondas-pt.md); decisão D16 em [`docs/DECISOES.md`](../../../docs/DECISOES.md).

Tolerância de ±150 ms. LUDB: id par = ajuste (tuning), id ímpar = held-out. detected = R do detector; reference = R anotado (isola o delineador). FA/flutter não têm onda P anotada: P detectadas nesses registros contam como FP. Erro = detecção − anotação (ms). Parâmetros ajustados somente em registros pares. Estimativa visual por algoritmo, não diagnóstico.

| Escopo | Divisão | Modo | Onda | Reg. | TP | FP | FN | Sens. | VPP | Início (ms) | Pico (ms) | Fim (ms) |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|
| derivação II | tuning | detected | P | 47 | 276 | 48 | 20 | 0,932 | 0,852 | 1,8 ± 33,9 | 3,7 ± 15,2 | -5,3 ± 21,0 |
| derivação II | tuning | detected | T | 47 | 349 | 6 | 32 | 0,916 | 0,983 | 15,6 ± 50,4 | 4,0 ± 28,5 | -8,7 ± 41,3 |
| 12 derivações | tuning | detected | P | 47 | 2835 | 389 | 716 | 0,798 | 0,879 | 4,6 ± 32,8 | 4,8 ± 20,0 | -1,1 ± 24,6 |
| 12 derivações | tuning | detected | T | 47 | 4125 | 114 | 408 | 0,910 | 0,973 | 14,8 ± 48,8 | 2,0 ± 26,7 | -14,2 ± 44,5 |
| derivação II | tuning | reference | P | 47 | 280 | 48 | 16 | 0,946 | 0,854 | 2,0 ± 33,5 | 3,6 ± 15,2 | -5,2 ± 21,1 |
| derivação II | tuning | reference | T | 47 | 357 | 5 | 24 | 0,937 | 0,986 | 16,0 ± 50,2 | 4,1 ± 27,9 | -8,6 ± 40,8 |
| 12 derivações | tuning | reference | P | 47 | 2886 | 369 | 665 | 0,813 | 0,887 | 4,6 ± 32,7 | 4,8 ± 19,9 | -1,1 ± 24,7 |
| 12 derivações | tuning | reference | T | 47 | 4222 | 98 | 311 | 0,931 | 0,977 | 14,1 ± 47,9 | 1,8 ± 25,5 | -14,5 ± 43,3 |
| derivação II | held-out | detected | P | 40 | 260 | 30 | 4 | 0,985 | 0,897 | -0,7 ± 26,2 | 1,4 ± 4,9 | -6,3 ± 18,5 |
| derivação II | held-out | detected | T | 40 | 326 | 1 | 18 | 0,948 | 0,997 | 12,9 ± 47,5 | 2,4 ± 21,7 | -4,8 ± 54,6 |
| 12 derivações | held-out | detected | P | 40 | 2556 | 335 | 606 | 0,808 | 0,884 | -0,8 ± 26,0 | 2,1 ± 11,5 | -2,0 ± 20,1 |
| 12 derivações | held-out | detected | T | 40 | 3811 | 28 | 313 | 0,924 | 0,993 | 13,9 ± 47,7 | 3,1 ± 28,8 | -6,5 ± 59,7 |
| derivação II | held-out | reference | P | 40 | 260 | 32 | 4 | 0,985 | 0,890 | -0,4 ± 25,8 | 1,5 ± 4,2 | -6,1 ± 18,1 |
| derivação II | held-out | reference | T | 40 | 332 | 3 | 12 | 0,965 | 0,991 | 15,9 ± 47,4 | 3,1 ± 21,9 | -5,4 ± 54,7 |
| 12 derivações | held-out | reference | P | 40 | 2555 | 370 | 607 | 0,808 | 0,874 | -0,7 ± 25,9 | 2,1 ± 11,4 | -2,0 ± 20,0 |
| 12 derivações | held-out | reference | T | 40 | 3879 | 54 | 245 | 0,941 | 0,986 | 14,7 ± 47,1 | 3,5 ± 28,6 | -6,6 ± 59,2 |
| derivação II, só ritmo sinusal | tuning | detected | P | 41 | 276 | 16 | 20 | 0,932 | 0,945 | 1,8 ± 33,9 | 3,7 ± 15,2 | -5,3 ± 21,0 |
| derivação II, só ritmo sinusal | tuning | detected | T | 41 | 295 | 1 | 25 | 0,922 | 0,997 | 13,7 ± 49,6 | 2,4 ± 24,9 | -10,2 ± 37,5 |
| derivação II, só ritmo sinusal | held-out | detected | P | 34 | 260 | 9 | 4 | 0,985 | 0,967 | -0,7 ± 26,2 | 1,4 ± 4,9 | -6,3 ± 18,5 |
| derivação II, só ritmo sinusal | held-out | detected | T | 34 | 276 | 0 | 6 | 0,979 | 1,000 | 9,6 ± 44,6 | 0,0 ± 16,4 | -4,9 ± 54,7 |
