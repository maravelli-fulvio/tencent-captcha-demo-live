# Tencent CAPTCHA Demo (Live Domain)

Projeto paralelo ao localhost, pronto para publicar em domínio real.

## Objetivo

- Manter o ambiente local (`tencent-captcha-demo`) intacto
- Publicar este projeto (`tencent-captcha-demo-live`) em URL pública
- Usar domínio real para PoC executiva

## Arquitetura

1. Usuário acessa página em domínio público
2. Frontend abre Tencent CAPTCHA e recebe `ticket/randstr`
3. Frontend envia para `/api/verify-captcha`
4. Backend assina requisição `TC3-HMAC-SHA256` e valida com Tencent
5. Backend retorna `ok/reprovado`

## Variáveis obrigatórias

```env
PORT=3000
DEMO_MODE=false
TENCENT_SECRET_ID=seu_secret_id
TENCENT_CAPTCHA_APP_ID=seu_app_id
TENCENT_CAPTCHA_APP_SECRET_KEY=seu_app_secret_key
TENCENT_CAPTCHA_ENDPOINT=captcha.intl.tencentcloudapi.com
```

## Deploy rápido (Render)

1. Suba a pasta `tencent-captcha-demo-live` para um repositório Git.
2. No Render, crie `New + > Blueprint`.
3. Aponte para o repositório com `render.yaml`.
4. Preencha os secrets:
   - `TENCENT_SECRET_ID`
   - `TENCENT_CAPTCHA_APP_ID`
   - `TENCENT_CAPTCHA_APP_SECRET_KEY`
5. Deploy.

Healthcheck:

- `GET /healthz` deve retornar `{"ok": true, ...}`.

## Domínio real

No provedor de DNS, crie:

- `CNAME` de `captcha.seudominio.com` para o domínio gerado no Render.

Depois, no Render:

- Add Custom Domain: `captcha.seudominio.com`
- Aguarde emissão de SSL.

## Teste de produção

1. Acesse `https://captcha.seudominio.com`
2. Clique em `Executar CAPTCHA real`
3. Valide se o card mostra latência técnica
4. Confirme no log: `mode: "real"` no retorno backend

## Observação comercial

Em domínio real, o comportamento do widget e políticas de navegador costumam refletir melhor o cenário de produção do cliente.
