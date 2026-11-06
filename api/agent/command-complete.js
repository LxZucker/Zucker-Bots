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
    const token = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";

    const { deviceId, commandId } = req.body || {};

    if (!token || !deviceId || !commandId) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes."
      });
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(deviceId) || !uuidRegex.test(commandId)) {
      return res.status(400).json({
        error: "Identificadores inválidos."
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    // Confere a autorização do agente
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${deviceId}` +
      `&agent_token_hash=eq.${tokenHash}&select=id,user_id`,
      { headers }
    );

    if (!deviceResponse.ok) {
      throw new Error("Falha ao verificar dispositivo.");
    }

    const devices = await deviceResponse.json();

    if (!devices.length) {
      return res.status(401).json({
        error: "Agente não autorizado."
      });
    }

    // Confere se o comando pertence ao dispositivo
    const commandResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?id=eq.${commandId}` +
      `&device_id=eq.${deviceId}` +
      `&user_id=eq.${devices[0].user_id}` +
      `&command=eq.unlink&status=eq.pending&select=id`,
      { headers }
    );

    if (!commandResponse.ok) {
      throw new Error("Falha ao verificar comando.");
    }

    const commands = await commandResponse.json();

    if (!commands.length) {
      return res.status(404).json({
        error: "Comando não encontrado ou já concluído."
      });
    }

    // Confirma a limpeza da sessão
    const completeResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands?id=eq.${commandId}&status=eq.pending`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "completed",
          completed_at: new Date().toISOString()
        })
      }
    );

    if (!completeResponse.ok) {
      throw new Error("Não foi possível concluir o comando.");
    }

    // Remove o registro da sessão do WhatsApp
    const sessionResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_sessions?device_id=eq.${deviceId}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!sessionResponse.ok) {
      throw new Error("Falha ao remover registro da sessão.");
    }

    // Remove pedidos antigos de conexão
    const pairingResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing?device_id=eq.${deviceId}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!pairingResponse.ok) {
      throw new Error("Falha ao limpar pedidos de conexão.");
    }

    // Revoga o token antigo
    const revokeResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}&agent_token_hash=eq.${tokenHash}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          agent_token_hash: null,
          status: "offline",
          pairing_code_hash: null,
          pairing_expires_at: null
        })
      }
    );

    if (!revokeResponse.ok) {
      throw new Error("Falha ao revogar autorização.");
    }

    return res.status(200).json({
      success: true,
      unlinked: true,
      message: "Agente desvinculado e autorização revogada."
    });

  } catch (error) {
    console.error("Command complete error:", error);

    return res.status(500).json({
      error: "Erro interno ao concluir desvinculamento."
    });
  }
};
