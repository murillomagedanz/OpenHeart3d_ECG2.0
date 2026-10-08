# OpenHeart3D ECG 2.0

**Visão:** transformar o ECG em uma plataforma aberta de visualização e pesquisa de sinais cardíacos. A proposta é apresentar, em tempo real, as derivações do ECG de um paciente ao lado de um coração 3D sincronizado aos eventos elétricos observados, preservando os dados brutos para investigar informações que o processamento convencional pode atenuar ou descartar.

**Idealizador:** Eng. Murillo Magedanz. **Estágio:** protótipo web de pesquisa (ver "Estado atual"); ainda não há modelo treinado, dispositivo integrado ou validação clínica neste repositório.

## O que queremos construir

- **Aquisição e visualização:** receber sinais multiderivação de um equipamento ou de um conjunto de dados de pesquisa; exibir as 12 derivações convencionais (I, II, III, aVR, aVL, aVF, V1–V6), com escala, velocidade, frequência de amostragem e qualidade do sinal identificáveis. Em alguns equipamentos, C1–C6 designam as posições precordiais correspondentes a V1–V6; a nomenclatura recebida deve ser preservada e mapeada explicitamente.
- **Coração 3D sincronizado:** animar um modelo didático com base em eventos detectados no ECG, permitindo explorar diferentes representações. A animação inicial indica **sincronização temporal com a atividade elétrica**, não a contração, a anatomia ou a força reais daquele paciente.
- **Pesquisa sobre o sinal:** conservar o sinal bruto e registrar cada transformação (filtros, parâmetros e versões), permitindo comparar bruto, filtrado e diferença entre ambos. Investigar ruído, artefatos e componentes possivelmente relevantes sem presumir que tudo o que foi removido é informação cardíaca.

## Limites científicos e de segurança

O ECG mede diferenças de potencial elétrico na superfície corporal; não mede diretamente força de contração, fluxo sanguíneo ou movimento tridimensional. Inferir propriedades mecânicas ou mapas elétricos internos a partir dele é um problema inverso com soluções não únicas, dependente de hipóteses e, em certos métodos, de geometria torácica, posição dos eletrodos e dados complementares. Uma animação baseada apenas no ECG **não deve ser apresentada como reconstrução anatômica individual**.

Fourier, análise tempo-frequência e outras decomposições descrevem componentes matemáticos, mas não separam automaticamente fontes fisiológicas de ruído. Se um filtro descarta componentes, a análise comparativa exige acesso ao sinal **antes** da filtragem; não é possível reconstruí-los de forma confiável a partir de um arquivo que contém apenas o ECG já filtrado. Hipóteses sobre marcadores novos ou força cardíaca exigem medidas independentes (por exemplo, ecocardiografia, ressonância ou medidas hemodinâmicas apropriadas), controle de confundidores e validação externa.

O projeto é de **pesquisa e educação**, não de diagnóstico, monitoramento clínico ou orientação terapêutica. Qualquer uso médico futuro depende de avaliação clínica, requisitos regulatórios e gestão de risco aplicáveis. Dados de pacientes requerem autorização, governança ética, desidentificação, controle de acesso e conformidade com a LGPD e demais normas aplicáveis.

## Fluxo técnico proposto

```text
ECG real ou conjunto de dados autorizado
  -> aquisição com timestamps, derivações, unidade e calibração
  -> armazenamento imutável do sinal bruto e metadados
  -> análise de qualidade e processamento versionado
  -> visualização das derivações + animação 3D sincronizada
  -> análise reprodutível do sinal bruto e das transformações
```

As derivações são sinais relacionados, não 12 medições independentes. O sistema deve manter a proveniência do dispositivo, o mapeamento de eletrodos, a frequência de amostragem e os parâmetros de filtragem, além de distinguir perdas na aquisição de alterações introduzidas pelo software. Dados sintéticos ou públicos podem demonstrar a interface; dados clínicos só entram após autorização e definição de governança.

## Roteiro técnico-científico

| Etapa | Entrega verificável | Critério para avançar |
| --- | --- | --- |
| 1. Fundamentos e dados | Especificação de formatos, metadados, aquisição e governança; seleção de ECGs de pesquisa com licença e proveniência claras. | Um registro de teste permite reproduzir os sinais brutos e identificar unidades, derivações, timestamps e transformações aplicadas. |
| 2. Protótipo visual | Gráficos multiderivação e coração 3D didático sincronizado a eventos detectados, com indicação explícita de dados simulados ou reais. | Reprodução consistente de um registro de teste; eventos e derivações permanecem sincronizados mesmo com pausa e mudança de velocidade. |
| 3. Pipeline de sinais | Painel de espectro, métricas de conteúdo em bandas dos filtros e espectrogramas STFT para bruto, filtrado e diferença, sobre a mesma janela válida de 10 s e fs nativa na derivação de ritmo. | Frequências sintéticas e efeito dos filtros verificáveis; STFT localiza conteúdo que muda no tempo; registros reais reproduzíveis; parâmetros explícitos; lacunas não imputadas; descrições sem inferência clínica. |
| 5. Coração anatômico ilustrativo | Modelo opcional cifrado, vistas, camadas, raio-X e corte. | Preservar o modelo procedural sem chave e a sincronização temporal pelo ECG; indicar explicitamente que a representação é ilustrativa. |

A antiga etapa 4 (pesquisa e ML) está congelada e fora do roteiro ativo, sem implementação ou prazo previsto. A numeração original foi mantida para preservar as referências existentes. Os PRs #1 (protótipo) e #2 (representação anatômica) foram integrados; o PR #3 conclui o escopo ativo da etapa 3.

Para os primeiros experimentos, priorizar métricas de detecção e qualidade do sinal; uma hipótese sobre força ou outra variável mecânica só deve ser testada quando houver definição operacional da variável-alvo e referência clínica pareada. Divulgar resultados negativos e limitações é parte do compromisso científico do projeto.

## Estado atual

- **Etapa 1 (parcial)** — leitor WFDB próprio com verificação de checksum, manifesto de proveniência/licença ([`web/data/`](web/data/README.md)) e registros públicos do PhysioNet (MIT-BIH, PTB-XL, LUDB) reproduzidos na frequência nativa, sem reamostragem.
- **Etapa 2 entregue (PR #1)** — [`web/`](web/README.md): protótipo estático com 12 derivações (sintéticas ou reais), filtragem auditável (bruto / filtrado / diferença), detector de QRS em tempo real e coração 3D comandado pelos eventos detectados. Benchmarks reprodutíveis (`npm test`): sintético e dados reais anotados (7842 batimentos: sens 0,989 / VPP 0,982).
- **Representação anatômica entregue (PR #2, escopo da etapa 5)** — câmera travada no eixo central com vistas predefinidas, camadas por parte, raio-X e plano de corte (filtros de exibição, não medidas); modelo anatômico ilustrativo opcional, de licença não redistribuível, guardado **cifrado** no repositório com a chave fora dele — sem a chave, o modelo procedural segue como padrão. Os clipes do modelo têm o tempo posicionado pelo ECG, mantendo o princípio "o sinal comanda o modelo". Integrações de aquisição e estudos prospectivos não fazem parte desta entrega.
- **Validação e ondas P/T (PRs #6 e seguinte)** — 39 registros LUDB + MIT-BIH 100 com relatório determinístico (`npm run report`, divisão ajuste/held-out) e delineação de P/T estimada por algoritmo, pontuada contra o LUDB (`npm run report:waves`); marcas opcionais só na tira de ritmo, sem influir no 3D. Ver [SDD 001](docs/specs/001-validacao-detector-e-ondas-pt.md), D15 e D16.
- **Etapa 3 (PR #3)** — painel espectral completo para bruto, filtrado e diferença na derivação de ritmo e janela móvel comum de 10 s válidos: espectro unilateral de amplitude Hann, medidas de pico abaixo do corte passa-alta e na faixa nominal do notch, além de espectrograma STFT (quadros de 2 s, avanço de 1 s). O painel informa fs, filtros, resolução, quadro e avanço; não calcula quando a janela está incompleta ou tem lacuna, congela em pausa e reinicia na troca/fim da fonte. Não reamostra nem imputa. Indicadores são descrições do conteúdo por frequência, sem classificar artefatos ou formular conclusões clínicas.
- Decisões técnicas e científicas registradas em [`docs/DECISOES.md`](docs/DECISOES.md).

## Código aberto e colaboração

O objetivo é publicar software, protocolos e resultados reprodutíveis sem divulgar dados sensíveis. O código da edição comunitária (CE) é licenciado sob **GNU AGPL-3.0** ([LICENSE](LICENSE); decisão D17); recursos de edições futuras podem ter licença comercial distinta. **Contribuições externas só serão aceitas após o acordo de contribuição ([`CLA.md`](CLA.md), hoje rascunho; ver [`CONTRIBUTING.md`](CONTRIBUTING.md))**, necessário para manter a licença comercial alternativa. A licença do código não cobre os dados nem o modelo anatômico opcional: cada conjunto de dados terá de respeitar sua própria licença e termos de uso. Este README descreve a direção do projeto; o que já existe está listado em "Estado atual".
