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

    const deviceId = String(req.body?.deviceId || "");
    const commandId = String(req.body?.commandId || "");
    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!deviceId || !commandId || !token) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes."
      });
    }

    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
      return res.status(400).json({
        error: "ID de dispositivo inválido."
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

    // 1. Confere se o token pertence ao dispositivo.
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${encodeURIComponent(deviceId)}` +
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
      `?id=eq.${encodeURIComponent(commandId)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}` +
      `&user_id=eq.${encodeURIComponent(device.user_id)}` +
      `&command=eq.unlink` +
      `&select=id,status`,
      { headers }
    );

    if (!commandResponse.ok) {
      throw new Error("Falha ao consultar comando.");
    }

    const commands = await commandResponse.json();

    if (!commands.length) {
      return res.status(404).json({
        error: "Comando não encontrado."
      });
    }

    // 3. Apaga as sessões do dispositivo.
    const sessionDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_sessions` +
      `?device_id=eq.${encodeURIComponent(deviceId)}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!sessionDelete.ok) {
      throw new Error("Falha ao apagar sessões do bot.");
    }

    // 4. Apaga os pedidos de pareamento do dispositivo.
    const pairingDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing` +
      `?user_id=eq.${encodeURIComponent(device.user_id)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!pairingDelete.ok) {
      throw new Error("Falha ao apagar pedidos do WhatsApp.");
    }

    // 5. Apaga os registros de ativação desse dispositivo.
    const activationDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?user_id=eq.${encodeURIComponent(device.user_id)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!activationDelete.ok) {
      throw new Error("Falha ao apagar registros de ativação.");
    }

    // 6. Marca o comando como concluído.
    const completeResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?id=eq.${encodeURIComponent(commandId)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}`,
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

    // 7. Apaga todos os comandos relacionados ao dispositivo.
    const commandDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?device_id=eq.${encodeURIComponent(deviceId)}` +
      `&user_id=eq.${encodeURIComponent(device.user_id)}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!commandDelete.ok) {
      throw new Error("Falha ao apagar comandos do dispositivo.");
    }

    // 8. Por último, apaga o registro do dispositivo.
    const deviceDelete = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${encodeURIComponent(deviceId)}` +
      `&user_id=eq.${encodeURIComponent(device.user_id)}`,
      {
        method: "DELETE",
        headers
      }
    );

    if (!deviceDelete.ok) {
      throw new Error("Falha ao apagar dispositivo.");
    }

    return res.status(200).json({
      success: true,
      unlinked: true,
      message: "Registros do dispositivo apagados."
    });

  } catch (error) {
    console.error("Command complete error:", error);

    return res.status(500).json({
      error: error.message || "Erro ao concluir desvinculação."
    });
  }
};
