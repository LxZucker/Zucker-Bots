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

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations` +
      `?activation_secret_hash=eq.${secretHash}` +
      `&status=eq.claimed` +
      `&agent_token=not.is.null`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "consumed",
          agent_token: null
        })
      }
    );

    if (!response.ok) {
      throw new Error("Falha ao confirmar ativação.");
    }

    const data = await response.json();

    if (!data.length) {
      return res.status(404).json({
        error: "Ativação não encontrada ou já confirmada."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ativação confirmada com sucesso."
    });

  } catch (error) {
    console.error("Activation ACK error:", error);

    return res.status(500).json({
      error: "Erro interno ao confirmar ativação."
    });
  }
};
