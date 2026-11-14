const crypto = require("crypto");
const { getAccountAccessById, accessBlockPayload } = require("../../lib/account-access");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://khkjlodngoahevxkxswj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// O relatório de atualização compartilha esta função Serverless com o heartbeat.
// A rewrite em vercel.json mantém a URL antiga /api/agent/update-report compatível
// com as versões do agente que já estão instaladas.
async function handleUpdateReport(req, res) {
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
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const mode = String(req.query?.mode || "");
    if (mode === "update-report") {
      return handleUpdateReport(req, res);
    }

    if (!SUPABASE_KEY) {
      return res.status(500).json({ error: "Servidor não configurado" });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const { deviceId } = req.body || {};

    if (!token || !deviceId) {
      return res.status(401).json({ error: "Dados de autenticação ausentes" });
    }
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
      return res.status(400).json({ error: "ID de dispositivo inválido" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`
    };
    const filter = `id=eq.${encodeURIComponent(deviceId)}&agent_token_hash=eq.${tokenHash}`;

    const check = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?${filter}&select=id,user_id,status`,
      { headers }
    );
    if (!check.ok) throw new Error("Falha ao verificar dispositivo.");
    const devices = await check.json();
    if (!devices.length) {
      return res.status(401).json({ error: "Dispositivo não autorizado." });
    }

    const device = devices[0];
    if (device.status === "unlink_pending") {
      return res.status(200).json({ success: true, unlinkPending: true });
    }
  
    const update = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?${filter}&status=neq.unlink_pending`,
      {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({
  status: "online",
  last_seen: new Date().toISOString(),
  whatsapp_connected: req.body?.whatsappConnected === true
})
      }
    );
    if (!update.ok) throw new Error("Não foi possível atualizar o dispositivo.");
    const updatedDevices = await update.json();
    if (!updatedDevices.length) return res.status(200).json({ success: true, unlinkPending: true });

    const access = await getAccountAccessById(device.user_id);
    const accessPayload = accessBlockPayload(access);
    if (accessPayload.accessBlocked) {
      return res.status(200).json({
        success: true,
        ...accessPayload,
        savedMessages: 0,
        message: "Agente bloqueado pelo controle de acesso da conta."
      });
    }

    const incoming = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, 20) : [];
    const rows = incoming
      .filter(m => m && typeof m.remoteJid === "string" && m.remoteJid && typeof m.messageId === "string" && m.messageId)
      .map(m => ({
        device_id: device.id,
        user_id: device.user_id,
        remote_jid: m.remoteJid.slice(0, 180),
        message_id: m.messageId.slice(0, 180),
        participant_jid: typeof m.participantJid === "string" ? m.participantJid.slice(0, 180) : null,
        from_me: Boolean(m.fromMe),
        message_type: typeof m.messageType === "string" ? m.messageType.slice(0, 80) : "unknown",
        message_text: typeof m.messageText === "string" ? m.messageText.slice(0, 4000) : "",
        message_timestamp: m.messageTimestamp || new Date().toISOString()
      }));

    if (rows.length) {
      const save = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_messages?on_conflict=device_id,message_id`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "resolution=ignore-duplicates,return=minimal"
          },
          body: JSON.stringify(rows)
        }
      );
      if (!save.ok) {
        const details = await save.text();
        console.error("Message insert failed:", details);
        throw new Error("Falha ao registrar mensagens recebidas.");
      }
    }

    return res.status(200).json({
      success: true,
      ...accessPayload,
      savedMessages: rows.length,
      message: "Comunicação recebida."
    });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return res.status(500).json({ error: error.message || "Erro interno do servidor." });
  }
};
                                 
