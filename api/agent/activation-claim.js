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

    // Verifica o usuário logado
    const auth = req.headers.authorization || "";
    const userToken = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!userToken) {
      return res.status(401).json({ error: "Faça login novamente" });
    }

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

    // Confere o código informado
    const activationCode = String(
      req.body?.activationCode || ""
    ).trim().toUpperCase();

    if (!/^[A-F0-9]{10}$/.test(activationCode)) {
      return res.status(400).json({
        error: "Código de ativação inválido."
      });
    }

    const codeHash = crypto
      .createHash("sha256")
      .update(activationCode)
      .digest("hex");

    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation"
    };

    // Procura uma ativação válida
    const search = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?activation_code_hash=eq.${codeHash}` +
      `&status=eq.pending` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}` +
      `&select=id`,
      { headers }
    );

    if (!search.ok) {
      throw new Error("Falha ao consultar ativação.");
    }

    const activations = await search.json();

    if (!activations.length) {
      return res.status(404).json({
        error: "Código inválido, expirado ou já utilizado."
      });
    }

    const activationId = activations[0].id;
    const deviceId = crypto.randomUUID();
    const agentToken = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(agentToken)
      .digest("hex");

    // Reserva a ativação para impedir uso duplicado
    const claim = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?id=eq.${activationId}` +
      `&status=eq.pending` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "claimed",
          user_id: user.id
        })
      }
    );

    if (!claim.ok) {
      throw new Error("Falha ao reservar ativação.");
    }

    const claimed = await claim.json();

    if (!claimed.length) {
      return res.status(409).json({
        error: "Esse código já foi utilizado."
      });
    }

    // Cria o dispositivo vinculado à conta
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: deviceId,
          user_id: user.id,
          device_name: "Meu ZuckerBot",
          status: "connecting",
          agent_token_hash: tokenHash
        })
      }
    );

    if (!deviceResponse.ok) {
      const error = await deviceResponse.text();
      console.error("Erro ao criar dispositivo:", error);

      return res.status(500).json({
        error: "Não foi possível vincular o dispositivo."
      });
    }

    // Guarda temporariamente o token para o agente buscá-lo
    const finish = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations?id=eq.${activationId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          device_id: deviceId,
          agent_token: agentToken
        })
      }
    );

    if (!finish.ok) {
      throw new Error("Falha ao finalizar ativação.");
    }

    return res.status(200).json({
      success: true,
      message: "Agente vinculado! Aguarde a confirmação no Termux."
    });

  } catch (error) {
    console.error("Activation claim error:", error);

    return res.status(500).json({
      error: "Erro interno ao vincular o agente."
    });
  }
};
