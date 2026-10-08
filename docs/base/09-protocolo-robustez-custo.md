# 09 — Protocolo B04: robustez, sincronização e custo

**Data:** 2026-10-08. **Estado:** protocolo v1 congelado; execução e budgets de produto pendentes.
**Vínculos:** [diretor](../specs/002-consolidacao-base-ecg-3d.md), [fundamento](03-robustez-eficiencia.md), [diagnóstico B01](06-diagnostico-arquitetura.md).

## 1. Objetivo e separação dos braços

Verificar contratos operacionais e estabelecer custo inicial, sem otimizar ou alterar algoritmos. Separar **Node**, **integração em VM** e **navegador/WebGL real**. Um braço não substitui outro; ausência de navegador resulta em item bloqueado/não aferido, nunca aprovação.

## 2. Matriz funcional congelada

| ID | Caso | Referência e critério |
|---|---|---|
| F01 | Arquivo válido, truncado, arquivo requerido ausente | Fixtures autorizadas; carga válida conforme contrato, demais com erro ou comportamento atual explicitamente reproduzido |
| F02 | Checksum divergente, unidade desconhecida | Reproduzir aviso/flags e continuação atuais; classificar como lacuna de integridade/escala, não aprovação por ausência de crash |
| F03 | II ausente e canal não reconhecido | Mapeamento/detectionLead disponíveis e fallback explícitos; não chamar zero de medição |
| F04 | Lacuna II [15,18) s em sintético40 s; retomada com e sem DC+1,5 mV | Máscara preservada; sem decisões durante lacuna, sem falso evento nos primeiros300 ms da retomada; RR não atravessa lacuna |
| F05 | Lacuna apenas em outra derivação | II válida continua; vão no canal afetado, estado desse canal respeitado |
| F06 | Passo-a-passo/lote | Mesma fonte materializada e configuração: eventos iguais, mesma validade; precisão das saídas conforme dtype |
| F07 | Pausa2 s e retomada; velocidades0,5×/1×/2× | Após pausa admitida, índice/relógio/análise não avançam; velocidade altera cadência, não fs nem ordem dos eventos |
| F08 | Troca entre sintético/LUDB8/MIT100; reinício e notch50/60/0 | Histórico anterior não aparece no novo contexto; reset conforme contrato específico de fonte |
| F09 | P/T, janela espectral e exportação | Sem T final fabricada; gap invalida janela; só10 s válidos habilitam análise; metadados allowlisted |
| F10 | Procedural e asset opcional ausente | Caminho procedural funciona, caráter ilustrativo visível; P/T não comandam3D |
| F11 |100 trocas/reinícios e30 min de reprodução | Recursos com ciclo de vida registrado; nenhuma série obsoleta/sobreposição de fontes |

Fixtures de falha são cópias em memória; nunca corromper arquivos originais. Conferir código e testes existentes antes de adicionar casos. Qualquer comportamento divergente do esperado deve ser registrado com reprodução mínima para B05, não corrigido silenciosamente na medição.

## 3. Braço navegador

Usar servidor local do projeto e navegador real; registrar browser/versão, viewport, hardware, fonte e configuração. Não divulgar chave ou conteúdo privado do asset. Procedural é obrigatório; modelo opcional com chave não disponível é **não aferido**, sem tentar contornar acesso.

Observar índice/tempo do sinal, contador/eventos, gráfico, P/T, espectro e envelope3D. Para pausa, descontar somente callback já em execução antes da ação e registrar fronteira de admissão; não tolerar avanço contínuo. Para sincronização, distinguir pico estimado, emissão, estado visual e frame de apresentação.

Critério funcional: estado do3D recebe o mesmo relógio do sinal e eventos na mesma ordem; pico não é confundido com início mecânico real. Quantificar atraso de apresentação quando instrumento disponível, mas não fixar “um frame” como garantia em todas as velocidades/dispositivos. Exportar só dados públicos/permitidos. Capturas não substituem medida de relógios.

## 4. Benchmark inicial, sem aprovação de eficiência

Ambiente escolhido: máquina local disponível; registrar CPU, memória total, OS, runtime, navegador e versão/commit, sem caminhos/identificadores pessoais. **Nenhum dispositivo-alvo de produto foi definido.**

Cargas Node: sintético seeded20261008, **12 derivações, fs360/500 Hz, duração30 min**, configuração PA0,5/notch50 ou60; corpus real LUDB8/MIT100 separadamente. Materializar entrada fora do trecho cronometrado quando medir processamento; decodificação medida em fase própria. Nenhuma busca de rede.

Medir por fase: leitura/decodificação, filtros+QRS, P/T, espectro/STFT e serialização. Evitar que soma de timings isolados seja chamada custo total integrado. Primeiro medir pipeline atual sem instrumentação detalhada, depois instrumentado para identificar overhead. Não usar `filterAll` com acúmulo de registro inteiro como proxy de memória streaming.

Executar **uma repetição de aquecimento e cinco medidas**, publicando todas, mediana e faixa. Throughput em amostras/canal e segundos de sinal por segundo de processamento; tempo por blocos fixos1 s com p50/p95/máximo. Para amostras/canal explicitar se denominador conta os12 canais ou somente II.

Memória: amostrar heap/RSS no início, a cada60 s de sinal e no fim, distinguindo arrays externos; repetir fluxo vs lote e100 resets. Não atribuir crescimento a leak sem controlar GC/entrada/artefatos; sem forçar GC no resultado primário. Se executar diagnóstico com GC explícito, é braço secundário identificado.

No navegador, cargas1×/2× com ECG/spectrum/3D procedural; medir duração e frames por30 s de parede, intervalos de frame p50/p95 e long tasks quando disponíveis. Registrar refresh rate observado, aba em foreground, warmup10 s e três repetições.30 min e100 trocas servem à análise de estabilidade, não só FPS.

**Não há budgets numéricos de produto aprovados.** Estas medidas estabelecem baseline; antes de B05 de desempenho, escolher dispositivo/carga-alvo e congelar budgets. Taxa média maior que tempo real não prova responsividade, ausência de picos, bateria ou desempenho em outros equipamentos.

## 5. Entrega e critério de fechamento

Resultados funcionais por ID: aprovado, falhou, bloqueado ou não aferido, com evidência e limite. Benchmark em artefato próprio com ambiente/repetições; não inserir tempos variáveis em relatório científico determinístico.

Reusar comandos existentes em `web`:

```powershell
node --test tests\wfdb.test.mjs tests\gaps.test.mjs tests\source-controls.test.mjs tests\spectrum-export.test.mjs
npm test
```

Runner de custo/automação adicional ainda não implementado; nomes e comandos definitivos serão registrados quando criados, sem instalar ferramentas por conveniência.

B04 diagnóstico pode concluir com falhas/bloqueios documentados, mas esses itens impedem declarar B06 consolidada. B05 só começa após evidência B02/B03/B04 e priorização: integridade e escala, continuidade/relógios, observabilidade, custo. Esta tarefa não autoriza novos downloads, correções em produção, mudanças de detector ou inferência clínica.
