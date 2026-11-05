
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
      `${SUPABASE_URL}/rest/v1/devices?${filter}&select=id`,
      { headers }
    );

    if (!check.ok) {
      return res.status(500).json({
        error: "Falha ao verificar dispositivo"
      });
    }

    const devices = await check.json();

    if (!devices.length) {
      return res.status(401).json({
        error: "Dispositivo não autorizado"
      });
    }

    const update = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?${filter}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          status: "online",
          last_seen: new Date().toISOString()
        })
      }
    );

    if (!update.ok) {
      return res.status(500).json({
        error: "Não foi possível atualizar o dispositivo"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Comunicação recebida"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erro interno do servidor"
    });
  }
};
    
