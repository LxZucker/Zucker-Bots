
const crypto = require("crypto");

const SUPABASE_URL = "https://khkjlodngoahevxkxswj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    if (!SUPABASE_KEY) {
      return res.status(500).json({ error: "Servidor não configurado" });
    }

    const { pairingCode } = req.body || {};
    const code = String(pairingCode || "").trim().toUpperCase();

    if (!/^[A-F0-9]{8}$/.test(code)) {
      return res.status(400).json({ error: "Código inválido" });
    }

    const pairingHash = crypto
      .createHash("sha256")
      .update(code)
      .digest("hex");

    const agentToken = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(agentToken)
      .digest("hex");

    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation"
    };

    const filter =
      `pairing_code_hash=eq.${pairingHash}` +
      `&pairing_expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      `&agent_token_hash=is.null`;

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?${filter}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          agent_token_hash: tokenHash,
          pairing_code_hash: null,
          pairing_expires_at: null,
          status: "connecting"
        })
      }
    );

    if (!response.ok) {
      return res.status(500).json({
        error: "Falha ao validar o pareamento"
      });
    }

    const devices = await response.json();

    if (!devices.length) {
      return res.status(401).json({
        error: "Código inválido, expirado ou já utilizado"
      });
    }

    return res.status(200).json({
      success: true,
      deviceId: devices[0].id,
      agentToken,
      message: "Agente autorizado com sucesso"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erro interno do servidor"
    });
  }
};
