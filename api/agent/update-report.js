const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://khkjlodngoahevxkxswj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    if (!SUPABASE_KEY) {
      return res.status(500).json({ error: "Servidor não configurado" });
    }

    const deviceId = String(req.body?.deviceId || "");
    const version = String(req.body?.version || "");
    const status = String(req.body?.status || "");
    const message = String(req.body?.message || "").slice(0, 1500);
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

    if (!/^[0-9a-f-]{36}$/i.test(deviceId) || !token) {
      return res.status(400).json({ error: "Identificação do agente inválida." });
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      return res.status(400).json({ error: "Versão inválida." });
    }
    if (!["success", "failed"].includes(status)) {
      return res.status(400).json({ error: "Estado de atualização inválido." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    };

    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?id=eq.${encodeURIComponent(deviceId)}&agent_token_hash=eq.${tokenHash}&select=id,user_id`,
      { headers }
    );
    const devices = await deviceResponse.json().catch(() => []);
    if (!deviceResponse.ok || !Array.isArray(devices) || !devices.length) {
      return res.status(401).json({ error: "Agente não autorizado." });
    }

    const save = await fetch(`${SUPABASE_URL}/rest/v1/bot_update_events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: devices[0].user_id,
        device_id: devices[0].id,
        version,
        status,
        message
      })
    });

    if (!save.ok) {
      const details = await save.text();
      console.error("[UPDATE REPORT INSERT]", details);
      return res.status(502).json({ error: "Não foi possível registrar o resultado da atualização." });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[UPDATE REPORT]", error);
    return res.status(500).json({ error: "Erro ao registrar atualização." });
  }
};
        
