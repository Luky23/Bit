
    const $ = id => document.getElementById(id);

    // ===== STATE MANAGEMENT =====
    const State = { IDLE: 'idle', LISTENING: 'listening', SPEAKING: 'speaking', PROCESSING: 'processing' };
    let currentState = State.IDLE;
    let audioContext;
        let coreBars = [];
    let barAnimationId = null;

    // DOM
    const hudCore = $('hudCore');
    const coreBarsEl = $('coreBars');
    const panel = $('panel');
    const panelContent = $('panelContent');
    const statusDot = $('statusDot');
    const messagesEl = $('messages');
    const telemetryEl = $('telemetry');

    // ===== TELEMETRY =====
    function logTelemetry(tag, text, type = 'info') {
      const now = new Date();
      const ts = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
      const line = document.createElement('div');
      line.className = 'telemetry-line';
      if (type === 'dim') line.classList.add('dim');
      line.innerHTML = `<span class="timestamp">[${ts}]</span><span class="tag ${type === 'warn' ? 'warn' : type === 'error' ? 'error' : type === 'ok' ? 'ok' : ''}">[${tag}]</span>${text}`;
      telemetryEl.appendChild(line);
      while (telemetryEl.children.length > 50) telemetryEl.removeChild(telemetryEl.firstChild);
      telemetryEl.scrollTop = telemetryEl.scrollHeight;
    }

    // ===== CORE STATE =====
    function setState(newState) {
      if (currentState === newState) return;
      currentState = newState;

      hudCore.className = 'hud-core ' + newState;

      statusDot.className = 'status-dot';
      if (newState === State.LISTENING) statusDot.classList.add('active');
      else if (newState === State.SPEAKING) statusDot.classList.add('speaking');
      else if (newState === State.PROCESSING) statusDot.classList.add('processing');

      logTelemetry('STATE', `Transición → ${newState.toUpperCase()}`, 'info');

      if (barAnimationId) { cancelAnimationFrame(barAnimationId); barAnimationId = null; }
      if (newState === State.LISTENING || newState === State.SPEAKING) animateCoreBars();
    }

    // ===== CORE BARS (Audio Reactive) =====
    function createCoreBars() {
      coreBarsEl.innerHTML = '';
      coreBars = [];
      const count = 16;
      for (let i = 0; i < count; i++) {
        const bar = document.createElement('div');
        bar.className = 'core-bar';
        bar.style.transform = `rotate(${i * (360 / count)}deg) translateY(-36px)`;
        coreBarsEl.appendChild(bar);
        coreBars.push({ el: bar, baseHeight: 22, baseOpacity: 0.25 });
      }
    }
    createCoreBars();

    function animateCoreBars() {
      if (currentState !== State.LISTENING && currentState !== State.SPEAKING) return;
      const now = Date.now();
      coreBars.forEach((bar, i) => {
        const phase = (now * 0.003 + i * 0.4) % (Math.PI * 2);
        const amplitude = 0.3 + 0.7 * Math.max(0, Math.sin(phase));
        const h = Math.max(4, 22 + amplitude * 32);
        const o = 0.15 + amplitude * 0.8;
        bar.el.style.height = h + 'px';
        bar.el.style.opacity = o;
      });
      barAnimationId = requestAnimationFrame(animateCoreBars);
    }

    // ===== PANEL TOGGLE =====
    function openPanel() {
      document.body.classList.add('expanded');
      void window.bitRuntime.setOverlayExpanded(true).catch(e => logTelemetry('ERR', e.message, 'error'));
      requestAnimationFrame(() => $('prompt').focus());
    }
    function closePanel() {
      document.body.classList.remove('expanded');
      void window.bitRuntime.setOverlayExpanded(false);
    }
    $('close').addEventListener('click', closePanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

    // ===== HUD CLICK → OPEN MAIN WINDOW =====
    function onHudClick() {
      if (document.body.classList.contains('expanded')) return;
      // Send IPC to main process to show main window and hide overlay
      if (window.ipcRenderer && window.ipcRenderer.send) {
        window.ipcRenderer.send('hud-clicked');
      }
      // Also trigger panel open for immediate feedback
      openPanel();
    }
    hudCore.addEventListener('click', onHudClick);
    hudCore.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onHudClick(); } });

    // ===== VOICE LEVEL FROM SIDECAR =====
    let vadActive = false;
    
    const cleanupVoiceLevel = window.bitRuntime.onVoiceLevel((msg) => {
      if (msg.type === 'level') {
        const rms = msg.rms ?? 0;
        if (rms > 0.015 && currentState === State.IDLE && !vadActive) {
          vadActive = true;
          setState(State.LISTENING);
        } else if (rms < 0.005 && vadActive && currentState === State.LISTENING) {
          vadActive = false;
        }
      } else if (msg.type === 'vad-trigger') {
        if (msg.speech && currentState === State.IDLE) {
          vadActive = true;
          setState(State.LISTENING);
        } else if (!msg.speech && vadActive && currentState === State.LISTENING) {
          vadActive = false;
        }
      } else if (msg.type === 'transcript') {
        if (msg.text && currentState === State.LISTENING) {
          $('prompt').value = msg.text;
          logTelemetry('VAD', `Transcripción: "${msg.text.slice(0,40)}..."`, 'ok');
        }
      }
    });
    window.addEventListener('beforeunload', cleanupVoiceLevel);

    // ===== CHAT =====
    function addMessage(text, kind = '') {
      const node = document.createElement('div');
      node.className = `message ${kind}`;
      node.textContent = text;
      messagesEl.appendChild(node);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      while (messagesEl.children.length > 50) messagesEl.removeChild(messagesEl.firstChild);
      return node;
    }

    $('vision-model').value = localStorage.getItem('bit.visionModel') || '';

    $('capture').addEventListener('click', async () => {
      const btn = $('capture');
      btn.disabled = true;
      setState(State.PROCESSING);
      logTelemetry('SCRN', 'Iniciando captura de pantalla…', 'info');
      $('capture-state').textContent = 'Capturando…';

      try {
        const result = await window.bitRuntime.captureScreen();
        capturedImage = result.imageDataUrl;
        $('capture-state').textContent = `Pantalla adjunta · ${result.width}×${result.height}`;
        localStorage.setItem('bit.visionModel', $('vision-model').value.trim());
        logTelemetry('SCRN', `Captura OK ${result.width}×${result.height}`, 'ok');
      } catch (error) {
        capturedImage = '';
        $('capture-state').textContent = `Error: ${error.message}`;
        logTelemetry('SCRN', `Falló: ${error.message}`, 'error');
      } finally {
        btn.disabled = false;
        setState(State.IDLE);
      }
    });


    $('chat-form').addEventListener('submit', async event => {
      event.preventDefault();
      const prompt = $('prompt').value.trim();
      if (!prompt) return;

      const model = $('vision-model').value.trim() || 'qwen2.5:3b';
      $('prompt').value = '';
      addMessage(prompt, 'user');
      logTelemetry('LLM', `Inferencia (${model})…`, 'info');
      const pending = addMessage('Procesando…', 'system');
      $('send').disabled = true;
      setState(State.PROCESSING);

      try {
        const result = await window.bitRuntime.chat({
          model,
          message: prompt,
          imageDataUrl: capturedImage || undefined
        });
        pending.textContent = result.text || 'El modelo no devolvió texto.';
        pending.classList.remove('system');
        capturedImage = '';
        $('capture-state').textContent = '';
        logTelemetry('LLM', 'Respuesta recibida', 'ok');
      } catch (error) {
        pending.textContent = error.message;
        pending.classList.add('error');
        logTelemetry('LLM', `Error: ${error.message}`, 'error');
      } finally {
        $('send').disabled = false;
        requestAnimationFrame(() => $('prompt').focus());
        setState(State.IDLE);
      }
    });

    $('stop').addEventListener('click', () => {
      void window.bitRuntime.stopSpeaking();
      setState(State.IDLE);
      logTelemetry('TTS', 'Interrumpido por usuario', 'warn');
    });

    $('open-main').addEventListener('click', () => {
      void window.bitRuntime.openMain();
      logTelemetry('UI', 'Abrir ventana principal', 'info');
    });

    // ===== VOICE AUDIO STREAMING =====
    window.bitRuntime.onVoiceAudio(chunk => {
      try {
        audioContext ??= new AudioContext();
        const bytes = Uint8Array.from(atob(chunk.pcmBase64), char => char.charCodeAt(0));
        const samples = new Int16Array(bytes.buffer);
        const buffer = audioContext.createBuffer(chunk.channels, samples.length / chunk.channels, chunk.sampleRate);
        for (let channel = 0; channel < chunk.channels; channel++) {
          const output = buffer.getChannelData(channel);
          for (let i = 0; i < output.length; i++) {
            output[i] = samples[i * chunk.channels + channel] / 32768;
          }
        }
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        nextAudioTime = Math.max(nextAudioTime, audioContext.currentTime);
        source.start(nextAudioTime);
        nextAudioTime += buffer.duration;

        if (currentState !== State.SPEAKING) setState(State.SPEAKING);
        setTimeout(() => {
          if (currentState === State.SPEAKING) setState(State.IDLE);
        }, buffer.duration * 1000 + 500);
      } catch (error) {
        logTelemetry('TTS', `Error: ${error.message}`, 'error');
      }
    });

    // ===== INIT =====
    let nextAudioTime = 0;
    logTelemetry('SYS', 'Bit v0.1.0-preview inicializado', 'ok');
    logTelemetry('SYS', 'Privacidad: solo localhost · Zero-Trust', 'info');
    logTelemetry('SYS', 'Modelos: qwen2.5:3b (rápido) / qwen2.5-coder:7b (pesado)', 'info');
  