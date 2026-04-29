const logOutput = document.getElementById("log-output");
const captchaBtn = document.getElementById("captcha-btn");
const captchaRealBtn = document.getElementById("captcha-real-btn");
const captchaStatus = document.getElementById("captcha-status");
const submitBtn = document.getElementById("submit-btn");
const form = document.getElementById("demo-form");
const modePill = document.getElementById("mode-pill");
const sdkPill = document.getElementById("sdk-pill");
const latencyChallengeEl = document.getElementById("latency-challenge");
const latencyBackendEl = document.getElementById("latency-backend");
const latencyTotalEl = document.getElementById("latency-total");
const latencySamplesEl = document.getElementById("latency-samples");
const latencyAvgEl = document.getElementById("latency-avg");
const latencyMedianEl = document.getElementById("latency-median");
const latencyP95El = document.getElementById("latency-p95");
const resetMetricsBtn = document.getElementById("reset-metrics-btn");
const clearLogBtn = document.getElementById("clear-log-btn");

let appConfig = { appId: "", demoMode: true };
let captchaSession = { verified: false, ticket: "", randstr: "" };
let sdkLoaded = false;
const backendLatencyHistory = [];

function writeLog(message, data) {
  const time = new Date().toLocaleTimeString("pt-BR");
  const payload = data ? `\n${JSON.stringify(data, null, 2)}` : "";
  logOutput.textContent = `[${time}] ${message}${payload}\n\n` + logOutput.textContent;
}

function setCaptchaState(ok, text) {
  captchaStatus.textContent = text;
  captchaStatus.classList.remove("ok", "err");
  captchaStatus.classList.add(ok ? "ok" : "err");
  submitBtn.disabled = !ok;
}

function generateMockToken() {
  const base = crypto.getRandomValues(new Uint32Array(3));
  return {
    ticket: `mock-ticket-${base[0]}-${base[1]}`,
    randstr: `mock-rand-${base[2]}`
  };
}

function formatMs(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-- ms";
  return `${Math.round(value)} ms`;
}

function setLatencyCards({ challengeMs, backendMs, totalMs }) {
  latencyChallengeEl.textContent = formatMs(challengeMs);
  latencyBackendEl.textContent = formatMs(backendMs);
  latencyTotalEl.textContent = formatMs(totalMs);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function updateBackendStats() {
  const n = backendLatencyHistory.length;
  latencySamplesEl.textContent = String(n);
  if (!n) {
    latencyAvgEl.textContent = "-- ms";
    latencyMedianEl.textContent = "-- ms";
    latencyP95El.textContent = "-- ms";
    return;
  }
  const sum = backendLatencyHistory.reduce((acc, v) => acc + v, 0);
  const avg = sum / n;
  const median = percentile(backendLatencyHistory, 50);
  const p95 = percentile(backendLatencyHistory, 95);
  latencyAvgEl.textContent = formatMs(avg);
  latencyMedianEl.textContent = formatMs(median);
  latencyP95El.textContent = formatMs(p95);
}

async function loadConfig() {
  try {
    const res = await fetch("/api/config");
    appConfig = await res.json();
    modePill.textContent = appConfig.demoMode ? "Modo: DEMO" : "Modo: PRODUCAO";
    writeLog("Configuração carregada", appConfig);
  } catch (error) {
    writeLog("Falha ao carregar configuração", { error: error.message });
  }
}

async function verifyCaptcha(ticket, randstr) {
  const res = await fetch("/api/verify-captcha", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, randstr })
  });
  return res.json();
}

async function runTencentCaptchaFlow(triggerElement) {
  if (!window.TencentCaptcha || !appConfig.appId) {
    throw new Error("SDK TencentCaptcha não carregada ou appId ausente");
  }
  if (!triggerElement) {
    throw new Error("Elemento de disparo do CAPTCHA não informado");
  }

  return new Promise((resolve, reject) => {
    const showStartedAt = performance.now();
    let widgetOpenMs = null;
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(
          new Error(
            "Timeout ao abrir/retornar do CAPTCHA real. Verifique bloqueio de popup/extensão/rede."
          )
        );
      }
    }, 12000);

    const finishResolve = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(payload);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(error);
    };

    const cleanup = () => {};

    let handler;
    try {
      // Use Tencent's common constructor signature:
      // new TencentCaptcha(element, appId, callback, options)
      handler = new window.TencentCaptcha(
        triggerElement,
        String(appConfig.appId),
        (res) => {
          const callbackAt = performance.now();
          if (!res) {
            cleanup();
            finishReject(new Error("Callback vazio da Tencent"));
            return;
          }
          if (res.ret === 0) {
            cleanup();
            finishResolve({
              ticket: res.ticket,
              randstr: res.randstr,
              humanInteractionMs: callbackAt - showStartedAt,
              widgetOpenMs
            });
          } else {
            cleanup();
            finishReject(new Error(`Captcha interrompido. ret=${res.ret}`));
          }
        },
        {}
      );
      handler.show();
      // Approximate technical widget-open/render latency (without human time).
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          widgetOpenMs = performance.now() - showStartedAt;
          writeLog("Latência técnica de abertura do widget", {
            openMs: Math.round(widgetOpenMs)
          });
        });
      });
    } catch (err) {
      cleanup();
      finishReject(new Error(`Falha ao exibir CAPTCHA real: ${err.message}`));
    }
  });
}

async function startCaptchaValidation(flowMode) {
  setCaptchaState(false, "Validando...");
  captchaBtn.disabled = true;
  captchaRealBtn.disabled = true;

  try {
    let tokens;
    let challengeMs;
    let humanMs;

    if (flowMode === "real") {
      try {
        tokens = await runTencentCaptchaFlow(captchaRealBtn);
        humanMs = tokens.humanInteractionMs;
        challengeMs = tokens.widgetOpenMs ?? 0;
        writeLog("Ticket recebido da Tencent (fluxo real)", tokens);
      } catch (realError) {
        writeLog("Falha no fluxo real", {
          error: realError.message
        });
        throw realError;
      }
    } else if (appConfig.demoMode) {
      tokens = generateMockToken();
      challengeMs = 0;
      writeLog("Executando modo DEMO (mock token)", tokens);
    } else {
      tokens = await runTencentCaptchaFlow(captchaRealBtn);
      humanMs = tokens.humanInteractionMs;
      challengeMs = tokens.widgetOpenMs ?? 0;
      writeLog("Ticket recebido da Tencent", tokens);
    }

    const backendStart = performance.now();
    const result = await verifyCaptcha(tokens.ticket, tokens.randstr);
    const backendMs = performance.now() - backendStart;
    const totalMs = challengeMs + backendMs;
    writeLog("Resposta do backend", result);
    if (typeof humanMs === "number") {
      writeLog("Tempo de interação humana (não entra na latência técnica)", {
        humanInteractionMs: Math.round(humanMs)
      });
    }
    setLatencyCards({ challengeMs, backendMs, totalMs });
    backendLatencyHistory.push(backendMs);
    updateBackendStats();

    if (result.ok) {
      captchaSession = { verified: true, ...tokens };
      setCaptchaState(true, `Aprovado (${result.mode}) - score ${result.riskScore}`);
    } else {
      captchaSession = { verified: false, ticket: "", randstr: "" };
      setCaptchaState(false, `Reprovado (${result.mode}) - ${result.detail || "sem detalhe"}`);
    }
  } catch (error) {
    captchaSession = { verified: false, ticket: "", randstr: "" };
    setCaptchaState(false, `Falha na validação: ${error.message}`);
    writeLog("Erro no fluxo CAPTCHA", { error: error.message });
    setLatencyCards({ challengeMs: null, backendMs: null, totalMs: null });
  } finally {
    captchaBtn.disabled = false;
    captchaRealBtn.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!captchaSession.verified) {
    setCaptchaState(false, "Valide o CAPTCHA antes de enviar");
    return;
  }

  const email = document.getElementById("email").value;
  const message = document.getElementById("message").value;
  writeLog("Formulário enviado com CAPTCHA válido", {
    email,
    message,
    captchaSession
  });
  alert("Demo enviada com sucesso. Veja o log técnico abaixo.");
});

captchaBtn.addEventListener("click", () => startCaptchaValidation("mock"));
captchaRealBtn.addEventListener("click", () => startCaptchaValidation("real"));
resetMetricsBtn.addEventListener("click", () => {
  backendLatencyHistory.length = 0;
  setLatencyCards({ challengeMs: null, backendMs: null, totalMs: null });
  updateBackendStats();
  writeLog("Métricas de latência foram resetadas");
});
clearLogBtn.addEventListener("click", () => {
  logOutput.textContent = "Aguardando ações...";
});

(async function boot() {
  updateBackendStats();
  await loadConfig();
  if (appConfig.appId) {
    const script = document.createElement("script");
    script.src = "https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js";
    script.async = true;
    script.onload = () => {
      sdkLoaded = true;
      sdkPill.textContent = "SDK: carregada";
      writeLog("SDK Tencent CAPTCHA carregada");
    };
    script.onerror = () => {
      sdkLoaded = false;
      sdkPill.textContent = "SDK: falhou";
      writeLog("Falha ao carregar SDK Tencent CAPTCHA");
    };
    document.head.appendChild(script);
  } else {
    sdkPill.textContent = "SDK: sem appId";
    writeLog("Sem appId configurado para carregar SDK");
  }

  if (appConfig.demoMode) {
    writeLog("Rodando em DEMO_MODE=true (backend mock + widget visual opcional)");
  }

  if (!appConfig.appId) {
    captchaRealBtn.disabled = true;
    captchaRealBtn.title = "Configure TENCENT_CAPTCHA_APP_ID para habilitar";
  }
})();
