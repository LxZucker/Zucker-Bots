
const crypto = require("crypto");

const SUPABASE_URL = "https://khkjlodngoahevxkxswj.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    const deviceId = String(req.body?.deviceId || "");
    const token = String(req.headers.authorization || "")
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!deviceId || !token) {
      return res.status(400).json({
        error: "Dados obrigatórios ausentes."
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

    // 1. Confere a autorização do dispositivo.
    const deviceResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/devices` +
      `?id=eq.${encodeURIComponent(deviceId)}` +
      `&agent_token_hash=eq.${tokenHash}` +
      `&select=id,user_id,status`,
      { headers }
    );

    if (!deviceResponse.ok) {
      throw new Error("Falha ao verificar dispositivo.");
    }

    const devices = await deviceResponse.json();

    if (!devices.length) {
      return res.status(401).json({
        error: "Agente não autorizado."
      });
    }

    const device = devices[0];

    // 2. Recebe e registra logs.
    if (req.body?.action === "log") {
      const command = String(req.body.command || "")
        .trim()
        .toLowerCase();

      const status = String(req.body.status || "");

      if (!/^(?:(?:pv|gp):)?[a-z0-9_-]{1,40}$/.test(command)) {
        return res.status(400).json({
          error: "Comando inválido."
        });
      }

      if (!["executed", "failed"].includes(status)) {
        return res.status(400).json({
          error: "Status inválido."
        });
      }

      const logResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/command_logs`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=minimal"
          },
          body: JSON.stringify({
            user_id: device.user_id,
            device_id: device.id,
            command,
            status
          })
        }
      );

      if (!logResponse.ok) {
        throw new Error("Não foi possível salvar o log.");
      }

      return res.status(200).json({
        success: true
      });
    }

    // 3. Busca as configurações completas do bot.
    let prefix = "#";
    let ownerNumber = null;
    let settingsSync = null;

    const settingsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/bot_settings` +
      `?user_id=eq.${encodeURIComponent(device.user_id)}` +
      `&select=` +
      `prefix,owner_number,custom_functions,custom_functions_gp,` +
      `bot_pv_enabled,bot_gp_enabled,` +
      `pv_unknown_message,gp_unknown_message,` +
      `pv_owner_cooldown,pv_user_cooldown,` +
      `gp_owner_cooldown,gp_user_cooldown,` +
      `gp_all_groups,gp_selected_groups,` +
      `divulgacao_enabled,divulgacao_config,divulgacao_commands,` +
      `divulgacao_updated_at,` +
      `auto_reply_enabled,auto_reply_message,auto_reply_cooldown_minutes,` +
      `updated_at` +
      `&limit=1`,
      { headers }
    );

    if (!settingsResponse.ok) {
      throw new Error("Falha ao consultar configurações.");
    }

    const settings = await settingsResponse.json();

    if (settings.length) {
      const saved = settings[0];

      if (
        typeof saved.prefix === "string" &&
        saved.prefix.length > 0 &&
        saved.prefix.length <= 3 &&
        !/\s/.test(saved.prefix)
      ) {
        prefix = saved.prefix;
      }

      ownerNumber = saved.owner_number || null;

      // Envia todas as configurações para o agente.
      // A revisão permite evitar sincronizações repetidas.
      if (saved.updated_at) {
        settingsSync = {
          revision: saved.updated_at,

          // Comandos PV.
          customFunctions: Array.isArray(saved.custom_functions)
            ? saved.custom_functions
            : [],

          // Comandos GP.
          customFunctionsGP: Array.isArray(saved.custom_functions_gp)
            ? saved.custom_functions_gp
            : [],

          // Ativação dos bots.
          botPvEnabled: saved.bot_pv_enabled !== false,
          botGpEnabled: saved.bot_gp_enabled === true,

          // Mensagens para comandos inexistentes.
          pvUnknownMessage: saved.pv_unknown_message || "",
          gpUnknownMessage: saved.gp_unknown_message || "",

          // Cooldowns independentes.
          pvOwnerCooldown: saved.pv_owner_cooldown ?? 1,
          pvUserCooldown: saved.pv_user_cooldown ?? 1,

          gpOwnerCooldown: saved.gp_owner_cooldown ?? 1,
          gpUserCooldown: saved.gp_user_cooldown ?? 1,

          // Seleção de grupos.
          gpAllGroups: saved.gp_all_groups !== false,

          gpSelectedGroups: Array.isArray(saved.gp_selected_groups)
            ? saved.gp_selected_groups
            : [],

          // Resposta automática em PV.
          autoReplyEnabled: saved.auto_reply_enabled === true,
          autoReplyMessage: String(saved.auto_reply_message || ""),
          autoReplyCooldownMinutes:
            saved.auto_reply_cooldown_minutes ?? 60,

          // Configurações independentes da divulgação.
          divulgacaoEnabled: saved.divulgacao_enabled === true,

          divulgacaoConfig:
            saved.divulgacao_config &&
            typeof saved.divulgacao_config === "object"
              ? saved.divulgacao_config
              : { sections: [] },

          divulgacaoCommands: Array.isArray(saved.divulgacao_commands)
            ? saved.divulgacao_commands
            : [],

          divulgacaoUpdatedAt: saved.divulgacao_updated_at || null
        };
      }
    }

    // 4. Procura comandos pendentes do dispositivo.
    const commandResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_commands` +
      `?device_id=eq.${encodeURIComponent(deviceId)}` +
      `&user_id=eq.${encodeURIComponent(device.user_id)}` +
      `&status=eq.pending` +
      `&select=id,command,created_at` +
      `&order=created_at.asc&limit=1`,
      { headers }
    );

    if (!commandResponse.ok) {
      throw new Error("Falha ao consultar comandos.");
    }

    const commands = await commandResponse.json();

    return res.status(200).json({
      success: true,

      hasCommand: commands.length > 0,

      ...(commands.length
        ? {
            commandId: commands[0].id,
            command: commands[0].command
          }
        : {}),

      prefix,
      ownerNumber,
      settingsSync
    });

  } catch (error) {
    console.error("Command poll error:", error);

    return res.status(500).json({
      error: "Erro ao consultar comandos."
    });
  }
};
      
