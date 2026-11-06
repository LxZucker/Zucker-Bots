const crypto = require("crypto");

const SUPABASE_URL = "https://khkjlodngoahevxkxswj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    if (!SUPABASE_KEY) {
      return res.status(500).json({
        error: "Servidor não configurado"
      });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";

    const { deviceId } = req.body || {};

    if (!token || !deviceId) {
      return res.status(401).json({
        error: "Dados de autenticação ausentes"
      });
    }

    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
      return res.status(400).json({
        error: "ID de dispositivo inválido"
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const headers = {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`
    };

    const filter =
      `id=eq.${encodeURIComponent(deviceId)}` +
      `&agent_token_hash=eq.${encodeURIComponent(tokenHash)}`;

    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?${filter}&select=id,status`,
      { headers }
    );

    if (!check.ok) {
      throw new Error("Falha ao verificar dispositivo.");
    }

    const devices = await check.json();

    if (!devices.length) {
      return res.status(401).json({
        error: "Dispositivo não autorizado."
      });
    }

    const device = devices[0];

    // Não permite que o heartbeat reverta a desvinculação.
    if (device.status === "unlink_pending") {
      return res.status(200).json({
        success: true,
        unlinkPending: true,
        message: "Desvinculação aguardando processamento."
      });
    }

    const update = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?${filter}&status=neq.unlink_pending`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          status: "online",
          last_seen: new Date().toISOString()
        })
      }
    );

    if (!update.ok) {
      throw new Error("Não foi possível atualizar o dispositivo.");
    }

    const updatedDevices = await update.json();

    if (!updatedDevices.length) {
      return res.status(200).json({
        success: true,
        unlinkPending: true
      });
    }

    return res.status(200).json({
      success: true,
      message: "Comunicação recebida."
    });

  } catch (error) {
    console.error("Heartbeat error:", error);

    return res.status(500).json({
      error: "Erro interno do servidor."
    });
  }
};
