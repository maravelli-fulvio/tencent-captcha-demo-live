# Guia PoC — alinhamento com checklist do cliente

Este repositório cobre **parte** do que um editalCostuma pedir para CAPTCHA Tencent. Use a tabela abaixo para separar **o que o demo entrega**, **o que é Console Tencent**, e **o que é documentação oficial**.

## Demo público (este projeto)

**URL atual:** https://tencent-captcha-demo-live.onrender.com/

| Item típico do edital | O que fazemos aqui |
|-----------------------|---------------------|
| Web + fluxo captcha | Página + widget + envio ao backend |
| Validação de ticket no backend | `POST /api/verify-captcha` → `DescribeCaptchaResult` |
| Medição de latência (frontend / backend / total) | Cards na página + `backendLatencyMs` no JSON |
| CURL para auditoria | Log técnico gera comando `curl` após cada ticket |
| Benchmark agregado | `GET /api/benchmark?samples=10` (modo real) |

**Este demo não substitui:** SLA jurídico, LGPD (políticas), app mobile nativo, nem observabilidade completa dentro da Tencent — veja secções seguintes.

## Console Tencent CAPTCHA (hands-on na reunião)

Abra **CAPTCHA → app (ex.: TJBA) → Integration / Configuration / View statistics**:

- **Modo invisível / tipo de widget:** Configuration (ex.: Widget type *Invisible*)
- **Chave/AppId:** Integration (CaptchaAppId, script)
- **Estatísticas do produto (volume, passe/bloqueio):** *View Statistics* — agrega **carga do widget**, **pedidos de verificação**, **verify tickets no backend**

Se *View Statistics* mostrar **tudo zero** enquanto o site funciona, confira: faixa de **tempo**, **granularidade**, se está no **console correto** (internacional vs China), se o **AppId** monitorado é o mesmo do demo (`189927023` no seu caso de referência).

## Logs: CLS versus estatísticas do CAPTCHA versus seu backend

### 1) *View Statistics* (produto CAPTCHA)

É o lugar **nativo** para o cliente ver **tráfego e resultado** (loads, verificações, validações de ticket). **Não** é log linha a linha nem latência por requisição.

### 2) Cloud Log Service (CLS)

CLS indexa **tópicos de log** (CLB, TKE, COS, EdgeOne, etc.). **Não existe** um botão único “mandar todo o CAPTCHA para o meu topic automaticamente” na maioria dos cenários PoC.

**Quando CLS faz sentido para o edital:**

- Você roda **carga na Tencent** (CVM, TKE, CLB) e envia **access logs** ou logs de app para um **Logset/Topic** — aí o dashboard CLS (como o seu print “Create dashboard”) consome esses tópicos.
- Ou você usa **API / Cloud Monitor** da conta + exportações, conforme produto.

**Render (PaaS fora da Tencent):** os logs ficam no **Render → Logs**. Para **CLS**, seria preciso um **encaminhador** (ex.: agente, função, ou pipeline terceiro) — fora do escopo mínimo deste repositório.

### 3) Log estruturado neste backend (opcional)

Com `POC_STRUCTURED_LOG=true` no ambiente, cada validação escreve **uma linha JSON** no stdout (sem `ticket`/`randstr`/IP), por exemplo:

`event=captcha_verify_result`, `ok`, `backendLatencyMs`, `captchaAppId`, etc.

Útil para: **Render log stream**, futuro encaminhamento para SIEM/CLS, ou evidência de “API + rastreabilidade” na PoC.

## Latência backend ainda alta (~1s+)

O código já usa keep-alive e timeout; o gargalo típico é **RTT** entre **região do Render** (ex. EUA) e **`captcha.intl.tencentcloudapi.com`**, mais cold start do plano free.

**Caminhos para se aproximar do alvo &lt;150 ms (desenho, não só código):**

1. Hospedar o validador **mais perto** do endpoint (ex. **Singapura / Hong Kong** na Tencent ou outro provedor na mesma região).
2. Plano com instância **sempre quente** (menos cold start).
3. Na apresentação ao cliente, **declarar o que está sendo medido** (server-to-server na mesma região vs caminho atual).

## Mapeamento rápido: 15 linhas do edital

| Área | Evidência principal |
|------|---------------------|
| Latência backend | Demo + `curl` + `backendLatencyMs`; alinhar região em produção |
| Disponibilidade 99,9% | **Doc/SLA Tencent** (não simulável em 1 h) |
| Modo invisível | **Console** + demo |
| Acessibilidade | Console + doc Tencent + comportamento do widget |
| Níveis / score | **Console** + cenários |
| Localização | Browser / parâmetros SDK |
| Web + mobile | Web = demo; mobile = **SDK + doc** (ou app separado) |
| Chave por domínio | **Dois domínios/apps** no Console |
| Alcance global | **Doc** arquitetura/regiões |
| LGPD | **Política + jurídico** |
| Alertas | **Console** (se disponível no produto/conta) |
| API / logs | API ref Tencent + logs app (`POC_STRUCTURED_LOG`) + Statistics |
| Monitoramento | Statistics / Cloud Monitor / status (conforme conta) |
| Console admin | **View Statistics** + telas de app |
| Suporte | **Plano + presença** na PoC |

## Commit sugerido

Inclua este `docs/poc-guia.md`, variável `POC_STRUCTURED_LOG` no `.env.example`, e alterações em `server.js` / `README.md`.
