const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set("trust proxy", true);

const APP_ID = process.env.TENCENT_CAPTCHA_APP_ID || "";
const APP_SECRET = process.env.TENCENT_CAPTCHA_APP_SECRET_KEY || "";
const SECRET_ID = process.env.TENCENT_SECRET_ID || "";
const CAPTCHA_ENDPOINT =
  process.env.TENCENT_CAPTCHA_ENDPOINT || "captcha.intl.tencentcloudapi.com";
const DEMO_MODE = String(process.env.DEMO_MODE || "false").toLowerCase() === "true";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "tencent-captcha-demo-live" });
});

function getClientIp(req) {
  const xfwd = req.headers["x-forwarded-for"];
  if (typeof xfwd === "string" && xfwd.length > 0) {
    return xfwd.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "127.0.0.1";
}

function mockCaptchaVerification(ticket, randstr) {
  if (!ticket || !randstr) {
    return {
      ok: false,
      reason: "ticket/randstr ausentes",
      score: 0
    };
  }

  // Keep a deterministic demo behavior.
  const hash = crypto.createHash("sha1").update(`${ticket}:${randstr}`).digest("hex");
  const pass = parseInt(hash.slice(0, 2), 16) % 5 !== 0; // ~80% pass

  return {
    ok: pass,
    reason: pass ? "validacao mock aprovada" : "validacao mock reprovada",
    score: pass ? 80 : 20
  };
}

async function verifyWithTencent({ ticket, randstr, userIp }) {
  const action = "DescribeCaptchaResult";
  const version = "2019-07-22";
  const nonce = Math.floor(Math.random() * 1000000);
  const timestamp = Math.floor(Date.now() / 1000);

  const requestPayload = {
    CaptchaType: 9,
    Ticket: ticket,
    UserIp: userIp,
    Randstr: randstr,
    CaptchaAppId: Number(APP_ID),
    AppSecretKey: APP_SECRET
  };

  const body = JSON.stringify(requestPayload);

  const date = new Date().toISOString().slice(0, 10);
  const credentialScope = `${date}/captcha/tc3_request`;
  const hashedRequestPayload = crypto.createHash("sha256").update(body).digest("hex");
  const canonicalRequest = [
    "POST",
    "/",
    "",
    "content-type:application/json; charset=utf-8\nhost:" + CAPTCHA_ENDPOINT + "\n",
    "content-type;host",
    hashedRequestPayload
  ].join("\n");

  const hashedCanonicalRequest = crypto
    .createHash("sha256")
    .update(canonicalRequest)
    .digest("hex");

  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest
  ].join("\n");

  const secretDate = crypto.createHmac("sha256", "TC3" + APP_SECRET).update(date).digest();
  const secretService = crypto.createHmac("sha256", secretDate).update("captcha").digest();
  const secretSigning = crypto
    .createHmac("sha256", secretService)
    .update("tc3_request")
    .digest();
  const signature = crypto
    .createHmac("sha256", secretSigning)
    .update(stringToSign)
    .digest("hex");

  const authorization = `TC3-HMAC-SHA256 Credential=${SECRET_ID}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

  const res = await fetch(`https://${CAPTCHA_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: CAPTCHA_ENDPOINT,
      "X-TC-Action": action,
      "X-TC-Version": version,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Nonce": String(nonce),
      "X-TC-Region": ""
    },
    body
  });

  const data = await res.json();
  const response = data?.Response || {};
  if (response.Error) {
    return {
      ok: false,
      reason: `${response.Error.Code}: ${response.Error.Message}`,
      raw: response
    };
  }

  const isOk = Number(response.CaptchaCode) === 1;
  return {
    ok: isOk,
    reason: response.CaptchaMsg || (isOk ? "ok" : "blocked"),
    score: Number(response.EvilLevel || 0),
    raw: response
  };
}

app.get("/api/config", (_req, res) => {
  res.json({
    appId: APP_ID,
    demoMode: DEMO_MODE
  });
});

app.post("/api/verify-captcha", async (req, res) => {
  const { ticket, randstr } = req.body || {};
  const userIp = getClientIp(req);

  if (!ticket || !randstr) {
    return res.status(400).json({
      ok: false,
      message: "ticket e randstr sao obrigatorios"
    });
  }

  try {
    let verification;
    if (DEMO_MODE) {
      verification = mockCaptchaVerification(ticket, randstr);
    } else {
      const hasRequiredEnv = APP_ID && APP_SECRET && SECRET_ID;
      if (!hasRequiredEnv) {
        return res.status(500).json({
          ok: false,
          message:
            "Configure TENCENT_CAPTCHA_APP_ID, TENCENT_CAPTCHA_APP_SECRET_KEY e TENCENT_SECRET_ID no .env"
        });
      }
      verification = await verifyWithTencent({ ticket, randstr, userIp });
    }

    return res.json({
      ok: verification.ok,
      mode: DEMO_MODE ? "mock" : "real",
      detail: verification.reason,
      riskScore: verification.score
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao validar captcha",
      error: error.message
    });
  }
});

const indexPath = path.join(__dirname, "public", "index.html");

app.get("/", (_req, res) => {
  if (!fs.existsSync(indexPath)) {
    return res.status(500).send("index.html not found in /public");
  }
  return res.sendFile(indexPath);
});

app.get("*", (_req, res) => {
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send("Not Found");
  }
  return res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`Tencent CAPTCHA live demo running on http://localhost:${PORT}`);
  console.log(`Static index path: ${indexPath}`);
  console.log(`Index exists: ${fs.existsSync(indexPath)}`);
});
