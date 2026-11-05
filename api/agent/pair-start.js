
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
    const userToken = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!userToken) {
      return res.status(401).json({ error: "Faça login novamente" });
    }

    // Confirma a identidade do usuário pelo token da sessão
    const userResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${userToken}`
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(401).json({ error: "Sessão inválida" });
    }

    const user = await userResponse.json();

    const { deviceName } = req.body || {};
    const name = String(deviceName || "Meu ZuckerBot").trim().slice(0, 40);

    const deviceId = crypto.randomUUID();
    const pairingCode = crypto.randomBytes(4).toString("hex").toUpperCase();

    const pairingCodeHash = crypto
      .createHash("sha256")
      .update(pairingCode)
      .digest("hex");

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation"
    };

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/devices`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: deviceId,
          user_id: user.id,
          device_name: name,
          status: "connecting",
          pairing_code_hash: pairingCodeHash,
          pairing_expires_at: expiresAt
        })
      }
    );

    if (!response.ok) {
      return res.status(500).json({
        error: "Não foi possível criar o dispositivo"
      });
    }

    return res.status(201).json({
      success: true,
      deviceId,
      pairingCode,
      expiresAt,
      message: "Código criado. Ele expira em 10 minutos."
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erro interno do servidor"
    });
  }
};
  
