const crypto = require("crypto");

const SUPABASE_URL =
  "https://khkjlodngoahevxkxswj.supabase.co";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    const activationCode = String(
      req.body?.activationCode || ""
    ).trim();

    if (!/^\d{6}$/.test(activationCode)) {
      return res.status(400).json({
        error: "O código precisa ter exatamente 6 números."
      });
    }

    const activationSecret =
      crypto.randomBytes(32).toString("hex");

    const codeHash = crypto
      .createHash("sha256")
      .update(activationCode)
      .digest("hex");

    const secretHash = crypto
      .createHash("sha256")
      .update(activationSecret)
      .digest("hex");

    const expiresAt = new Date(
      Date.now() + 3 * 60 * 1000
    ).toISOString();

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_activations`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          activation_code_hash: codeHash,
          activation_secret_hash: secretHash,
          status: "pending",
          expires_at: expiresAt
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.length) {
      console.error("Erro Supabase:", data);

      return res.status(500).json({
        error: "Não foi possível registrar o código."
      });
    }

    return res.status(200).json({
      success: true,
      requestId: data[0].id,
      activationSecret,
      expiresAt
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Erro interno ao iniciar ativação."
    });
  }
};
