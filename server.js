const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { 
  makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado del Bot
const botState = {
  status: 'INITIALIZING',
  qrCode: null,
  pairingCode: null,
  connectedPhone: null,
  targetGroup: null
};

// Archivo de persistencia de configuración del grupo
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (data.targetGroup) {
        botState.targetGroup = data.targetGroup;
        console.log('📌 Grupo destino cargado:', botState.targetGroup.name);
      }
    }
  } catch (e) {
    console.error('Error al leer bot_config.json:', e);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ targetGroup: botState.targetGroup }, null, 2));
    console.log('💾 Configuración guardada en bot_config.json');
  } catch (e) {
    console.error('Error al guardar bot_config.json:', e);
  }
}

loadConfig();

let sock = null;

async function connectToWhatsApp(resetAuth = false) {
  try {
    const authPath = path.join(__dirname, '.baileys_auth');
    
    if (resetAuth && fs.existsSync(authPath)) {
      console.log('🧹 Limpiando credenciales antiguas para generar un nuevo código QR / Pairing...');
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
      } catch (e) {
        console.error('Error limpiando authPath:', e);
      }
    }

    if (!fs.existsSync(authPath)) {
      fs.mkdirSync(authPath, { recursive: true });
    }

    const authState = await useMultiFileAuthState(authPath);
    let version = [2, 3000, 1015901307];
    try {
      const vRes = await fetchLatestBaileysVersion();
      version = vRes.version;
    } catch (e) {
      console.warn('Usando versión Baileys por defecto:', e.message);
    }

    sock = makeWASocket({
      version,
      auth: authState.state,
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '110.0.5563.146']
    });

    sock.ev.on('creds.update', authState.saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('⚡ Nuevo Código QR generado.');
        try {
          botState.qrCode = await QRCode.toDataURL(qr);
          botState.status = 'AWAITING_QR';
        } catch (err) {
          console.error('Error generando DataURL del QR:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.warn('⚠️ Conexión de WhatsApp cerrada. Código:', statusCode);
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;
        botState.status = 'DISCONNECTED';
        botState.qrCode = null;
        botState.pairingCode = null;

        // Si se cerró sesión explícitamente, reseteamos credenciales. Si no, reconectamos normalmente.
        setTimeout(() => connectToWhatsApp(isLoggedOut), 3000);
      } else if (connection === 'open') {
        console.log('✅ Cliente de WhatsApp Conectado y Listo!');
        botState.status = 'CONNECTED';
        botState.qrCode = null;
        botState.pairingCode = null;
        botState.connectedPhone = sock.user ? sock.user.id.split(':')[0].split('@')[0] : 'Conectado';
      }
    });
  } catch (err) {
    console.error('❌ Error al iniciar Baileys:', err);
    botState.status = 'ERROR';
  }
}

connectToWhatsApp();

// ================= ROUTING & API =================

// Endpoint para solicitar código de vinculación por número de teléfono
app.post('/api/pairing-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Debes proporcionar un número de teléfono.' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 8) {
      return res.status(400).json({ error: 'Por favor ingresa un número de teléfono válido con código de país (Ej: 18091234567).' });
    }

    if (!sock) {
      return res.status(400).json({ error: 'El servidor bot no está listo aún. Intenta en unos segundos.' });
    }

    console.log(`📱 Solicitando Código de Vinculación para el número: ${cleanPhone}...`);
    const code = await sock.requestPairingCode(cleanPhone);
    const formattedCode = code ? code.match(/.{1,4}/g)?.join('-') || code : code;

    botState.pairingCode = formattedCode;
    botState.status = 'AWAITING_PAIRING_CODE';

    res.json({ success: true, pairingCode: formattedCode });
  } catch (err) {
    console.error('Error al generar código de vinculación:', err);
    res.status(500).json({ error: 'Error al solicitar código: ' + err.message });
  }
});

// Endpoint de reconexión forzada
app.post('/api/reconnect', async (req, res) => {
  try {
    console.log('🔄 Forzando regeneración de QR por solicitud del cliente...');
    botState.status = 'INITIALIZING';
    botState.qrCode = null;
    botState.pairingCode = null;
    connectToWhatsApp(true);
    res.json({ success: true, message: 'Generando nuevo código QR...' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Estado actual con auto-recuperación y soporte de reset por URL (?reset=true)
app.get('/api/status', (req, res) => {
  if (req.query.reset === 'true') {
    console.log('⚡ Reseteo de sesión detectado por URL...');
    botState.status = 'INITIALIZING';
    botState.qrCode = null;
    botState.pairingCode = null;
    botState.connectedPhone = null;
    connectToWhatsApp(true);
  }

  res.json({
    status: botState.status,
    qrCode: botState.qrCode,
    pairingCode: botState.pairingCode,
    connectedPhone: botState.connectedPhone,
    targetGroup: botState.targetGroup
  });
});

// Lista de grupos y contactos
app.get('/api/groups', async (req, res) => {
  if (botState.status !== 'CONNECTED' || !sock) {
    return res.status(400).json({ error: 'El WhatsApp no está conectado todavía.' });
  }

  try {
    const rawGroups = await sock.groupFetchAllParticipating();
    const groups = Object.values(rawGroups).map(g => ({
      id: g.id,
      name: `👥 [GRUPO] ${g.subject}`,
      isGroup: true,
      rawName: g.subject
    }));

    res.json({ groups });
  } catch (err) {
    console.error('Error al obtener grupos:', err);
    res.status(500).json({ error: 'Error al obtener grupos de WhatsApp: ' + err.message });
  }
});

// Guardar grupo o chat destino
app.post('/api/config', (req, res) => {
  const { targetGroup } = req.body;
  if (!targetGroup) {
    return res.status(400).json({ error: 'Se requiere targetGroup' });
  }

  botState.targetGroup = targetGroup;
  saveConfig();
  res.json({ success: true, targetGroup: botState.targetGroup });
});

// Enviar resultado de partido desde BilliardScore
function formatWhatsAppJid(phoneStr) {
  if (!phoneStr) return null;
  let digits = String(phoneStr).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) {
    digits = '1' + digits;
  }
  return `${digits}@s.whatsapp.net`;
}

app.post('/api/send-match-result', async (req, res) => {
  if (botState.status !== 'CONNECTED' || !sock) {
    return res.status(400).json({ error: 'El servidor bot no está conectado a WhatsApp.' });
  }

  const {
    tableNum, modeText, player1, player2, score1, score2, winner, isDraw, raceTo, rawMessage,
    customTargetPhone, player1Phone, player2Phone
  } = req.body;

  let message = rawMessage;
  if (!message) {
    const p1 = player1 || 'Jugador 1';
    const p2 = player2 || 'Jugador 2';
    const s1 = score1 !== undefined ? score1 : 0;
    const s2 = score2 !== undefined ? score2 : 0;

    if (isDraw || winner === 'EMPATE') {
      message = `Serie Libre, ${p1} (${s1}) vs ${p2} (${s2}) - EMPATE`;
    } else if (raceTo === 'libre' || (!raceTo && !winner)) {
      if (winner) {
        message = `Serie Libre, ${p1} (${s1}) vs ${p2} (${s2}) - Ganador: ${winner}`;
      } else {
        message = `Serie Libre, ${p1} (${s1}) vs ${p2} (${s2})`;
      }
    } else if (raceTo === 1 || raceTo === '1') {
      message = `${p1} vs ${p2} - Ganador: ${winner || p1}`;
    } else {
      const raceNum = String(raceTo).replace(/[^\d]/g, '') || raceTo || '5';
      message = `Serie: ${raceNum}P, ${p1} (${s1}) vs ${p2} (${s2}) - Ganador: ${winner || p1}`;
    }
  }

  try {
    // 1. MODO PRUEBAS: Si se especificó customTargetPhone, enviar ÚNICAMENTE a ese número personal
    if (customTargetPhone) {
      const jid = formatWhatsAppJid(customTargetPhone);
      if (jid) {
        await sock.sendMessage(jid, { text: message });
        console.log(`🧪 Resultado de prueba enviado a número personal: ${jid}`);
        return res.json({ success: true, message: 'Enviado a número personal de pruebas' });
      }
    }

    // 2. MODO PRODUCCIÓN: Enviar al Grupo del Club y a los números privados de los jugadores
    const delivered = [];

    // 2a. Enviar al Grupo del Club
    const groupJid = req.body.targetGroupId || (botState.targetGroup ? botState.targetGroup.id : null);
    if (groupJid) {
      try {
        await sock.sendMessage(groupJid, { text: message });
        console.log(`📢 Resultado publicado en el grupo del club: ${groupJid}`);
        delivered.push('Grupo del Club');
      } catch (errGroup) {
        console.error('Error enviando al grupo del club:', errGroup.message);
      }
    }

    // 2b. Enviar a Jugador 1 (si tiene teléfono guardado)
    if (player1Phone) {
      const jidP1 = formatWhatsAppJid(player1Phone);
      if (jidP1) {
        try {
          await sock.sendMessage(jidP1, { text: message });
          console.log(`📱 Resultado enviado a ${player1} (${jidP1})`);
          delivered.push(`Jugador 1 (${player1})`);
        } catch (errP1) {
          console.error(`Error enviando a ${player1}:`, errP1.message);
        }
      }
    }

    // 2c. Enviar a Jugador 2 (si tiene teléfono guardado)
    if (player2Phone) {
      const jidP2 = formatWhatsAppJid(player2Phone);
      if (jidP2) {
        try {
          await sock.sendMessage(jidP2, { text: message });
          console.log(`📱 Resultado enviado a ${player2} (${jidP2})`);
          delivered.push(`Jugador 2 (${player2})`);
        } catch (errP2) {
          console.error(`Error enviando a ${player2}:`, errP2.message);
        }
      }
    }

    if (delivered.length > 0) {
      return res.json({ success: true, deliveredTo: delivered });
    } else {
      return res.status(400).json({ error: 'No se configuró un grupo ni teléfonos válidos de jugadores.' });
    }

  } catch (err) {
    console.error('Error enviando mensaje a WhatsApp:', err);
    return res.status(500).json({ error: 'Error al enviar mensaje a WhatsApp: ' + err.message });
  }
});

// Servidor escuchando en 0.0.0.0 para compatibilidad con el proxy de Render Cloud
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🤖 BilliardScore WhatsApp Bot (Baileys Engine) iniciado en puerto ${PORT}`);
  console.log(`🌐 Panel de Control: http://localhost:${PORT}`);
  console.log(`====================================================`);

  // Auto-ping cada 10 minutos para mantener Render activo 24/7
  setInterval(() => {
    fetch('https://billiardscore-whatsapp-bot.onrender.com/api/status')
      .then(() => console.log('⏰ Keep-alive ping a Render Cloud exitoso'))
      .catch(err => console.log('Keep-alive ping:', err.message));
  }, 10 * 60 * 1000);
});
