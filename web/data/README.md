# Registros de ECG reais (PhysioNet)

Os arquivos em `records/<banco>/` são cópias **inalteradas** de registros públicos do [PhysioNet](https://physionet.org/), no formato WFDB original (`.hea` cabeçalho texto, `.dat` sinais binários, `.atr`/`.ii` anotações). Nada aqui foi filtrado, reamostrado ou editado: o leitor (`src/io/wfdb.js`) decodifica os arquivos na hora e confere o checksum de 16 bits que o próprio cabeçalho traz.

`manifest.json` lista os registros, a proveniência, a licença e os **rótulos fornecidos pelo banco** (diagnósticos, idade, sexo, laudo). Esses rótulos são exibidos na interface *como vieram do banco* — nunca são inferências deste software.

## Bancos usados

| Banco | Versão | Conteúdo | Licença | Rede |
|---|---|---|---|---|
| [MIT-BIH Arrhythmia Database](https://physionet.org/content/mitdb/1.0.0/) | 1.0.0 | 48 registros de 30 min, 2 derivações (MLII + V1/V2/V5), 360 Hz, **batimentos anotados por cardiologistas** | ODC-BY 1.0 | 60 Hz |
| [PTB-XL](https://physionet.org/content/ptb-xl/1.0.3/) | 1.0.3 | 21 799 ECGs de 12 derivações, 10 s, 500 Hz, com diagnósticos SCP-ECG e laudo | CC BY 4.0 | 50 Hz |
| [LUDB](https://physionet.org/content/ludb/1.0.1/) | 1.0.1 | 200 ECGs de 12 derivações, 10 s, 500 Hz, com **limites e picos de P, QRS e T anotados por derivação** | ODC-BY 1.0 | 50 Hz |

## Registros incluídos no repositório (~2,6 MB)

| Registro | Por quê |
|---|---|
| `ptb-xl/00003_hr` | ECG normal, ritmo sinusal — referência visual de 12 derivações |
| `ptb-xl/08215_hr` | Fibrilação atrial — RR irregular; expõe o limite da "contração atrial estimada pelo RR" |
| `ptb-xl/00286_hr` | Bloqueio completo de ramo esquerdo — QRS largo, fora da morfologia do gerador sintético |
| `ludb/56` | Ritmo sinusal sem alterações, com anotações P/QRS/T |
| `ludb/8` | Fibrilação atrial, QRS predominantemente negativo em II (caso que revelou o viés de marcação do R) |
| `mitdb/100` | Registro clássico de validação de detectores: 2273 batimentos anotados em 30 min |

Registros adicionais listados no manifesto mas **não incluídos** (ex.: `mitdb/105`, `mitdb/203`, casos difíceis) são baixados com:

```powershell
cd web
npm run fetch-data                    # tudo que estiver no manifesto e faltar
npm run fetch-data -- mitdb/208       # adiciona um registro novo ao manifesto e baixa
npm run fetch-data -- ptb-xl/4117     # PTB-XL por ecg_id (usa records500/*_hr)
npm run fetch-data -- ludb/70
```

O PhysioNet não envia cabeçalhos CORS, então o navegador não consegue buscar os arquivos diretamente de lá: eles precisam estar nesta pasta (servidos junto com a página) ou ser abertos pelo seletor de arquivos da interface.

## Como as anotações são usadas

- **MIT-BIH `.atr`**: anotações de batimento (`N`, `A`, `V`, …) marcam o pico do QRS. Usadas como referência para pontuar o detector (janela ±150 ms, ANSI/AAMI EC57). Anotações que não são batimentos (`+` ritmo, `~` ruído, `"` comentário, `!` onda de flutter) são ignoradas na pontuação; `?` (batimento não classificado no período de aprendizado) conta como batimento, como em `isqrs()` da biblioteca WFDB.
- **LUDB `.ii`** (e um arquivo por derivação): `(` início, `p`/`N`/`t` pico, `)` fim de cada onda. O pico `N` é usado como referência de QRS; `p` e `t` ficam disponíveis para a futura detecção de P e T. O LUDB não anota o ciclo incompleto no fim do registro, por isso detecções após o último batimento anotado não entram no escore.
- **PTB-XL**: sem anotações de batimento; serve para visualização de 12 derivações e para os rótulos diagnósticos do banco.

## Citações

Ao usar estes dados, cite o banco e o PhysioNet:

- Moody GB, Mark RG. *The impact of the MIT-BIH Arrhythmia Database.* IEEE Eng Med Biol Mag. 2001;20(3):45-50. doi:10.1109/51.932724
- Wagner P, Strodthoff N, Bousseljot R-D, et al. *PTB-XL, a large publicly available electrocardiography dataset.* Sci Data. 2020;7:154. doi:10.1038/s41597-020-0495-6
- Kalyakulina AI, Yusipov II, Moskalenko VA, et al. *LUDB: A New Open-Access Validation Tool for Electrocardiogram Delineation Algorithms.* IEEE Access. 2020;8:186181-186190. doi:10.1109/ACCESS.2020.3029211
- Goldberger AL, Amaral LAN, Glass L, et al. *PhysioBank, PhysioToolkit, and PhysioNet: Components of a New Research Resource for Complex Physiologic Signals.* Circulation. 2000;101(23):e215-e220.

As licenças ODC-BY 1.0 e CC BY 4.0 permitem redistribuição com atribuição; os registros acima são redistribuídos sem alteração, com atribuição neste arquivo e no `manifest.json`.
