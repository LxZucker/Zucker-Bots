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
    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");

    if (!deviceId || !token) {
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
      "Content-Type": "application/json"
    };

    // 1. Confere a autorização do agente.
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${deviceId}` +
      `&agent_token_hash=eq.${tokenHash}` +
      `&select=id,user_id,status`,
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

    // 2. Procura comandos pendentes desse dispositivo.
    const commandResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?device_id=eq.${deviceId}` +
      `&user_id=eq.${device.user_id}` +
      `&status=eq.pending` +
      `&select=id,command,created_at` +
      `&order=created_at.asc` +
      `&limit=1`,
      { headers }
    );

    if (!commandResponse.ok) {
      throw new Error("Falha ao consultar comandos.");
    }

    const commands = await commandResponse.json();

    if (!commands.length) {
      return res.status(200).json({
        success: true,
        hasCommand: false
      });
    }

    return res.status(200).json({
      success: true,
      hasCommand: true,
      commandId: commands[0].id,
      command: commands[0].command
    });

  } catch (error) {
    console.error("Command poll error:", error);

    return res.status(500).json({
      error: "Erro ao consultar comandos."
    });
  }
};
