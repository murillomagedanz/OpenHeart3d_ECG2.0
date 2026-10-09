# 01 — Arquitetura e observabilidade

**Vínculo:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md), B01. **Estado:** B01 concluída em 2026-10-08; diagnóstico abaixo.

## Objetivo

Explicar de ponta a ponta qual dado entra, quais transformações ocorrem, quais eventos são produzidos e o que realmente comanda a visualização. Não implementar outro pipeline de diagnóstico com lógica divergente da produção.

## Mapa inicial a verificar

```text
Arquivo/fonte → leitura e calibração → mapeamento de derivações
  → filtros de exibição → detector (transformações internas e decisões)
  → eventos QRS → visualização / sincronização ilustrativa 3D
  → delineação P/T → marcas opcionais, sem comando do 3D
Bruto + filtrado → diferença / espectro / STFT / exportação local
```

Pontos de partida: `web/src/io/wfdb.js`, `web/src/io/fileSource.js`, `web/src/ecg/pipeline.js`, `filters.js`, `detector.js`, `waves.js` e consumidores da interface descritos no [README web](../../web/README.md). Os arquivos de pesquisa em `web/tests/qrs-*` não são módulos de produto. Localizar consumidores e contratos reais durante B01; este mapa não afirma auditoria já realizada.

## Procedimento

1. Rastrear um registro autorizado desde os bytes até gráficos/eventos/3D; repetir com fonte sintética e lacuna.
2. Registrar por estágio: entrada/saída, unidade, frequência, derivação recebida/mapeada, parâmetros efetivos, estado e tratamento de falhas.
3. Separar tempo da amostra, pico estimado, instante de emissão, disponibilidade P/T e tempo da animação; registrar atraso e convenções.
4. Inventariar instrumentação e exportações existentes; identificar o que falta antes de propor novas telas ou contratos.
5. Comparar caminho interface/lote/testes; apontar duplicações, divergências e dependências.

## Contrato de observação proposto

| Campo | Regra |
|---|---|
| Fonte e versão | Identidade pública permitida ou identificador local controlado; não exportar cabeçalhos livres |
| Estágio/configuração | Nome, versão e parâmetros efetivamente aplicados, incluindo filtros inativos |
| Coordenadas | Índices, relógio, frequência nativa, unidade e máscara de validade |
| Sinal | Distinguir bruto recebido de sinal já filtrado pelo equipamento; não prometer pré-filtro inexistente |
| Evento | Pico estimado separado do instante de decisão e sua latência |
| Falha | Motivo explícito de indisponibilidade, sem retorno com aparência de sucesso |

Qualquer exportação futura deve respeitar D14: metadados por allowlist, finalidade e minimização. Logs/amostras locais não devem conter identificadores pessoais ou chaves. “Salvar contexto” significa conservar protocolo e proveniência permitida, não divulgar dados clínicos.

## Entrega e aceite

Mapa verificado, tabela de contratos com referências a código/testes e matriz de lacunas classificadas por impacto. Cada lacuna deverá ser demonstrada por cenário reproduzível ou marcada como não aferida. Uma análise deve indicar exatamente quais amostras/configurações usou. Nenhuma alteração de limiar/filtro faz parte de B01.

## Atualização B01 — 2026-10-08

**Estado:** concluída para o escopo de arquitetura e observabilidade, sem alteração de produção. O diagnóstico, as evidências por símbolo/linha, a reprodução e a matriz R01–R08 estão em [06 — Diagnóstico de arquitetura](06-diagnostico-arquitetura.md). Foram exercitados localmente LUDB 8 e uma fonte sintética determinística pelo `SignalPipeline`; os testes Node focados passaram. A interface gráfica não foi aberta/manualmente exercitada. Integridade de escala/checksum, observabilidade de eventos/transformações e custo ainda têm lacunas; não se declara a base consolidada.

**Limites e continuidade:** B02 (inventário) permanece independente e não foi auditada aqui. B03 deve caracterizar os filtros; B04 deve medir custo e robustez; achados que exijam mudanças de comportamento/instrumentação aguardam B05. Nenhuma conclusão deste diagnóstico modifica algoritmo, parâmetros ou gates de avaliação.
