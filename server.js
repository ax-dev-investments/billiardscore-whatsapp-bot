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
app.post('/api/send-match-result', async (req, res) => {
  if (botState.status !== 'CONNECTED' || !sock) {
    return res.status(400).json({ error: 'El servidor bot no está conectado a WhatsApp.' });
  }

  let targetId = req.body.customTargetPhone || req.body.targetGroupId || (botState.targetGroup ? botState.targetGroup.id : null);
  
  if (!targetId) {
    return res.status(400).json({ error: 'No se ha configurado un destino (grupo o número) para enviar los mensajes.' });
  }

  // Formatear JID de WhatsApp
  let jid = targetId.trim();
  if (!jid.includes('@')) {
    const cleanDigits = jid.replace(/\D/g, '');
    jid = `${cleanDigits}@s.whatsapp.net`;
  }

  const { tableNum, modeText, player1, player2, score1, score2, winner, isDraw, raceTo, rawMessage } = req.body;

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
    await sock.sendMessage(jid, { text: message });
    console.log(`💬 Mensaje enviado exitosamente a ${jid}`);
    res.json({ success: true, message: 'Mensaje publicado en WhatsApp con éxito.' });
  } catch (err) {
    console.error('Error enviando mensaje a WhatsApp:', err);
    res.status(500).json({ error: 'Error al enviar mensaje a WhatsApp: ' + err.message });
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
