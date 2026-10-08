# Relatório do delineador de ondas P/T

Gerado por `npm run report:waves` (determinístico; um teste regenera e compara). Especificação: [SDD 001](../../../docs/specs/001-validacao-detector-e-ondas-pt.md); decisão D16 em [`docs/DECISOES.md`](../../../docs/DECISOES.md).

Tolerância de ±150 ms. LUDB: id par = ajuste (tuning), id ímpar = held-out. detected = R do detector; reference = R anotado (isola o delineador). FA/flutter não têm onda P anotada: P detectadas nesses registros contam como FP. Erro = detecção − anotação (ms). Parâmetros ajustados somente em registros pares. Estimativa visual por algoritmo, não diagnóstico.

| Escopo | Divisão | Modo | Onda | Reg. | TP | FP | FN | Sens. | VPP | Início (ms) | Pico (ms) | Fim (ms) |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|
| derivação II | tuning | detected | P | 23 | 121 | 46 | 5 | 0,960 | 0,725 | -4,1 ± 28,6 | 3,8 ± 15,6 | -3,2 ± 19,1 |
| derivação II | tuning | detected | T | 23 | 193 | 5 | 11 | 0,946 | 0,975 | 12,5 ± 50,4 | 7,1 ± 32,4 | -2,7 ± 44,0 |
| 12 derivações | tuning | detected | P | 23 | 1236 | 336 | 278 | 0,816 | 0,786 | 2,8 ± 34,0 | 6,3 ± 22,4 | 1,5 ± 24,7 |
| 12 derivações | tuning | detected | T | 23 | 2214 | 79 | 196 | 0,919 | 0,966 | 12,5 ± 47,4 | 3,3 ± 29,2 | -11,9 ± 47,3 |
| derivação II | tuning | reference | P | 23 | 122 | 46 | 4 | 0,968 | 0,726 | -3,8 ± 27,8 | 3,8 ± 15,5 | -3,3 ± 19,0 |
| derivação II | tuning | reference | T | 23 | 195 | 5 | 9 | 0,956 | 0,975 | 13,0 ± 50,2 | 7,0 ± 32,3 | -2,7 ± 43,8 |
| 12 derivações | tuning | reference | P | 23 | 1244 | 334 | 270 | 0,822 | 0,788 | 2,9 ± 33,8 | 6,3 ± 22,3 | 1,6 ± 24,7 |
| 12 derivações | tuning | reference | T | 23 | 2236 | 79 | 174 | 0,928 | 0,966 | 12,2 ± 47,0 | 2,9 ± 28,9 | -12,2 ± 47,1 |
| derivação II | held-out | detected | P | 16 | 80 | 26 | 0 | 1,000 | 0,755 | -8,6 ± 25,1 | 0,3 ± 5,6 | -5,1 ± 14,8 |
| derivação II | held-out | detected | T | 16 | 128 | 1 | 14 | 0,901 | 0,992 | 16,1 ± 52,5 | 9,8 ± 31,7 | -7,3 ± 46,8 |
| 12 derivações | held-out | detected | P | 16 | 810 | 290 | 149 | 0,845 | 0,736 | -5,8 ± 26,0 | 2,2 ± 13,3 | 1,2 ± 19,0 |
| 12 derivações | held-out | detected | T | 16 | 1523 | 17 | 179 | 0,895 | 0,989 | 10,2 ± 47,1 | 5,2 ± 31,2 | -5,3 ± 55,9 |
| derivação II | held-out | reference | P | 16 | 80 | 29 | 0 | 1,000 | 0,734 | -7,5 ± 24,1 | 0,9 ± 3,6 | -4,3 ± 12,8 |
| derivação II | held-out | reference | T | 16 | 137 | 3 | 5 | 0,965 | 0,979 | 22,7 ± 51,3 | 11,0 ± 31,1 | -8,8 ± 48,1 |
| 12 derivações | held-out | reference | P | 16 | 810 | 331 | 149 | 0,845 | 0,710 | -5,6 ± 25,8 | 2,3 ± 13,1 | 1,4 ± 18,7 |
| 12 derivações | held-out | reference | T | 16 | 1639 | 33 | 63 | 0,963 | 0,980 | 12,0 ± 45,7 | 6,0 ± 30,5 | -6,2 ± 55,0 |
| derivação II, só ritmo sinusal | tuning | detected | P | 17 | 121 | 14 | 5 | 0,960 | 0,896 | -4,1 ± 28,6 | 3,8 ± 15,6 | -3,2 ± 19,1 |
| derivação II, só ritmo sinusal | tuning | detected | T | 17 | 139 | 0 | 4 | 0,972 | 1,000 | 7,1 ± 48,1 | 4,9 ± 27,5 | -3,8 ± 37,8 |
| derivação II, só ritmo sinusal | held-out | detected | P | 11 | 80 | 6 | 0 | 1,000 | 0,930 | -8,6 ± 25,1 | 0,3 ± 5,6 | -5,1 ± 14,8 |
| derivação II, só ritmo sinusal | held-out | detected | T | 11 | 85 | 0 | 2 | 0,977 | 1,000 | 6,8 ± 44,7 | 5,4 ± 26,1 | -9,0 ± 40,2 |
