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

    const auth = req.headers.authorization || "";
    const userToken = auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";

    if (!userToken) {
      return res.status(401).json({ error: "Faça login novamente" });
    }

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${userToken}`
      }
    });

    if (!userResponse.ok) {
      return res.status(401).json({ error: "Sessão inválida" });
    }

    const user = await userResponse.json();
    const metadata = user.user_metadata || {};
const suspendedUntil = metadata.zucker_suspended_until;
const suspensionTime = suspendedUntil
  ? new Date(suspendedUntil).getTime()
  : 0;

if (Number.isFinite(suspensionTime) && suspensionTime > Date.now()) {
  return res.status(403).json({
    error: "Sua conta está suspensa.",
    suspended: true,
    reason: metadata.zucker_suspension_reason || "Motivo não informado.",
    suspendedUntil
  });
}
    const deviceId = String(req.body?.deviceId || "");

    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
      return res.status(400).json({ error: "Dispositivo inválido" });
    }

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };

    // Busca o dispositivo pertencente ao usuário.
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${deviceId}` +
      `&user_id=eq.${user.id}` +
      `&select=id,status`,
      { headers }
    );

    if (!deviceResponse.ok) {
      throw new Error("Falha ao consultar dispositivo.");
    }

    const devices = await deviceResponse.json();

    if (!devices.length) {
      return res.status(404).json({
        error: "Dispositivo não encontrado."
      });
    }

    const previousStatus = devices[0].status;

    if (previousStatus === "unlink_pending") {
      return res.status(409).json({
        error: "Já existe uma desvinculação pendente."
      });
    }

    // Reserva a desvinculação antes de criar o comando.
    const lockResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${deviceId}` +
      `&user_id=eq.${user.id}` +
      `&status=neq.unlink_pending`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: "unlink_pending"
        })
      }
    );

    if (!lockResponse.ok) {
      throw new Error("Falha ao reservar desvinculação.");
    }

    const lockedDevices = await lockResponse.json();

    if (!lockedDevices.length) {
      return res.status(409).json({
        error: "A desvinculação já foi solicitada."
      });
    }

    // Cria o comando para o agente.
    const commandResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: user.id,
          device_id: deviceId,
          command: "unlink",
          status: "pending"
        })
      }
    );

    if (!commandResponse.ok) {
      // Se falhar, tenta restaurar o status anterior.
      await fetch(
        `${SUPABASE_URL}/rest/v1/devices` +
        `?id=eq.${deviceId}` +
        `&user_id=eq.${user.id}` +
        `&status=eq.unlink_pending`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: previousStatus
          })
        }
      );

      throw new Error("Falha ao criar comando.");
    }

    return res.status(200).json({
      success: true,
      message: "Pedido enviado. Aguardando o agente."
    });

  } catch (error) {
    console.error("Unlink request error:", error);

    return res.status(500).json({
      error: "Erro interno ao solicitar desvinculação."
    });
  }
};
