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

    const activationSecret = String(
      req.body?.activationSecret || ""
    ).trim();

    if (!/^[a-f0-9]{64}$/i.test(activationSecret)) {
      return res.status(400).json({
        error: "Segredo de ativação inválido."
      });
    }

    const secretHash = crypto
      .createHash("sha256")
      .update(activationSecret)
      .digest("hex");

    const headers = {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation"
    };

    // Busca e consome a autorização em uma única operação
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?activation_secret_hash=eq.${secretHash}` +
      `&status=eq.claimed` +
      `&agent_token=not.is.null` +
      `&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "consumed"
        })
      }
    );

    if (!response.ok) {
      console.error("Erro ao consultar ativação:", await response.text());

      return res.status(500).json({
        error: "Falha ao consultar ativação."
      });
    }

    const data = await response.json();

    if (!data.length) {
      return res.status(200).json({
        success: true,
        activated: false,
        message: "Aguardando vinculação pelo site."
      });
    }

    const activation = data[0];

    if (!activation.device_id || !activation.agent_token) {
      return res.status(500).json({
        error: "Dados da ativação incompletos."
      });
    }

    // Apaga o token temporário do banco
    const cleanup = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations?id=eq.${activation.id}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          agent_token: null
        })
      }
    );

    if (!cleanup.ok) {
      console.error("Não foi possível limpar o token temporário.");
    }

    return res.status(200).json({
      success: true,
      activated: true,
      deviceId: activation.device_id,
      agentToken: activation.agent_token,
      message: "Agente autorizado com sucesso."
    });

  } catch (error) {
    console.error("Activation status error:", error);

    return res.status(500).json({
      error: "Erro interno ao consultar ativação."
    });
  }
};
