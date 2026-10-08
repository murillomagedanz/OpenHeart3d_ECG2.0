# 03 — Robustez, sincronização e eficiência

**Vínculo:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md), B04–B06. **Estado:** matriz inicial; custos e budgets ainda não aferidos.

O [protocolo B04 v1](09-protocolo-robustez-custo.md) fixa cenários funcionais e método de benchmark antes da execução. Budgets de produto ainda pendentes; estabelecer baseline não equivale a aprovar eficiência.

## Objetivo

Consolidar o comportamento existente com falhas explícitas e recursos mensurados. Não chamar a base de eficiente apenas porque testes passam ou porque o banco de templates é limitado.

## Matriz mínima de cenários

| Área | Cenários | Resultado esperado |
|---|---|---|
| Entrada | Arquivo válido, truncado, checksum inválido, unidade desconhecida, canal ausente | Contrato e erro explícitos; não trocar unidade/derivação silenciosamente |
| Continuidade | Lacuna em derivação de detecção/outra, início/fim incompleto | Máscaras preservadas, reset conforme contrato, sem amostras inventadas |
| Reprodução | Pausa/retomada, velocidade, reinício e troca de fonte | Relógio do sinal coerente; sem eventos antigos no novo fluxo |
| Interface/3D | QRS atrasado, RR irregular, fonte real/sintética, asset indisponível | Fonte e caráter ilustrativo claros; sem inferência mecânica |
| P/T e análise | Disponibilidade atrasada, janela insuficiente, lacuna | Não apresentar estimativa antiga como atual; P/T fora do comando 3D |
| Ciclo de vida | Sessão longa e trocas repetidas | Recursos liberados; histórico/caches segundo limites declarados |

O diagnóstico deve associar cada cenário a teste existente, teste faltante ou verificação manual reproduzível. Não presumir ausência de erro só por não haver falha no corpus atual.

## Medição de custo

Separar decodificação, processamento por amostra, delineação, análise espectral, renderização ECG/3D e exportação. Registrar versão do código, Node/navegador, sistema, hardware, carga, fs, derivações, duração, velocidade, aquecimento e repetições.

Medir tempo de processamento (distribuição, não só média), uso de memória ao longo da sessão, responsividade e atraso entre sinal/evento/exibição. Distinguir latência algorítmica de atraso de agendamento/renderização. Medições temporais variáveis ficam em relatório de benchmark próprio, não em JSON científico que promete identidade byte-a-byte.

Antes de otimizar, fixar budgets em função do dispositivo-alvo e da carga escolhida. Valores ainda não definidos são **pendentes**, não critérios aprovados. Comparar antes/depois no mesmo ambiente e assegurar ausência de regressão funcional; evitar mudanças sem gargalo medido.

## Validação e aceite

Reusar `npm test`, relatórios e benchmarks atuais; verificar comandos configurados em `web/package.json` no início da tarefa. Acrescentar testes direcionados às lacunas reais, sem nova ferramenta por conveniência. Testes de interface e sincronização deverão observar resultados, não apenas execução sem erro.

B06 exige matriz com evidência, orçamentos acordados satisfeitos ou desvios documentados, reprodução consistente e contratos preservados. Desempenho em um equipamento não representa garantia em todos os dispositivos, nem prontidão clínica.
