const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Estado Global del Bot
let botState = {
  status: 'INITIALIZING', // INITIALIZING, AWAITING_QR, CONNECTED, DISCONNECTED
  qrCode: null,
  connectedPhone: null,
  targetGroup: null
};

// Cargar configuración guardada
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      botState.targetGroup = data.targetGroup || null;
    } catch (e) {
      console.error('Error al leer bot_config.json:', e);
    }
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ targetGroup: botState.targetGroup }, null, 2));
  } catch (e) {
    console.error('Error al guardar bot_config.json:', e);
  }
}

loadConfig();

const puppeteerArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--single-process',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-extensions',
  '--mute-audio',
  '--js-flags=--max-old-space-size=256'
];

function getChromeExecutablePath() {
  const possiblePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];

  for (const p of possiblePaths) {
    if (p && fs.existsSync(p)) {
      console.log(`📌 Usando ejecutable de Chrome en: ${p}`);
      return p;
    }
  }
  console.log('📌 Usando ejecutable por defecto de Puppeteer');
  return undefined;
}

const puppeteerOptions = {
  headless: true,
  args: puppeteerArgs
};

const chromePath = getChromeExecutablePath();
if (chromePath) {
  puppeteerOptions.executablePath = chromePath;
}

// Inicializar Cliente WhatsApp Web
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: puppeteerOptions
});

client.on('qr', async (qr) => {
  console.log('⚡ Nuevo Código QR generado.');
  try {
    botState.qrCode = await QRCode.toDataURL(qr);
    botState.status = 'AWAITING_QR';
  } catch (err) {
    console.error('Error generando DataURL del QR:', err);
  }
});

client.on('ready', async () => {
  console.log('✅ Cliente de WhatsApp Conectado y Listo!');
  botState.status = 'CONNECTED';
  botState.qrCode = null;
  if (client.info) {
    botState.connectedPhone = client.info.wid.user;
  }
});

client.on('authenticated', () => {
  console.log('🔑 WhatsApp Autenticado correctamente.');
});

client.on('auth_failure', (msg) => {
  console.error('❌ Error de Autenticación WhatsApp:', msg);
  botState.status = 'DISCONNECTED';
  botState.qrCode = null;
});

client.on('disconnected', (reason) => {
  console.warn('⚠️ WhatsApp Desconectado:', reason);
  botState.status = 'DISCONNECTED';
  botState.qrCode = null;
  client.initialize().catch(err => console.error('Error al reconectar:', err));
});

client.initialize().catch(err => {
  console.error('❌ Error al inicializar cliente de WhatsApp Web:', err);
  botState.status = 'ERROR';
});

// ================= ROUTING & API =================

// Obtener estado actual del bot
app.get('/api/status', (req, res) => {
  res.json({
    status: botState.status,
    qrCode: botState.qrCode,
    connectedPhone: botState.connectedPhone,
    targetGroup: botState.targetGroup
  });
});

// Obtener lista de grupos y chats del WhatsApp conectado
app.get('/api/groups', async (req, res) => {
  if (botState.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'El WhatsApp no está conectado todavía.' });
  }

  try {
    const chats = await client.getChats();
    const groups = chats.map(chat => ({
      id: chat.id._serialized,
      name: chat.isGroup ? `👥 [GRUPO] ${chat.name}` : `📱 [CHAT PERSONAL] ${chat.name || chat.id.user}`,
      isGroup: chat.isGroup,
      rawName: chat.name || chat.id.user
    }));

    res.json({ groups });
  } catch (err) {
    console.error('Error al obtener grupos:', err);
    res.status(500).json({ error: 'Error al obtener grupos de WhatsApp: ' + err.message });
  }
});

// Guardar grupo o chat de destino
app.post('/api/config', (req, res) => {
  const { targetGroup } = req.body;
  if (!targetGroup) {
    return res.status(400).json({ error: 'Se requiere targetGroup' });
  }

  botState.targetGroup = targetGroup;
  saveConfig();
  res.json({ success: true, targetGroup: botState.targetGroup });
});

// Enviar mensaje de resultado de partido desde BilliardScore
app.post('/api/send-match-result', async (req, res) => {
  if (botState.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'El servidor bot no está conectado a WhatsApp.' });
  }

  let targetGroupId = req.body.customTargetPhone || req.body.targetGroupId || (botState.targetGroup ? botState.targetGroup.id : null);
  
  if (targetGroupId && !targetGroupId.includes('@')) {
    // Si se pasa un número de teléfono (ej: 18491234567), formatear como JID de WhatsApp
    targetGroupId = `${targetGroupId.replace(/[^\d]/g, '')}@c.us`;
  }

  if (!targetGroupId) {
    return res.status(400).json({ error: 'No se ha configurado un destino (grupo o número) para enviar los mensajes.' });
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
    await client.sendMessage(targetGroupId, message);
    console.log(`💬 Mensaje enviado exitosamente al grupo ${targetGroupId}`);
    res.json({ success: true, message: 'Mensaje publicado en WhatsApp con éxito.' });
  } catch (err) {
    console.error('Error enviando mensaje a WhatsApp:', err);
    res.status(500).json({ error: 'Error al enviar mensaje a WhatsApp: ' + err.message });
  }
});

// Servidor escuchando
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🤖 BilliardScore WhatsApp Bot iniciado en puerto ${PORT}`);
  console.log(`🌐 Panel de Control: http://localhost:${PORT}`);
  console.log(`====================================================`);

  // Auto-ping cada 10 minutos para mantener el contenedor en Render despierto 24/7
  setInterval(() => {
    fetch('https://billiardscore-whatsapp-bot.onrender.com/api/status')
      .then(() => console.log('⏰ Keep-alive ping a Render Cloud exitoso'))
      .catch(err => console.log('Keep-alive ping:', err.message));
  }, 10 * 60 * 1000);
});
