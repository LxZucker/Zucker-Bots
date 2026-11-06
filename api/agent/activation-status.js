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

    const secret = String(req.body?.activationSecret || "").trim();

    if (!/^[a-f0-9]{64}$/i.test(secret)) {
      return res.status(400).json({ error: "Segredo inválido." });
    }

    const secretHash = crypto
      .createHash("sha256")
      .update(secret)
      .digest("hex");

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    // Procura uma ativação já vinculada, sem consumi-la ainda.
    const search = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?activation_secret_hash=eq.${secretHash}` +
      `&status=eq.claimed` +
      `&agent_token=not.is.null` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      `&select=id,device_id,agent_token`,
      { headers }
    );

    if (!search.ok) {
      throw new Error("Falha ao consultar ativação.");
    }

    const data = await search.json();

    if (!data.length) {
      return res.status(200).json({
        success: true,
        activated: false,
        message: "Aguardando vinculação pelo site."
      });
    }

    const activation = data[0];

    if (!activation.device_id || !activation.agent_token) {
      throw new Error("Dados da ativação incompletos.");
    }

    // Confere se o token ainda pertence ao dispositivo.
    const tokenHash = crypto
      .createHash("sha256")
      .update(activation.agent_token)
      .digest("hex");

    const deviceCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${activation.device_id}` +
      `&agent_token_hash=eq.${tokenHash}&select=id`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    if (!deviceCheck.ok) {
      throw new Error("Falha ao verificar dispositivo.");
    }

    const devices = await deviceCheck.json();

    if (!devices.length) {
      return res.status(401).json({
        error: "Autorização do dispositivo inválida."
      });
    }

    // Entrega novamente o mesmo token enquanto a ativação
    // estiver válida. O agente salva localmente antes de
    // confirmar que recebeu os dados.
    return res.status(200).json({
      success: true,
      activated: true,
      deviceId: activation.device_id,
      agentToken: activation.agent_token
    });

  } catch (error) {
    console.error("Activation status error:", error);

    return res.status(500).json({
      error: "Erro interno ao consultar ativação."
    });
  }
};
