const crypto = require("crypto");
const { getAccountAccessById, accessBlockPayload } = require("../../lib/account-access");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("Servidor não configurado.");
    }

    const deviceId = String(req.body?.deviceId || "");
    const requestId = String(req.body?.requestId || "");
    const pairingCode = String(req.body?.pairingCode || "");

    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");

    if (!deviceId || !requestId || !token || !pairingCode) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes."
      });
    }

    if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i.test(pairingCode)) {
      return res.status(400).json({
        error: "Código de pareamento inválido."
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
      throw new Error("Falha ao verificar agente.");
    }

    const devices = await deviceResponse.json();

    if (!devices.length || devices[0].status === "unlink_pending") {
      return res.status(401).json({
        error: "Agente não autorizado."
      });
    }

    const access = await getAccountAccessById(devices[0].user_id);
    const accessPayload = accessBlockPayload(access);
    if (accessPayload.accessBlocked) {
      return res.status(403).json({ error: "Acesso do agente bloqueado.", ...accessPayload });
    }

    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing` +
      `?id=eq.${encodeURIComponent(requestId)}` +
      `&device_id=eq.${encodeURIComponent(deviceId)}` +
      `&user_id=eq.${encodeURIComponent(devices[0].user_id)}` +
      "&status=eq.processing" +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          pairing_code: pairingCode,
          status: "generated"
        })
      }
    );

    if (!updateResponse.ok) {
      throw new Error("Falha ao salvar código.");
    }

    const updated = await updateResponse.json();

    if (!updated.length) {
      return res.status(409).json({
        error: "Solicitação expirada ou não encontrada."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Código enviado ao site."
    });

  } catch (error) {
    console.error("Pairing result error:", error);

    return res.status(500).json({
      error: "Erro ao salvar código de pareamento."
    });
  }
};
      
