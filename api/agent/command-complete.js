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

    const deviceId = String(req.body?.deviceId || "");
    const commandId = String(req.body?.commandId || "");
    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");

    if (!deviceId || !commandId || !token) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes."
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

    // 1. Verifica a autorização do agente.
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${deviceId}` +
      `&agent_token_hash=eq.${tokenHash}` +
      `&select=id,user_id`,
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

    const device = devices[0];

    // 2. Confere se o comando pertence ao dispositivo.
    const commandResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?id=eq.${commandId}` +
      `&device_id=eq.${deviceId}` +
      `&user_id=eq.${device.user_id}` +
      `&command=eq.unlink` +
      `&select=id,status`,
      { headers }
    );

    if (!commandResponse.ok) {
      throw new Error("Falha ao consultar comando.");
    }

    const commands = await commandResponse.json();

    if (!commands.length || commands[0].status === "failed") {
      return res.status(404).json({
        error: "Comando não encontrado ou inválido."
      });
    }

    // 3. Limpa os registros de sessão do dispositivo.
    const sessionDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_sessions` +
      `?device_id=eq.${deviceId}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!sessionDelete.ok) {
      throw new Error("Falha ao limpar sessões.");
    }

    // 4. Limpa os pedidos de conexão desse usuário.
    const pairingDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing` +
      `?user_id=eq.${device.user_id}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!pairingDelete.ok) {
      throw new Error("Falha ao limpar pedidos de conexão.");
    }

    // 5. Só confirma o comando depois da limpeza.
    const completeResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?id=eq.${commandId}` +
      `&device_id=eq.${deviceId}`,
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
      throw new Error("Falha ao concluir comando.");
    }

    // 6. Revoga o token do agente por último.
    const revokeResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?id=eq.${deviceId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "offline",
          agent_token_hash: null,
          pairing_code_hash: null,
          pairing_expires_at: null
        })
      }
    );

    if (!revokeResponse.ok) {
      throw new Error("Falha ao revogar agente.");
    }

    return res.status(200).json({
      success: true,
      message: "Desvinculação concluída."
    });

  } catch (error) {
    console.error("Command complete error:", error);

    return res.status(500).json({
      error: "Erro ao concluir desvinculação."
    });
  }
};
