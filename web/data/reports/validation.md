# Relatório de validação do detector de QRS

Gerado por `npm run report` (determinístico; um teste regenera e compara). Protocolo e decisão: [`docs/DECISOES.md`](../../../docs/DECISOES.md) D15 e [SDD 001](../../../docs/specs/001-validacao-detector-e-ondas-pt.md).

Janela de ±150 ms; primeiro 1 s ignorado (aquecimento); detecções entre 1 s e o último batimento anotado + tolerância. LUDB: id par = ajuste (tuning), id ímpar = held-out. Erro = detecção − anotação (positivo = detecção tardia). Resultado de pesquisa em bancos públicos, não validação clínica.

## Agregados

| Grupo | Reg. | Batimentos | FP | FN | Sens. | VPP | Erro médio ± DP (ms) | Mediana \|erro\| (ms) | P95 \|erro\| (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Total | 40 | 2645 | 6 | 9 | 0,9966 | 0,9977 | -0,4 ± 8,2 | 2,8 | 4,0 |
| ludb | 39 | 373 | 6 | 8 | 0,9786 | 0,9838 | 9,6 ± 18,9 | 4,0 | 50,0 |
| mitdb | 1 | 2272 | 0 | 1 | 0,9996 | 1,0000 | -2,0 ± 1,3 | 2,8 | 2,8 |

## Por divisão (LUDB)

| Grupo | Reg. | Batimentos | FP | FN | Sens. | VPP | Erro médio ± DP (ms) | Mediana \|erro\| (ms) | P95 \|erro\| (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ludb: held-out | 16 | 153 | 5 | 8 | 0,9477 | 0,9667 | 11,0 ± 22,5 | 2,0 | 56,0 |
| ludb: tuning | 23 | 220 | 1 | 0 | 1,0000 | 0,9955 | 8,6 ± 15,9 | 4,0 | 40,0 |

## Por ritmo (LUDB)

| Grupo | Reg. | Batimentos | FP | FN | Sens. | VPP | Erro médio ± DP (ms) | Mediana \|erro\| (ms) | P95 \|erro\| (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ludb: Atrial fibrillation | 8 | 83 | 1 | 8 | 0,9036 | 0,9868 | 21,4 ± 25,5 | 8,0 | 58,0 |
| ludb: Atrial flutter, typical | 3 | 41 | 4 | 0 | 1,0000 | 0,9111 | 2,3 ± 3,1 | 2,0 | 8,0 |
| ludb: Irregular sinus rhythm | 2 | 18 | 0 | 0 | 1,0000 | 1,0000 | 17,9 ± 12,7 | 28,0 | 30,0 |
| ludb: Sinus arrhythmia | 4 | 38 | 1 | 0 | 1,0000 | 0,9744 | -1,0 ± 6,2 | 2,0 | 10,0 |
| ludb: Sinus bradycardia | 6 | 41 | 0 | 0 | 1,0000 | 1,0000 | 4,1 ± 8,8 | 2,0 | 28,0 |
| ludb: Sinus rhythm | 12 | 102 | 0 | 0 | 1,0000 | 1,0000 | 13,2 ± 21,6 | 4,0 | 48,0 |
| ludb: Sinus tachycardia | 4 | 50 | 0 | 0 | 1,0000 | 1,0000 | -0,1 ± 1,8 | 2,0 | 4,0 |

## Por registro

| Registro | Divisão | Ritmo | fs | Deriv. | Ref. | FP | FN | Sens. | VPP | Viés (ms) | MAE (ms) |
|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| ludb/56 | tuning | Sinus rhythm | 500 | II | 10 | 0 | 0 | 1,000 | 1,000 | -0,4 | 0,8 |
| ludb/8 | tuning | Atrial fibrillation | 500 | II | 10 | 0 | 0 | 1,000 | 1,000 | 24,8 | 25,2 |
| mitdb/100 | n/a | n/a | 360 | II | 2272 | 0 | 1 | 1,000 | 1,000 | -2,0 | 2,0 |
| ludb/2 | tuning | Sinus rhythm | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | -2,7 | 2,7 |
| ludb/3 | held-out | Sinus rhythm | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | -2,2 | 2,2 |
| ludb/4 | tuning | Sinus rhythm | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | 5,1 | 5,1 |
| ludb/5 | held-out | Sinus rhythm | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | 2,6 | 2,6 |
| ludb/7 | held-out | Sinus rhythm | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | -4,5 | 24,0 |
| ludb/9 | held-out | Sinus rhythm | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | 0,7 | 0,7 |
| ludb/10 | tuning | Sinus rhythm | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | 5,0 | 5,0 |
| ludb/11 | held-out | Sinus rhythm | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | 24,5 | 24,5 |
| ludb/1 | held-out | Sinus bradycardia | 500 | II | 6 | 0 | 0 | 1,000 | 1,000 | 2,7 | 2,7 |
| ludb/6 | tuning | Sinus bradycardia | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | -0,9 | 0,9 |
| ludb/12 | tuning | Sinus bradycardia | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | 20,0 | 20,0 |
| ludb/24 | tuning | Sinus bradycardia | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | 1,7 | 1,7 |
| ludb/27 | held-out | Sinus bradycardia | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | 0,0 | 1,1 |
| ludb/30 | tuning | Sinus bradycardia | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | 1,1 | 1,1 |
| ludb/38 | tuning | Atrial fibrillation | 500 | II | 15 | 0 | 0 | 1,000 | 1,000 | 15,3 | 18,3 |
| ludb/44 | tuning | Atrial fibrillation | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | 24,2 | 25,6 |
| ludb/51 | held-out | Atrial fibrillation | 500 | II | 8 | 1 | 0 | 1,000 | 0,889 | 49,2 | 49,2 |
| ludb/83 | held-out | Atrial fibrillation | 500 | II | 9 | 0 | 8 | 0,111 | 1,000 | 82,0 | 82,0 |
| ludb/88 | tuning | Atrial fibrillation | 500 | II | 12 | 0 | 0 | 1,000 | 1,000 | 4,3 | 4,3 |
| ludb/96 | tuning | Atrial fibrillation | 500 | II | 12 | 0 | 0 | 1,000 | 1,000 | -6,5 | 6,5 |
| ludb/22 | tuning | Sinus arrhythmia | 500 | II | 10 | 1 | 0 | 1,000 | 0,909 | 2,4 | 4,8 |
| ludb/63 | held-out | Sinus arrhythmia | 500 | II | 10 | 0 | 0 | 1,000 | 1,000 | -0,8 | 0,8 |
| ludb/99 | held-out | Sinus arrhythmia | 500 | II | 11 | 0 | 0 | 1,000 | 1,000 | -5,1 | 5,1 |
| ludb/156 | tuning | Sinus arrhythmia | 500 | II | 7 | 0 | 0 | 1,000 | 1,000 | 0,3 | 0,3 |
| ludb/34 | tuning | Sinus rhythm | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | 35,2 | 35,2 |
| ludb/45 | held-out | Sinus rhythm | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | 54,2 | 54,2 |
| ludb/74 | tuning | Sinus rhythm | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | 45,8 | 45,8 |
| ludb/70 | tuning | Sinus tachycardia | 500 | II | 12 | 0 | 0 | 1,000 | 1,000 | -0,3 | 0,3 |
| ludb/114 | tuning | Sinus tachycardia | 500 | II | 12 | 0 | 0 | 1,000 | 1,000 | 0,3 | 0,7 |
| ludb/117 | held-out | Sinus tachycardia | 500 | II | 13 | 0 | 0 | 1,000 | 1,000 | 1,5 | 1,5 |
| ludb/188 | tuning | Sinus tachycardia | 500 | II | 13 | 0 | 0 | 1,000 | 1,000 | -2,0 | 2,3 |
| ludb/93 | held-out | Atrial fibrillation | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | 57,0 | 57,0 |
| ludb/35 | held-out | Atrial flutter, typical | 500 | II | 19 | 0 | 0 | 1,000 | 1,000 | 4,4 | 4,4 |
| ludb/52 | tuning | Atrial flutter, typical | 500 | II | 9 | 0 | 0 | 1,000 | 1,000 | 0,2 | 1,1 |
| ludb/103 | held-out | Atrial flutter, typical | 500 | II | 13 | 4 | 0 | 1,000 | 0,765 | 0,6 | 2,5 |
| ludb/108 | tuning | Irregular sinus rhythm | 500 | II | 10 | 0 | 0 | 1,000 | 1,000 | 29,2 | 29,2 |
| ludb/132 | tuning | Irregular sinus rhythm | 500 | II | 8 | 0 | 0 | 1,000 | 1,000 | 3,7 | 3,7 |
