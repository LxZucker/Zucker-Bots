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
      savedMessages: rows.length,
      message: "Comunicação recebida."
    });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return res.status(500).json({ error: error.message || "Erro interno do servidor." });
  }
};
