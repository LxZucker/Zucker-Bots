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

    const { deviceId } = req.body || {};

    if (!token || !deviceId) {
      return res.status(401).json({
        error: "Autenticação ausente."
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
      Authorization: `Bearer ${SUPABASE_KEY}`
    };

    // Confere se o agente está autorizado
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${encodeURIComponent(deviceId)}` +
      `&agent_token_hash=eq.${tokenHash}&select=id`,
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

    // Procura comandos pendentes
    const commandResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?device_id=eq.${encodeURIComponent(deviceId)}` +
      `&status=eq.pending` +
      `&order=created_at.asc&limit=1&select=id,command`,
      { headers }
    );

    if (!commandResponse.ok) {
      throw new Error("Falha ao consultar comandos.");
    }

    const commands = await commandResponse.json();

    if (!commands.length) {
      return res.status(200).json({
        success: true,
        command: null
      });
    }

    return res.status(200).json({
      success: true,
      command: commands[0].command,
      commandId: commands[0].id
    });

  } catch (error) {
    console.error("Command poll error:", error);

    return res.status(500).json({
      error: "Erro interno ao consultar comandos."
    });
  }
};
