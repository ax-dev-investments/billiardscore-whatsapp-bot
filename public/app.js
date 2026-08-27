const DOM = {
  statusBadge: document.getElementById('status-badge'),
  statusText: document.getElementById('status-text'),
  qrSection: document.getElementById('qr-section'),
  qrImage: document.getElementById('qr-image'),
  pairingPhoneInput: document.getElementById('pairing-phone-input'),
  btnGetPairingCode: document.getElementById('btn-get-pairing-code'),
  pairingCodeDisplay: document.getElementById('pairing-code-display'),
  pairingCodeVal: document.getElementById('pairing-code-val'),
  connectedSection: document.getElementById('connected-section'),
  connectedPhoneVal: document.getElementById('connected-phone-val'),
  groupsSelect: document.getElementById('groups-select'),
  btnRefreshGroups: document.getElementById('btn-refresh-groups'),
  btnSaveGroup: document.getElementById('btn-save-group'),
  currentGroupBadge: document.getElementById('current-group-badge'),
  targetGroupName: document.getElementById('target-group-name'),
  chkTestPersonalPhone: document.getElementById('chk-test-personal-phone'),
  testPhoneBox: document.getElementById('test-phone-box'),
  testPersonalPhoneInput: document.getElementById('test-personal-phone-input'),
  btnSendTestMsg: document.getElementById('btn-send-test-msg'),
  disconnectedSection: document.getElementById('disconnected-section')
};

let cachedGroups = [];
let currentTargetGroup = null;

async function checkStatus() {
  try {
    const isReset = window.location.search.includes('reset=true');
    const url = isReset ? '/api/status?reset=true' : '/api/status';

    if (isReset) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const res = await fetch(url);
    const data = await res.json();

    updateStatusUI(data);
  } catch (err) {
    console.error('Error obteniendo estado del bot:', err);
    setDisconnectedUI();
  }
}

function updateStatusUI(data) {
  const status = data.status;
  currentTargetGroup = data.targetGroup;

  DOM.statusBadge.className = 'status-badge ' + status.toLowerCase();

  if (status === 'AWAITING_QR' || status === 'AWAITING_PAIRING_CODE' || status === 'INITIALIZING') {
    DOM.statusText.textContent = status === 'AWAITING_PAIRING_CODE' ? 'INGRESAR CÓDIGO EN EN TELEFONO' : 'ESCANEAR QR / CÓDIGO';
    DOM.qrSection.classList.remove('hidden');
    DOM.connectedSection.classList.add('hidden');
    DOM.disconnectedSection.classList.add('hidden');

    if (data.qrCode) {
      DOM.qrImage.src = data.qrCode;
    }

    if (data.pairingCode) {
      DOM.pairingCodeDisplay.classList.remove('hidden');
      DOM.pairingCodeVal.textContent = data.pairingCode;
    }
  } else if (status === 'CONNECTED') {
    DOM.statusText.textContent = 'CONECTADO';
    DOM.qrSection.classList.add('hidden');
    DOM.connectedSection.classList.remove('hidden');
    DOM.disconnectedSection.classList.add('hidden');

    DOM.connectedPhoneVal.textContent = data.connectedPhone ? `+${data.connectedPhone}` : 'WhatsApp Activo';

    if (currentTargetGroup) {
      DOM.currentGroupBadge.classList.remove('hidden');
      DOM.targetGroupName.textContent = currentTargetGroup.name;
    } else {
      DOM.currentGroupBadge.classList.add('hidden');
    }

    if (cachedGroups.length === 0) {
      loadGroups();
    }
  } else if (status === 'DISCONNECTED') {
    setDisconnectedUI();
  } else {
    DOM.statusText.textContent = 'INICIALIZANDO...';
  }
}

function setDisconnectedUI() {
  DOM.statusBadge.className = 'status-badge disconnected';
  DOM.statusText.textContent = 'DESCONECTADO';
  DOM.qrSection.classList.add('hidden');
  DOM.connectedSection.classList.add('hidden');
  DOM.disconnectedSection.classList.remove('hidden');
}

async function requestPairingCode() {
  const phoneVal = (DOM.pairingPhoneInput ? DOM.pairingPhoneInput.value : '').trim();
  if (!phoneVal) {
    alert("Por favor ingresa tu número de WhatsApp con código de país (Ej: 18091234567).");
    return;
  }

  DOM.btnGetPairingCode.disabled = true;
  DOM.btnGetPairingCode.textContent = "⏳ SOLICITANDO...";

  try {
    const res = await fetch('/api/pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneVal })
    });
    const data = await res.json();

    if (data.success && data.pairingCode) {
      DOM.pairingCodeDisplay.classList.remove('hidden');
      DOM.pairingCodeVal.textContent = data.pairingCode;
      alert(`🔑 Código generado: ${data.pairingCode}\n\nEn tu celular ve a WhatsApp ➔ Dispositivos vinculados ➔ Vincular con el número de teléfono e ingresa este código.`);
    } else {
      alert("Error al solicitar código: " + (data.error || 'Error desconocido'));
    }
  } catch (err) {
    alert("Error de red: " + err.message);
  } finally {
    DOM.btnGetPairingCode.disabled = false;
    DOM.btnGetPairingCode.textContent = "🔑 GENERAR CÓDIGO";
  }
}

async function loadGroups() {
  DOM.groupsSelect.innerHTML = '<option value="">Cargando grupos de WhatsApp...</option>';
  try {
    const res = await fetch('/api/groups');
    const data = await res.json();

    if (data.groups && Array.isArray(data.groups)) {
      cachedGroups = data.groups;
      DOM.groupsSelect.innerHTML = '<option value="">-- SELECCIONAR UN GRUPO --</option>';

      cachedGroups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.rawName ? `👥 [GRUPO] ${g.rawName}` : g.name;
        if (currentTargetGroup && currentTargetGroup.id === g.id) {
          opt.selected = true;
        }
        DOM.groupsSelect.appendChild(opt);
      });
    } else {
      DOM.groupsSelect.innerHTML = '<option value="">No se encontraron grupos</option>';
    }
  } catch (err) {
    console.error('Error cargando grupos:', err);
    DOM.groupsSelect.innerHTML = '<option value="">Error cargando grupos</option>';
  }
}

async function saveGroupSelection() {
  const selectedId = DOM.groupsSelect.value;
  if (!selectedId) {
    alert("Por favor selecciona un grupo de la lista.");
    return;
  }

  const groupObj = cachedGroups.find(g => g.id === selectedId);
  if (!groupObj) return;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetGroup: groupObj })
    });
    const data = await res.json();

    if (data.success) {
      alert(`¡Grupo (${groupObj.name}) configurado exitosamente para el club!`);
      checkStatus();
    } else {
      alert("Error al guardar configuración: " + data.error);
    }
  } catch (err) {
    alert("Error al conectar con el servidor: " + err.message);
  }
}

async function sendTestMessage() {
  const isPersonalTest = DOM.chkTestPersonalPhone ? DOM.chkTestPersonalPhone.checked : false;
  const personalPhone = DOM.testPersonalPhoneInput ? DOM.testPersonalPhoneInput.value.trim() : '';

  if (isPersonalTest) {
    if (!personalPhone) {
      alert("Por favor ingresa tu número de teléfono personal para enviar la prueba.");
      return;
    }
  } else {
    if (!currentTargetGroup) {
      alert("Primero debes seleccionar y guardar el grupo del club (o activar el cotejo para enviar a tu número personal).");
      return;
    }
  }

  try {
    const payload = {
      tableNum: 1,
      modeText: 'Modo Libre (Partida de Prueba)',
      player1: 'Alex',
      player2: 'Jugador Retador',
      score1: 5,
      score2: 3,
      winner: 'Alex',
      isDraw: false,
      rawMessage: '🧪 DEMOSTRACIÓN DE PRUEBA: Serie: 5P, Jugador Retador (3) vs Alex (5) - Ganador: Alex'
    };

    if (isPersonalTest && personalPhone) {
      payload.customTargetPhone = personalPhone;
    }

    const res = await fetch('/api/send-match-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      if (isPersonalTest) {
        alert(`🎉 ¡Mensaje de prueba enviado exitosamente a tu WhatsApp personal (+${personalPhone})!`);
      } else {
        alert("🎉 ¡Mensaje de prueba publicado con éxito en el grupo del club de WhatsApp!");
      }
    } else {
      alert("Error al enviar mensaje: " + data.error);
    }
  } catch (err) {
    alert("Error conectando con el servidor: " + err.message);
  }
}

function formatPhoneNumber(val) {
  if (!val) return '';
  let digits = val.replace(/\D/g, '');
  if (digits.length > 11) digits = digits.substring(0, 11);

  if (digits.length <= 3) {
    return digits;
  } else if (digits.length <= 6) {
    return `${digits.substring(0, 3)}-${digits.substring(3)}`;
  } else if (digits.length <= 10) {
    return `${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6)}`;
  } else {
    return `${digits.substring(0, 1)}-${digits.substring(1, 4)}-${digits.substring(4, 7)}-${digits.substring(7)}`;
  }
}

// Bindings
if (DOM.pairingPhoneInput) {
  DOM.pairingPhoneInput.addEventListener('input', (e) => {
    e.target.value = formatPhoneNumber(e.target.value);
  });
}

if (DOM.testPersonalPhoneInput) {
  DOM.testPersonalPhoneInput.addEventListener('input', (e) => {
    e.target.value = formatPhoneNumber(e.target.value);
  });
}

if (DOM.btnGetPairingCode) DOM.btnGetPairingCode.addEventListener('click', requestPairingCode);
if (DOM.chkTestPersonalPhone) {
  DOM.chkTestPersonalPhone.addEventListener('change', () => {
    if (DOM.chkTestPersonalPhone.checked) {
      DOM.testPhoneBox.classList.remove('hidden');
    } else {
      DOM.testPhoneBox.classList.add('hidden');
    }
  });
}
DOM.btnRefreshGroups.addEventListener('click', loadGroups);
DOM.btnSaveGroup.addEventListener('click', saveGroupSelection);
DOM.btnSendTestMsg.addEventListener('click', sendTestMessage);
DOM.btnReconnectManual = document.getElementById('btn-reconnect-manual');

if (DOM.btnReconnectManual) {
  DOM.btnReconnectManual.addEventListener('click', async () => {
    DOM.btnReconnectManual.disabled = true;
    DOM.btnReconnectManual.textContent = "⏳ Generando QR...";
    try {
      const res = await fetch('/api/reconnect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        checkStatus();
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      alert("Error de conexión: " + err.message);
    } finally {
      DOM.btnReconnectManual.disabled = false;
      DOM.btnReconnectManual.textContent = "🔄 GENERAR NUEVO CÓDIGO QR";
    }
  });
}

// Polling cada 3 segundos para actualización de estado/QR
checkStatus();
setInterval(checkStatus, 3000);
