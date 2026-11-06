const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
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

    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${encodeURIComponent(deviceId)}` +
      `&agent_token_hash=eq.${tokenHash}` +
      "&select=id,user_id,status",
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

    if (device.status === "unlink_pending" || device.status === "offline") {
      return res.status(409).json({
        error: "Dispositivo indisponível."
      });
    }

    const now = new Date().toISOString();

    const pairingResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing` +
      `?device_id=eq.${encodeURIComponent(deviceId)}` +
      `&user_id=eq.${encodeURIComponent(device.user_id)}` +
      "&status=eq.pending" +
      `&expires_at=gt.${encodeURIComponent(now)}` +
      "&select=id,phone_number,expires_at" +
      "&order=created_at.asc&limit=1",
      { headers }
    );

    if (!pairingResponse.ok) {
      throw new Error("Falha ao consultar solicitações.");
    }

    const pairings = await pairingResponse.json();

    if (!pairings.length) {
      return res.status(200).json({
        success: true,
        hasRequest: false
      });
    }

    const pairing = pairings[0];

    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing` +
      `?id=eq.${encodeURIComponent(pairing.id)}` +
      "&status=eq.pending",
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "processing"
        })
      }
    );

    if (!updateResponse.ok) {
      throw new Error("Falha ao reservar solicitação.");
    }

    const updated = await updateResponse.json();

    if (!updated.length) {
      return res.status(200).json({
        success: true,
        hasRequest: false
      });
    }

    return res.status(200).json({
      success: true,
      hasRequest: true,
      requestId: pairing.id,
      phone: pairing.phone_number,
      expiresAt: pairing.expires_at
    });

  } catch (error) {
    console.error("Pairing poll error:", error);

    return res.status(500).json({
      error: "Erro ao consultar solicitações de conexão."
    });
  }
};
