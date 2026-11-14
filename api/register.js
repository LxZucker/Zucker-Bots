
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método não permitido"
    });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Servidor não configurado." });
    }

    const { username, password, confirmPassword } = req.body || {};

    const name = String(username || "").trim().toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(name)) {
      return res.status(400).json({
        error: "Usuário deve ter de 3 a 20 caracteres, usando letras, números ou _."
      });
    }

    if (!password || password.length < 8) {
      return res.status(400).json({
        error: "A senha precisa ter pelo menos 8 caracteres."
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        error: "As senhas não coincidem."
      });
    }

    const email = `${name}@login.zuckerbot.invalid`;

    const response = await fetch(
      "https://khkjlodngoahevxkxswj.supabase.co/auth/v1/admin/users",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username: name
          },
          app_metadata: {
            zucker_access_control_version: 1,
            zucker_valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            zucker_validity_type: "trial",
            zucker_validity_trial_granted_at: new Date().toISOString(),
            zucker_validity_renewal_count: 0
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(400).json({
        error: response.status === 422
          ? "Esse nome de usuário já está em uso."
          : "Não foi possível criar a conta."
      });
    }

    return res.status(201).json({
      success: true,
      message: "Conta criada com sucesso!"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Erro interno ao criar a conta."
    });
  }
};
