const crypto = require("crypto");

const SUPABASE_URL =
  "https://khkjlodngoahevxkxswj.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

async function authenticateUser(req) {
  const auth = req.headers.authorization || "";

  const userToken = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : "";

  if (!userToken) return null;

  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${userToken}`
      }
    }
  );

  if (!response.ok) return null;

  return response.json();
}

module.exports = async (req, res) => {
  try {
    if (!SUPABASE_KEY) {
      return res.status(500).json({
        error: "Servidor não configurado"
      });
    }

    const user = await authenticateUser(req);

    if (!user) {
      return res.status(401).json({
        error: "Faça login novamente."
      });
    }

    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation"
    };

    if (req.method === "GET") {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/devices` +
        `?user_id=eq.${user.id}` +
        `&agent_token_hash=not.is.null` +
        `&status=neq.unlinked` +
        `&select=id,status,last_seen&limit=1`,
        { headers }
      );

      if (!response.ok) {
        throw new Error("Falha ao consultar dispositivo.");
      }

      const devices = await response.json();

      return res.status(200).json({
        linked: devices.length > 0,
        device: devices[0] || null
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Método não permitido"
      });
    }

    const activationCode = String(
      req.body?.activationCode || ""
    ).trim();

    if (!/^\d{6}$/.test(activationCode)) {
      return res.status(400).json({
        error: "Digite os 6 números do código."
      });
    }

    const keyHash = crypto
      .createHash("sha256")
      .update(user.id)
      .digest("hex");

    const limitResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/check_agent_activation_attempt`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_key_hash: keyHash
        })
      }
    );

    if (!limitResponse.ok) {
      throw new Error(
        "Não foi possível verificar o limite de tentativas."
      );
    }

    const limit = await limitResponse.json();

    if (!limit.allowed) {
      return res.status(429).json({
        error: `Você atingiu 5 tentativas. Aguarde ${Math.ceil(
          (limit.retryAfterSeconds || 300) / 60
        )} minuto(s).`,
        retryAfterSeconds: limit.retryAfterSeconds || 300
      });
    }

    const codeHash = crypto
      .createHash("sha256")
      .update(activationCode)
      .digest("hex");

    const search = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?activation_code_hash=eq.${codeHash}` +
      `&status=eq.pending` +
      `&expires_at=gt.${encodeURIComponent(
        new Date().toISOString()
      )}` +
      `&select=id`,
      { headers }
    );

    if (!search.ok) {
      throw new Error("Falha ao consultar código.");
    }

    const activations = await search.json();

    if (!activations.length) {
      return res.status(404).json({
        error: "Código inválido, expirado ou já utilizado.",
        attemptsLeft: limit.attemptsLeft
      });
    }

    const activationId = activations[0].id;
    const deviceId = crypto.randomUUID();

    const agentToken =
      crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto
      .createHash("sha256")
      .update(agentToken)
      .digest("hex");

    const claim = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?id=eq.${activationId}` +
      `&status=eq.pending` +
      `&expires_at=gt.${encodeURIComponent(
        new Date().toISOString()
      )}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "claimed",
          user_id: user.id,
          expires_at: new Date(
            Date.now() + 5 * 60 * 1000
          ).toISOString()
        })
      }
    );

    if (!claim.ok) {
      throw new Error("Falha ao reservar código.");
    }

    const claimed = await claim.json();

    if (!claimed.length) {
      return res.status(409).json({
        error: "Esse código já foi utilizado."
      });
    }

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
      console.error(
        "Erro ao criar dispositivo:",
        await deviceResponse.text()
      );

      await fetch(
        `${SUPABASE_URL}/rest/v1/agent_activations?id=eq.${activationId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: "pending",
            user_id: null
          })
        }
      );

      return res.status(500).json({
        error: "Não foi possível vincular o dispositivo."
      });
    }

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
      linked: true,
      deviceId,
      message: "Bot vinculado com sucesso!"
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Erro interno ao validar o código."
    });
  }
};
