# SDD 002 — Consolidação da base ECG e preparação multimodal

**Data:** 2026-10-08. **Estado:** pacote documental, B01 e B02 entregues; caracterização, medição de custo e implementação ainda não executadas.

## 1. Objetivo e decisão

Priorizar uma base robusta, eficiente, observável e reproduzível antes de novas intervenções no detector ou inferências fisiológicas pelo coração 3D. Compreender os conceitos e medir seu comportamento no nosso pipeline, em vez de copiar algoritmos ou acrescentar recursos sem validação.

A pesquisa QRS das seções 10–20 do [SDD 001](001-validacao-detector-e-ondas-pt.md) está encerrada como etapa exploratória, não como solução do detector. Seus resultados e limites são referências de regressão. Este programa não reabre aquelas variantes, não muda os gates e não autoriza ML ou uso clínico.

## 2. Escopo e subdocumentos

| Frente | Documento de trabalho | Entrega esperada |
|---|---|---|
| Arquitetura e rastreabilidade | [01 — Arquitetura e observabilidade](../base/01-arquitetura-observabilidade.md) | Mapa verificado da cadeia, contratos e lacunas de instrumentação |
| Transformações do sinal | [02 — Caracterização dos filtros](../base/02-caracterizacao-filtros.md) | Protocolo e medidas por estágio, sem inferência automática sobre conteúdo removido |
| Base operacional | [03 — Robustez e eficiência](../base/03-robustez-eficiencia.md) | Matriz de cenários, linha de base de custo e regressões |
| ECG real e governança | [04 — Dados reais e avaliação](../base/04-dados-reais-avaliacao.md) | Inventário reconciliado, contratos de dados e reserva de avaliação |
| Imagem, ECG e modelo 3D | [05 — Multimodal e coração 3D](../base/05-multimodal-coracao-3d.md) | Requisitos de pareamento e viabilidade, antes de aquisição ou integração |

**Dentro:** diagnóstico do existente, caracterização, instrumentação necessária, robustez, eficiência mensurada, ampliação governada de dados e preparação multimodal.

**Fora desta entrega:** alteração de filtros/detector, seleção de novas hipóteses QRS, download de bases, aquisição clínica, leitura DICOM, segmentação, novos modelos 3D, diagnóstico, reconstrução elétrica individual, estimativa de força e validação clínica. Os subdocumentos são protocolos de trabalho, não certificação de capacidade existente.

## 3. Base conhecida e limites

O [README](../../README.md) descreve leitura WFDB, sinais na frequência nativa, comparação bruto/filtrado/diferença, espectro/STFT, detector QRS, P/T opcionais e coração ilustrativo sincronizado por eventos. O [pipeline compartilhado](../../web/src/ecg/pipeline.js) é usado na interface e nos testes. P/T não comandam o 3D. Cada afirmação deverá ser reconciliada com código, testes e execução no diagnóstico; documentação histórica não substitui essa conferência.

O relatório QRS congelado contém 87 LUDB + 14 MIT-BIH, 101 registros. Isso não é o inventário completo de arquivos opcionais locais, nem uma amostra clínica representativa. Registros repetidamente inspecionados são desenvolvimento/regressão para futuras hipóteses QRS; a divisão histórica de P/T deve manter seu propósito explícito.

## 4. Tarefas e dependências

| ID | Trabalho | Depende de | Critério de conclusão |
|---|---|---|---|
| B00 | Publicar este pacote documental e seus vínculos | — | Diretor, cinco subdocumentos e decisão rastreáveis |
| B01 | Auditar arquitetura, contratos e instrumentação existente | B00 | Cada estágio tem entrada, saída, unidade, relógio, estado e evidência; lacunas identificadas |
| B02 | Reconciliar manifesto, arquivos, relatórios e histórico de inspeção | B00 | Inventário separa disponível, incluído, opcional, inspecionado e reservado |
| B03 | Executar caracterização de filtros | B01 | Métodos, tolerâncias prévias e resultados sintéticos/reais por estágio publicados |
| B04 | Executar matriz de robustez e medir custo inicial | B01 | Cenários reproduzíveis e desempenho com ambiente registrado, sem limiares inventados depois |
| B05 | Priorizar e implementar correções/instrumentação necessárias | B02, B03, B04 | Mudanças vinculadas a achados, testes e comportamento preservado ou alteração explícita |
| B06 | Verificar a consolidação após as mudanças | B05 | Contratos, relatórios, sincronização e budgets acordados satisfeitos; limitações publicadas |
| B07 | Catalogar candidatos multimodais e verificar termos/pareamento | B00 | Fichas com evidência de disponibilidade, acesso e alinhamento, sem alegar base já integrada |
| B08 | Decidir um piloto multimodal delimitado | B02, B06, B07 | Variável-alvo, referência independente, contrato e protocolo definidos antes de implementação |

B02 e B07 podem ocorrer em paralelo a B01; pesquisa multimodal não bloqueia a consolidação ECG. B07 não autoriza download ou ingestão. Recursos de apresentação somente entram se servirem a um requisito verificável.

## 5. Matriz de requisitos transversais

| Requisito | Evidência exigida | Frente |
|---|---|---|
| R01 — Preservar entrada e proveniência | Identidade do arquivo/fonte, unidade, calibração, mapeamento e acesso ao bruto | 01, 04 |
| R02 — Explicar transformações | Configuração efetiva, versão, entrada/saída e convenção temporal por estágio | 01, 02 |
| R03 — Não fabricar dados | Lacunas identificadas; nenhuma interpolação ou conversão silenciosa | 01, 03, 04 |
| R04 — Reproduzir análise | Dados autorizados identificáveis, protocolo, comando e resultado versionados | Todas |
| R05 — Preservar sincronização | Relógios distintos documentados; pausa, retomada e troca testadas | 01, 03, 05 |
| R06 — Medir antes de otimizar | Ambiente, carga, métricas e orçamento fixados antes da mudança | 03 |
| R07 — Separar dados de avaliação | Histórico de uso e divisão por paciente/sessão quando disponível | 04, 05 |
| R08 — Não extrapolar o 3D | Origem e tipo da representação visíveis; variável-alvo ligada à referência apropriada | 05 |

## 6. Forma de execução e aceite

Cada tarefa terá estado, responsável, arquivos/artefatos, pergunta, pré-condições, comandos, resultado e limites. Estados: proposta, em execução, concluída, bloqueada. Resultados negativos também concluem uma tarefa quando o protocolo e o critério de parada forem cumpridos.

Primeira entrega técnica: **B01 + B02**, diagnóstico e inventário, sem modificar algoritmos. Depois congelar os protocolos de B03/B04 e seus critérios numéricos antes das medições. Prioridades: integridade/calibração/relógios, falhas e observabilidade, depois custo e experiência de análise.

Aceite da base consolidada não é um único percentual de detecção: requer rastreabilidade, falhas explícitas, reprodução, sincronização e custo mensurado. Promoção de algoritmo continua sujeita ao SDD 001 e a protocolo independente próprio. Não há declaração de conformidade regulatória.

## 7. Fundamentação e manutenção

Fontes internas: [visão do projeto](../../README.md), [decisões D1–D17](../DECISOES.md), [catálogo atual](../../web/data/README.md) e [pesquisa encerrada](001-validacao-detector-e-ondas-pt.md). A bibliografia do SDD 001 apoia o estudo QRS; não é apresentada como validação deste programa ou de pareamento imagem/ECG.

Cada futura ficha externa deve distinguir metadados, resumo e leitura integral, registrar URL/versão/data de consulta, termos de uso e o que sustenta ou não. Nesta entrega não foi realizada nova busca bibliográfica nem confirmado qualquer conjunto multimodal específico.

## 8. Entregas B01/B02 e próximo gate

**B01 concluída no escopo do diagnóstico:** [mapa e contratos auditados](../base/06-diagnostico-arquitetura.md), com rastreamento por código, relógios e matriz de lacunas. Reprodução local de LUDB 8 pelo pipeline e de fonte sintética; 158 testes direcionados aprovados. Consumidores de interface/3D foram rastreados no código, não validados manualmente em navegador/WebGL. Robustez integral e eficiência ainda não foram aferidas; a entrega não certifica consolidação completa.

**B02 concluída no escopo do inventário:** [reconciliação](../base/07-inventario-dados.md) e [snapshot por registro](../base/07-inventario-dados.json). São 106 registros no manifesto e completos localmente: 104 empacotados/rastreados e dois opcionais locais ignorados pelo Git (MIT-BIH 105/203). O relatório QRS congelado continua com 101 registros; a reprodução incluindo os dois opcionais tem 103. Os três restantes do inventário são PTB-XL, sem referência de tempos de batimento para esse escore. Conferiram 1.112 checksums WFDB de sinal; isso verifica consistência de decodificação, não verdade clínica ou cadeia criptográfica de proveniência. Nenhuma reserva independente foi declarada.

Próxima entrega: detalhar e congelar protocolos de **B03/B04**, usando as lacunas do diagnóstico para escolher ensaios e critérios antes das medições. Separar caracterização dos filtros de validação operacional da interface e de benchmark de custo. Não implementar correções B05 antes de reunir B02, B03 e B04 conforme as dependências. Nenhum filtro, limiar, detector ou comando do 3D foi alterado nesta auditoria.

### Protocolos definidos, execução pendente

Em 2026-10-08 foram congelados [B03 v1](../base/08-protocolo-caracterizacao-filtros.md) e [B04 v1](../base/09-protocolo-robustez-custo.md). B03 fixa grade/fs, estimador ganho/fase, fórmulas, tolerâncias numéricas, transientes e janelas reais descritivas. B04 fixa matriz funcional, braços Node/VM/navegador e método de custo/estabilidade; budgets de produto dependem de dispositivo-alvo e não foram inventados.

Este gate documental está entregue; **B03/B04 ainda não executados**. Próxima tarefa concreta: implementar e executar o braço Node de B03 conforme protocolo, depois B04 em braços distintos. Falhas devem virar evidência, sem relaxar critérios ou modificar produção durante a medição.
