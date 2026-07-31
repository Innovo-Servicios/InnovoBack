(function () {
  const TOKEN_KEY = 'gpi.whatsappPanelToken';
  const POLL_MS = 5000;

  const elements = {
    statusPill: document.getElementById('statusPill'),
    tokenPanel: document.getElementById('tokenPanel'),
    tokenInput: document.getElementById('tokenInput'),
    saveTokenButton: document.getElementById('saveTokenButton'),
    clearTokenButton: document.getElementById('clearTokenButton'),
    tokenNotice: document.getElementById('tokenNotice'),
    refreshButton: document.getElementById('refreshButton'),
    initializeButton: document.getElementById('initializeButton'),
    restartButton: document.getElementById('restartButton'),
    accountValue: document.getElementById('accountValue'),
    recipientValue: document.getElementById('recipientValue'),
    authPathValue: document.getElementById('authPathValue'),
    readyAtValue: document.getElementById('readyAtValue'),
    errorValue: document.getElementById('errorValue'),
    qrImage: document.getElementById('qrImage'),
    qrEmpty: document.getElementById('qrEmpty'),
    qrTimeValue: document.getElementById('qrTimeValue'),
    sendForm: document.getElementById('sendForm'),
    recipientInput: document.getElementById('recipientInput'),
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton'),
    sendNotice: document.getElementById('sendNotice'),
  };

  let pollTimer = null;
  let isLoading = false;

  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';

  const setNotice = (element, message, kind) => {
    if (!element) return;

    if (!message) {
      element.textContent = '';
      element.className = 'notice hidden';
      return;
    }

    element.textContent = message;
    element.className = `notice ${kind || ''}`.trim();
  };

  const formatValue = (value) => {
    if (value === null || value === undefined || value === '') {
      return '-';
    }

    return String(value);
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(date);
  };

  const setStatusPill = (status, kind) => {
    elements.statusPill.textContent = status;
    elements.statusPill.className = `status-pill ${kind || ''}`.trim();
  };

  const setButtonsDisabled = (disabled) => {
    [
      elements.refreshButton,
      elements.initializeButton,
      elements.restartButton,
      elements.sendButton,
    ].forEach((button) => {
      if (button) button.disabled = disabled;
    });
  };

  const apiFetch = async (path, options) => {
    const token = getToken();
    if (!token) {
      throw new Error('Token requerido');
    }

    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options && options.headers ? options.headers : {}),
      },
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      const message = payload && (payload.error || payload.message)
        ? payload.error || payload.message
        : `HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload;
  };

  const renderStatus = (status) => {
    if (!status.enabled) {
      setStatusPill('Deshabilitado', 'danger');
    } else if (status.ready) {
      setStatusPill('Listo', 'ok');
    } else if (status.initializing) {
      setStatusPill('Inicializando', 'warn');
    } else if (status.qr) {
      setStatusPill('QR pendiente', 'warn');
    } else if (status.lastError) {
      setStatusPill('Error', 'danger');
    } else {
      setStatusPill('Sin iniciar', 'warn');
    }

    const account = status.account
      ? [status.account.pushname, status.account.wid, status.account.platform].filter(Boolean).join(' / ')
      : null;

    elements.accountValue.textContent = formatValue(account);
    elements.recipientValue.textContent = formatValue(status.recipientChatId);
    elements.authPathValue.textContent = formatValue(status.authPath);
    elements.readyAtValue.textContent = formatDateTime(status.readyAt);
    elements.errorValue.textContent = formatValue(status.lastError);

    if (status.qr && status.qr.imageDataUrl) {
      elements.qrImage.src = status.qr.imageDataUrl;
      elements.qrImage.classList.remove('hidden');
      elements.qrEmpty.classList.add('hidden');
      elements.qrTimeValue.textContent = formatDateTime(status.qr.updatedAt);
    } else {
      elements.qrImage.removeAttribute('src');
      elements.qrImage.classList.add('hidden');
      elements.qrEmpty.classList.remove('hidden');
      elements.qrTimeValue.textContent = '-';
    }
  };

  const refreshStatus = async () => {
    if (!getToken() || isLoading) return;

    isLoading = true;
    setButtonsDisabled(true);
    try {
      const status = await apiFetch('/whatsapp-web/api/status');
      renderStatus(status);
      setNotice(elements.tokenNotice, '', '');
    } catch (error) {
      setStatusPill('Sin acceso', 'danger');
      setNotice(elements.tokenNotice, error.message, 'danger');
    } finally {
      isLoading = false;
      setButtonsDisabled(false);
    }
  };

  const startPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refreshStatus, POLL_MS);
  };

  const performStatusAction = async (path) => {
    if (isLoading) return;

    isLoading = true;
    setButtonsDisabled(true);
    setNotice(elements.tokenNotice, '', '');
    try {
      const status = await apiFetch(path, { method: 'POST', body: '{}' });
      renderStatus(status);
    } catch (error) {
      setNotice(elements.tokenNotice, error.message, 'danger');
    } finally {
      isLoading = false;
      setButtonsDisabled(false);
    }
  };

  elements.saveTokenButton.addEventListener('click', () => {
    const token = elements.tokenInput.value.trim();
    if (!token) {
      setNotice(elements.tokenNotice, 'Token requerido', 'warn');
      return;
    }

    localStorage.setItem(TOKEN_KEY, token);
    elements.tokenInput.value = '';
    setNotice(elements.tokenNotice, '', '');
    refreshStatus();
    startPolling();
  });

  elements.clearTokenButton.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    setStatusPill('Sin token', '');
    setNotice(elements.tokenNotice, '', '');
    elements.accountValue.textContent = '-';
    elements.recipientValue.textContent = '-';
    elements.authPathValue.textContent = '-';
    elements.readyAtValue.textContent = '-';
    elements.errorValue.textContent = '-';
    elements.qrImage.removeAttribute('src');
    elements.qrImage.classList.add('hidden');
    elements.qrEmpty.classList.remove('hidden');
    elements.qrTimeValue.textContent = '-';
  });

  elements.refreshButton.addEventListener('click', refreshStatus);
  elements.initializeButton.addEventListener('click', () => performStatusAction('/whatsapp-web/api/initialize'));
  elements.restartButton.addEventListener('click', () => performStatusAction('/whatsapp-web/api/restart'));

  elements.sendForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setNotice(elements.sendNotice, '', '');

    const recipient = elements.recipientInput.value.trim();
    const message = elements.messageInput.value.trim();
    if (!recipient || !message) {
      setNotice(elements.sendNotice, 'Numero y texto requeridos', 'warn');
      return;
    }

    elements.sendButton.disabled = true;
    try {
      const result = await apiFetch('/whatsapp-web/api/send', {
        method: 'POST',
        body: JSON.stringify({ recipient, message }),
      });
      setNotice(elements.sendNotice, `Enviado a ${result.chatId || recipient}`, 'ok');
      elements.messageInput.value = '';
      refreshStatus();
    } catch (error) {
      setNotice(elements.sendNotice, error.message, 'danger');
    } finally {
      elements.sendButton.disabled = false;
    }
  });

  if (getToken()) {
    refreshStatus();
    startPolling();
  } else {
    setStatusPill('Sin token', '');
  }
})();
