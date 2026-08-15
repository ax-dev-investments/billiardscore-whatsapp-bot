const DOM = {
  statusBadge: document.getElementById('status-badge'),
  statusText: document.getElementById('status-text'),
  qrSection: document.getElementById('qr-section'),
  qrImage: document.getElementById('qr-image'),
  connectedSection: document.getElementById('connected-section'),
  connectedPhoneVal: document.getElementById('connected-phone-val'),
  groupsSelect: document.getElementById('groups-select'),
  btnRefreshGroups: document.getElementById('btn-refresh-groups'),
  btnSaveGroup: document.getElementById('btn-save-group'),
  currentGroupBadge: document.getElementById('current-group-badge'),
  targetGroupName: document.getElementById('target-group-name'),
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

  if (status === 'AWAITING_QR') {
    DOM.statusText.textContent = 'ESCANEAR CÓDIGO QR';
    DOM.qrSection.classList.remove('hidden');
    DOM.connectedSection.classList.add('hidden');
    DOM.disconnectedSection.classList.add('hidden');

    if (data.qrCode) {
      DOM.qrImage.src = data.qrCode;
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
        opt.textContent = `${g.name} (${g.participantsCount} miembros)`;
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
  if (!currentTargetGroup) {
    alert("Primero debes seleccionar y guardar el grupo del club.");
    return;
  }

  try {
    const res = await fetch('/api/send-match-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableNum: 1,
        modeText: 'Modo Libre (Partida de Prueba)',
        player1: 'Alex',
        player2: 'Jugador Prueba',
        score1: 5,
        score2: 3,
        winner: 'Alex',
        isDraw: false,
        clubName: 'Billar Score LP9',
        raceText: 'Carrera a 5'
      })
    });
    const data = await res.json();

    if (data.success) {
      alert("🎉 ¡Mensaje de prueba publicado con éxito en el grupo de WhatsApp!");
    } else {
      alert("Error al enviar mensaje: " + data.error);
    }
  } catch (err) {
    alert("Error conectando con el servidor: " + err.message);
  }
}

// Bindings
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
