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
  '--disable-gpu'
];

const puppeteerOptions = {
  headless: true,
  args: puppeteerArgs
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
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
  client.initialize();
});

client.initialize();

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

// Obtener lista de grupos del WhatsApp conectado
app.get('/api/groups', async (req, res) => {
  if (botState.status !== 'CONNECTED') {
    return res.status(400).json({ error: 'El WhatsApp no está conectado todavía.' });
  }

  try {
    const chats = await client.getChats();
    const groups = chats
      .filter(chat => chat.isGroup)
      .map(group => ({
        id: group.id._serialized,
        name: group.name,
        participantsCount: group.participants ? group.participants.length : 0
      }));

    res.json({ groups });
  } catch (err) {
    console.error('Error al obtener grupos:', err);
    res.status(500).json({ error: 'Error al obtener grupos de WhatsApp: ' + err.message });
  }
});

// Guardar grupo de destino
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

  const targetGroupId = req.body.targetGroupId || (botState.targetGroup ? botState.targetGroup.id : null);
  if (!targetGroupId) {
    return res.status(400).json({ error: 'No se ha configurado un grupo de destino para enviar los mensajes.' });
  }

  const { tableNum, modeText, player1, player2, score1, score2, winner, isDraw, clubName, raceText } = req.body;

  const club = clubName || 'BilliardScore Club';
  const table = tableNum ? `MESA ${tableNum}` : 'MESA';
  const mode = modeText || 'Modo de Partida';
  const race = raceText ? `(${raceText})` : '';

  const now = new Date();
  const dateStr = `${now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let resultHeader = '';
  if (isDraw) {
    resultHeader = '🤝 *¡RESULTADO EN EMPATE!* 🤝';
  } else if (winner) {
    resultHeader = `🥇 *¡GANADOR: ${winner.toUpperCase()}!* 🏆`;
  } else {
    resultHeader = '📊 *BOLETÍN OFICIAL DE PARTIDA*';
  }

  const message = 
`🎱 *${club.toUpperCase()}* 🎱
-----------------------------------------
${resultHeader}

📍 *Ubicación:* ${table} ${race}
🎮 *Modalidad:* ${mode}

👤 *${(player1 || 'Jugador 1').toUpperCase()}:* ${score1 || 0} mesa(s)
👤 *${(player2 || 'Jugador 2').toUpperCase()}:* ${score2 || 0} mesa(s)
-----------------------------------------
📅 _${dateStr} | ${timeStr}_`;

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
});
