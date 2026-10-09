# SDD 002 — Consolidação da base ECG e preparação multimodal

**Data:** 2026-10-08. **Estado atual:** B01/B02 e B03 entregues; B04 Node/VM medido, navegador pendente; correções delimitadas F08, F01 e F02 entregues, B05 global e aceite B06 pendentes.

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

No fechamento do gate documental, B03/B04 ainda não haviam sido executados. A execução posterior está na seção 9. Falhas devem virar evidência, sem relaxar critérios ou modificar produção durante a medição.

## 9. Execução B03 e B04 Node/VM

**B03 entregue:** [resultados](../base/10-resultados-caracterizacao-filtros.md) e [JSON determinístico](../base/10-resultados-caracterizacao-filtros.json). Foram executados 319 casos: 270 senoides, 44 transientes/limites e cinco replays reais. Todos satisfizeram os critérios de caracterização; eventos e controles congelados permaneceram iguais. Isso demonstra consistência matemática nos ensaios escolhidos, não fidelidade clínica de todo conteúdo transformado. Inicialização sem prime automático, descrição do notch0 e lookback efetivo da derivada foram documentados, não alterados.

**B04 parcial:** [resultados Node/VM](../base/11-resultados-robustez-custo.md), [funcionais](../base/11-resultados-robustez-custo.functional.json) e [custo](../base/11-resultados-robustez-custo.cost.json). Quatro cenários passaram, dois falharam e cinco ficaram parciais. F01 expôs aceitação de prefixo truncado; F02 reproduziu continuação com checksum divergente/unidade desconhecida; F08 reproduziu relógio antigo após reset na VM. Os testes verificam a reprodução desses achados, não declaram os comportamentos seguros.

O benchmark acelerado registrou cinco repetições por configuração sintética e fases reais independentes, ambiente e memória. Não há dispositivo-alvo ou budget de produto definido; os tempos não incluem renderização real e não comprovam eficiência clínica/operacional em outros equipamentos.

O braço navegador/WebGL continua **não aferido**. BrowserOS neo foi carregado, mas seus instrumentos não estão disponíveis nesta sessão; não foi usado outro navegador como substituição silenciosa. F07–F11 exigem verificação real, incluindo o caso F08 reproduzido em VM. Sem esse braço, B04 não está globalmente concluída e B06 não pode ser aprovada.

### Prioridades para a próxima execução

1. Completar navegador/WebGL procedural com o protocolo F07–F11, sem acessar o asset privado; confirmar fronteiras de pausa/reset e comportamento visual.
2. Consolidar a lista B05 após o braço restante: integridade de carga e escala (F01/F02), relógio de reset (F08), depois clareza de metadados/instrumentação. Definir política explícita de rejeição/aviso antes de alterar comportamento de arquivos; não inventar unidade.
3. Definir dispositivo/carga-alvo e budgets antes de qualquer otimização. Taxa Node elevada não dispensa estabilidade, renderização e memória de sessão.

A validação conjunta desta entrega passou com 256 testes e benchmarks existentes; código de produção e dados não foram modificados. Autorizações de autonomia não alteram estes gates nem autorizam merge. Instrumentação, relatórios e lacunas constituem avanço persistido, não declaração de base consolidada.

## 10. Exceção delimitada: correção F08

Para não bloquear uma correção determinística já reproduzida pelo impedimento de navegador, foi executada uma exceção explícita ao gate B05, restrita ao relógio de rebuild. [Relatório e regressões](../base/12-correcao-relogio-reset.md) e [evidência atual v2](../base/12-correcao-relogio-reset.functional.json) preservam o baseline histórico 11.

`buildPipeline` agora sincroniza `state.signalTime` com a posição da fonte antes de qualquer nova amostra: arquivo reiniciado usa posição zero; mudança de notch sintético conserva a posição corrente do gerador. Testes cobrem troca pausada, reinício, EOF, continuação sintética e ausência de QRS artificial no reset. Filtros, detector e dados continuam inalterados.

F08 passa em VM, não no navegador ainda não aferido. Validação daquele corte: 259 testes e benchmarks existentes aprovados. Naquele momento não havia autorização para B05 global/B06: F01/F02, navegador e budgets permaneciam pendentes. Esta exceção não generalizou permissões para alterar política de integridade ou unidades sem definição própria.

## 11. Exceção delimitada: integridade de comprimento WFDB (F01)

Após a investigação do navegador permanecer bloqueada, foi corrigida a aceitação de prefixos de arquivo WFDB menores que a contagem declarada no cabeçalho. A regra aplica-se quando `nSamples > 0`: cada arquivo deve fornecer todas as amostras declaradas considerando seus canais compartilhados, formato e offset, ou a carga falha explicitamente. Arquivos separados não podem resultar em comprimentos de registro incompatíveis quando a contagem é inferida.

Foram preservados contagem ausente/zero (inferência por quadros completos), bytes excedentes além da contagem declarada e o armazenamento de amostra final ímpar no formato 212. Layouts incompatíveis de sinais que compartilham um arquivo e offsets além do arquivo são rejeitados. Testes exercitam os sete formatos atualmente suportados, arquivos compartilhados/separados, offsets e a retenção do estado da fonte ativa no erro de carga local/remota. Não foram alterados checksums, política para unidade desconhecida (F02), escalas, filtros, detector, dados ou experiência visual de navegador.

O relatório funcional corrente v3 foi separado da evidência histórica: [documentação F01](../base/13-integridade-comprimento-wfdb.md) e [JSON determinístico](../base/13-integridade-comprimento-wfdb.functional.json). F01 passa nos ensaios Node/VM descritos; isso não encerra B04, não trata F02 e não substitui validação real no navegador. B05 global e B06 permanecem pendentes.

## 12. Exceção delimitada: integridade e escala WFDB (F02)

Foi congelada e aplicada uma política mínima para os dados que entram no pipeline ECG: qualquer checksum explicitamente declarado que diverge do sinal decodificado rejeita o registro; checksum ausente continua opcional e é distinto de checksum inválido; unidade física declarada que o sistema não converte para mV rejeita o registro antes da criação da fonte/pipeline. A unidade WFDB ausente continua usando o padrão mV adotado pelo parser. `decodeSignals` e `verifyChecksums` continuam disponíveis para inspeção técnica explícita de arquivos, mas somente `loadRecord` retorna um registro aceito para playback normal.

Testes cobrem mismatch, checksum ausente, unidade não conversível e recusa via carregamento local e manifesto preservando fonte, pipeline e relógio ativos. [Documento F02](../base/14-integridade-calibracao-wfdb.md) e [evidência funcional corrente v4](../base/14-integridade-calibracao-wfdb.functional.json) mantêm separados os snapshots históricos. Isso detecta corrupção acidental pelo checksum WFDB; não autentica proveniência nem prova integridade criptográfica. F01/F02 passam em Node/VM, mas F02 não altera a pendência de navegador/WebGL: B04 continua parcial, B05 global e B06 não aprovadas.
