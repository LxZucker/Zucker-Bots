const { getAccountAccessById, accessBlockPayload } = require("../../lib/account-access");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error("Configuração do Supabase ausente.");
    }

    const auth = req.headers.authorization;

    if (!auth) {
      return res.status(401).json({
        error: "Não autenticado"
      });
    }

    const userResponse = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: auth
        }
      }
    );

    if (!userResponse.ok) {
      return res.status(401).json({
        error: "Sessão inválida"
      });
    }

    const user = await userResponse.json();
const access = await getAccountAccessById(user.id);
    const accessPayload = accessBlockPayload(access);
    if (accessPayload.accessBlocked) {
      return res.status(403).json({
        error: accessPayload.suspended ? "Sua conta está suspensa." : "Sua validade expirou.",
        ...accessPayload
      });
    }
        // GET: consultar o código de pareamento
    if (req.method === "GET") {
      const requestId = String(req.query?.requestId || "");

      if (!requestId) {
        return res.status(400).json({
          error: "ID da solicitação ausente."
        });
      }

      const pairingResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/whatsapp_pairing` +
        `?id=eq.${encodeURIComponent(requestId)}` +
        `&user_id=eq.${encodeURIComponent(user.id)}` +
        "&select=status,pairing_code,expires_at&limit=1",
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );

      const pairings = await pairingResponse.json();

      if (!pairingResponse.ok) {
        console.error("Pairing status query failed:", pairings);
        throw new Error("Falha ao consultar solicitação.");
      }

      if (!pairings.length) {
        return res.status(404).json({
          error: "Solicitação não encontrada."
        });
      }

      const pairing = pairings[0];

      return res.status(200).json({
        success: true,
        status: pairing.status,
        pairingCode: pairing.pairing_code,
        expiresAt: pairing.expires_at
      });
    }

    // POST: solicitar um novo código
    const phone = String(req.body?.phone || "")
      .replace(/\D/g, "");

    if (!/^\d{12,13}$/.test(phone)) {
      return res.status(400).json({
        error: "Número inválido. Use DDI + DDD + número."
      });
    }

    const devicesResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices?user_id=eq.${encodeURIComponent(user.id)}&agent_token_hash=not.is.null&status=neq.unlink_pending&select=id,status,last_seen`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      }
    );

    const devices = await devicesResponse.json();

    if (!devicesResponse.ok) {
      throw new Error(JSON.stringify(devices));
    }

    if (devices.length === 0) {
      return res.status(409).json({
        error: "Você precisa vincular um agente primeiro."
      });
    }

    if (devices.length > 1) {
      return res.status(409).json({
        error: "Mais de um agente encontrado. Entre em contato com o suporte."
      });
    }

    const device = devices[0];

    const lastSeen = device.last_seen
      ? new Date(device.last_seen).getTime()
      : 0;

    const isOnline =
      device.status === "online" &&
      Date.now() - lastSeen < 90000;

    if (!isOnline) {
      return res.status(409).json({
        error: "Seu agente está offline. Inicie o ZuckerBots Agent."
      });
    }

    const expiresAt = new Date(
      Date.now() + 5 * 60 * 1000
    ).toISOString();

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/whatsapp_pairing`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          user_id: user.id,
          device_id: device.id,
          phone_number: phone,
          status: "pending",
          expires_at: expiresAt
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }

    return res.status(200).json({
      success: true,
      requestId: data[0].id,
      message: "Solicitação enviada ao agente."
    });

  } catch (error) {
    console.error("Pairing error:", error);

    return res.status(500).json({
      error: "Erro interno ao solicitar conexão."
    });
  }
};
        
