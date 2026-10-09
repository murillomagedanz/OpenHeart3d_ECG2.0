# 05 — Dados multimodais e evolução do coração 3D

**Vínculo:** [SDD 002](../specs/002-consolidacao-base-ecg-3d.md), B07/B08. **Estado:** requisitos e triagem futuros; nenhuma base pareada confirmada ou integrada nesta entrega.

## Objetivo e níveis de representação

Separar quatro capacidades: coração ilustrativo, anatomia individual derivada de imagem, sincronização temporal e simulação fisiológica. Progresso em uma não comprova as outras.

| Pergunta | Referência potencial | O que não fornece automaticamente |
|---|---|---|
| Geometria individual | CT/ressonância com qualidade e segmentação verificadas | Ativação elétrica, movimento ou força |
| Movimento ao longo do ciclo | Ressonância cine, eco ou aquisição CT multifásica apropriada | Relação unívoca entre ECG e mecânica |
| Sincronização sinal/imagem | ECG/trigger disponível e relógios documentados | Onda ECG completa ou simultaneidade de exames separados |
| Ativação elétrica interna | Medidas eletrofisiológicas adequadas e geometria/posições necessárias | Reconstrução única a partir de ECG de superfície isolado |
| Força/hemodinâmica | Medida independente adequada à variável definida | Força real inferida apenas pela animação/ECG |

Essas são exigências conceituais de seleção, não afirmações de disponibilidade de datasets. O modelo atual continua ilustrativo e comandado temporalmente por eventos; P/T não o alimentam.

## Ficha de triagem multimodal

Verificar sujeito e sessão pareados, modalidade, protocolo de aquisição, fases/frames, resolução/unidades espaciais, orientação, qualidade, segmentação e sua proveniência. Para ECG, exigir fs, derivações, calibração, waveform ou somente triggers, pré-processamento e máscara de validade.

Registrar origem dos relógios, offsets, jitter/resolução, convenção R/trigger, gating prospectivo/retrospectivo e fases reconstruídas. “ECG-gated” não demonstra waveform acessível nem correspondência amostra-a-frame. Exames do mesmo paciente em dias diferentes são pareados por sujeito, não necessariamente sincronizados.

Checar licença de cada modalidade/anotação/modelo, acesso, redistribuição e privacidade. DICOM/cabeçalhos/imagens podem carregar identificadores e metadados sensíveis; desidentificação exige procedimento específico e verificação, não apenas renomear arquivos. Não transferir material protegido ou clínico para serviços externos.

## Procedimento e entregas

1. Definir uma variável-alvo delimitada: por exemplo, visualização de geometria com sincronização documentada, sem inferir força.
2. Levantar candidatos e registrar URLs, versões, evidência consultada e requisitos não atendidos.
3. Confirmar separadamente waveform, pareamento, sincronização e direitos antes de decidir aquisição.
4. Descrever contrato coordenadas/relógios e teste de erro de alinhamento antes de integrar.
5. Propor piloto pequeno, comparador independente, falhas/critério de parada e custo; manter bases isoladas para testar módulos.

B07 conclui com fichas verificadas, incluindo candidatos inadequados e razões. B08 só começa após base ECG consolidada e governança definida. Não pressupor leitor DICOM, segmentação ou modelo personalizado implementados.

## Limites e aceite futuro

Uma integração deve rotular origem e nível da representação, distinguir frames adquiridos/reconstruídos/interpolados e hipóteses da simulação. Registrar erro de sincronização e incerteza de geometria; thresholds serão definidos para a pergunta antes da execução. ECG de superfície é um problema inverso não único: uma visualização plausível não demonstra fidelidade elétrica ou mecânica individual.

A literatura e os dados apoiarão um modelo adaptado ao projeto, não cópia sem compreensão. Regras fisiológicas novas exigem estudo e validação próprios; a trilha multimodal não reabre automaticamente a pesquisa QRS encerrada.
