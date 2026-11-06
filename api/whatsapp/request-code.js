const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const auth = req.headers.authorization;

    if (!auth) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: auth
      }
    });

    if (!userResponse.ok) {
      return res.status(401).json({ error: "Sessão inválida" });
    }

    const user = await userResponse.json();
    const phone = String(req.body?.phone || "").replace(/\D/g, "");

    if (!/^\d{12,13}$/.test(phone)) {
      return res.status(400).json({ error: "Número inválido. Use DDI + DDD + número." });
    }

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
          phone_number: phone,
          status: "pending"
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
    return res.status(500).json({ error: "Erro interno ao solicitar conexão." });
  }
}
