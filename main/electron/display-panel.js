(() => {
  const $ = id => document.getElementById(id);
  const role = new URLSearchParams(location.search).get('role') || 'project';
  const viewerToolbar = document.querySelector('.viewer-toolbar');
  const projectCard = document.querySelector('.project-card');
  const browserPanel = document.getElementById('browser');
  const textPreview = document.getElementById('text-preview');
  if (browserPanel && typeof document.createElement === 'function' && !document.getElementById('workspace-chat')) {
    const chat = document.createElement('section');
    chat.id = 'workspace-chat';
    chat.className = 'workspace-chat';
    chat.setAttribute('aria-label', 'Conversación contextual con Bit');
    chat.innerHTML = '<h2>CONVERSACIÓN CON BIT</h2><div class="chat-orb" aria-hidden="true"></div><p>El contexto del proyecto y del modelo permanece disponible aquí.</p><button type="button">ANALIZAR MODELO</button><button type="button">SUGERIR MEJORAS</button>';
    browserPanel.append(chat);
  }
  if (textPreview && typeof document.createElement === 'function' && !document.getElementById('project-core')) {
    const core = document.createElement('div');
    core.id = 'project-core';
    core.className = 'project-core';
    core.setAttribute('aria-label', 'Núcleo y conversación de Bit');
    core.innerHTML = '<div class="project-core-inner"><div class="project-core-orb" aria-hidden="true"></div><h2>Bit está listo para trabajar</h2><p>Seleccione un archivo o escriba un comando para continuar con el proyecto.</p></div>';
    textPreview.prepend(core);
  }
  if (projectCard && typeof projectCard.append === 'function' && typeof document.createElement === 'function') {
    const fileMetadata = document.createElement('div');
    fileMetadata.className = 'file-metadata';
    fileMetadata.innerHTML = '<small id="file-type">Tipo: —</small><small id="file-size">Tamaño: —</small><small id="file-modified">Modificado: —</small><small id="file-versions">Sin versiones guardadas.</small>';
    projectCard.append(fileMetadata);
  }
  if (viewerToolbar && typeof viewerToolbar.querySelectorAll === 'function' && typeof viewerToolbar.append === 'function') {
    const addView = (view, label) => {
      if ([...viewerToolbar.querySelectorAll('[data-view]')].some(button => button.dataset.view === view)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.view = view;
      button.textContent = label;
      viewerToolbar.append(button);
    };
    addView('rear', 'POSTERIOR');
    addView('bottom', 'INFERIOR');
    addView('left', 'LATERAL IZQUIERDA');
    addView('right', 'LATERAL DERECHA');
    if (!$('model-section')) {
      const section = document.createElement('button');
      section.id = 'model-section';
      section.type = 'button';
      section.disabled = true;
      section.title = 'La sección de malla aún no está implementada.';
      section.textContent = 'SECCIÓN · NO DISPONIBLE';
      viewerToolbar.append(section);
    }
    if (!$('model-close')) {
      const close = document.createElement('button');
      close.id = 'model-close';
      close.type = 'button';
      close.textContent = 'CERRAR MODELO';
      close.hidden = true;
      viewerToolbar.prepend(close);
    }
  }
  const initialTransition = new URLSearchParams(location.search).get('transition');
  function setWorkspaceTransition(phase) {
    document.body.classList.remove('workspace-entering', 'workspace-exiting');
    if (phase === 'enter') document.body.classList.add('workspace-entering');
    if (phase === 'exit') document.body.classList.add('workspace-exiting');
  }
  if (initialTransition === 'enter') setWorkspaceTransition('enter');
  let selectedPath = '';
  let droppedModelPath = '';
  let generation = 0;
  let currentProject = '';
  const statuses = { working: 'En curso', completed: 'Completado', failed: 'Falló' };
  const isProjectIntelligence = role === 'info';
  const modelExtensions = new Set(['stl', '3mf', 'obj', 'glb', 'gltf']);
  let modelViewer = null;
  let modelViewerModules = window.bitModelViewer || null;
  let loadedModelKey = '';
  let pendingModelKey = '';
  let loadedModelSize = 0;
  let activeCommand = 0;
  let modelGeneration = 0;
  let modelModulesReady = modelViewerModules ? Promise.resolve(modelViewerModules) : null;
  document.body.classList.toggle('info-mode', isProjectIntelligence);
  document.title = isProjectIntelligence ? 'Bit · Inteligencia del proyecto' : 'Bit · Espacio del proyecto';
  $('role-label').textContent = isProjectIntelligence ? 'INTELIGENCIA DEL PROYECTO' : 'PROYECTOS LOCALES';
  $('title').textContent = isProjectIntelligence ? 'Inteligencia del proyecto' : 'Espacio del proyecto';
  if (isProjectIntelligence) {
    document.querySelector('.status-panel .panel-head span').textContent = 'RESUMEN DEL PROYECTO';
    document.querySelector('.activity-panel .panel-head span').textContent = 'ACTIVIDAD Y CAMBIOS';
  }
  const overview = { innerHTML: '' };
  overview.innerHTML = '<div><h2>RESUMEN DEL PROYECTO</h2><p id="project-summary">Cargando información local…</p></div>';

  function isModelPath(path) {
    const extension = path?.split('.').pop().toLowerCase();
    return modelExtensions.has(extension);
  }

  function formatNumber(value) {
    return Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  }

  function resetModelProperties() {
    $('model-name').textContent = '—';
    $('model-format').textContent = '—';
    $('model-dimensions').textContent = '—';
    $('model-triangle-count').textContent = '—';
    $('model-component-count').textContent = '—';
    $('model-selected-component').textContent = '—';
    $('model-validity').textContent = 'SIN MODELO';
    $('analysis-visible-value').textContent = '—';
    $('analysis-triangle-value').textContent = '—';
    $('analysis-visible-bar').style.width = '0%';
    $('analysis-triangle-bar').style.width = '0%';
    $('hud-model-name').textContent = 'MODELO 3D';
    $('hud-model-data').textContent = 'SIN GEOMETRÍA CARGADA';
    $('hud-triangle-count').textContent = '— triángulos';
    $('hud-component-count').textContent = '— componentes';
  }

  function updateModelProperties(summary, fileSize = 0) {
    if (!summary) {
      resetModelProperties();
      return;
    }
    const dimensions = summary.bounds.size.map(formatNumber).join(' × ');
    const format = summary.format.toUpperCase();
    const sizeLabel = fileSize >= 1024 * 1024
      ? `${formatNumber(fileSize / (1024 * 1024))} MiB`
      : `${formatNumber(fileSize / 1024)} KiB`;
    const componentLabel = `${summary.visibleCount}/${summary.componentCount}`;
    $('model-name').textContent = summary.name.split(/[\\/]/u).pop();
    $('model-format').textContent = format;
    $('model-dimensions').textContent = dimensions;
    $('model-triangle-count').textContent = formatNumber(summary.triangleCount);
    $('model-component-count').textContent = formatNumber(summary.componentCount);
    $('model-selected-component').textContent = summary.selectedComponent || '—';
    $('model-validity').textContent = 'MALLA VALIDADA';
    $('analysis-visible-value').textContent = componentLabel;
    $('analysis-triangle-value').textContent = `${formatNumber(summary.triangleCount)} / 200.000`;
    $('analysis-visible-bar').style.width = `${summary.componentCount ? summary.visibleCount / summary.componentCount * 100 : 0}%`;
    $('analysis-triangle-bar').style.width = `${Math.min(100, summary.triangleCount / 200000 * 100)}%`;
    $('hud-model-name').textContent = summary.name.split(/[\\/]/u).pop().toUpperCase();
    $('hud-model-data').textContent = `${format} · ${sizeLabel} · RENDER CPU`;
    $('hud-triangle-count').textContent = `${formatNumber(summary.triangleCount)} triángulos`;
    $('hud-component-count').textContent = `${formatNumber(summary.componentCount)} componentes`;
    $('workspace-state').textContent = 'MODELO ACTIVO';
  }

  function closeModel() {
    modelGeneration += 1;
    modelViewer?.close();
    modelViewer = null;
    loadedModelKey = '';
    pendingModelKey = '';
    loadedModelSize = 0;
    resetModelProperties();
    $('workspace-state').textContent = 'EN ESPERA';
  }

  async function loadModel(project, path, key, generationForLoad, dropped = false) {
    try {
      $('model-status').textContent = `Cargando y validando ${path}…`;
      $('workspace-state').textContent = 'CARGANDO';
      if (!modelModulesReady) {
        modelModulesReady = new Promise(resolve =>
          window.addEventListener('bit-model-viewer-ready', () => resolve(window.bitModelViewer), { once: true })
        );
      }
      modelViewerModules = await modelModulesReady;
      if (generationForLoad !== modelGeneration) return;
      if (typeof (dropped ? window.projectPanel.loadDroppedModel : window.projectPanel.loadModel) !== 'function') {
        throw new Error('El proceso principal no ofrece lectura segura de modelos 3D.');
      }
      if (!modelViewer) modelViewer = modelViewerModules.createModelViewer($('model-viewer'), $('browser'));
      const source = await (dropped
        ? window.projectPanel.loadDroppedModel({ filePath: path })
        : window.projectPanel.loadModel({ project, path }));
      if (generationForLoad !== modelGeneration) return;
      const model = await modelViewerModules.parse3DModel({
        name: path,
        data: source.data,
        assets: source.assets,
      });
      if (generationForLoad !== modelGeneration) return;
      modelViewer.load(model);
      loadedModelSize = source.data?.byteLength ?? source.data?.length ?? 0;
      updateModelProperties(modelViewer.getSummary(), loadedModelSize);
      loadedModelKey = key;
      pendingModelKey = '';
      $('notice').textContent = `Modelo local cargado: ${path}`;
      return true;
    } catch (error) {
      if (generationForLoad !== modelGeneration) return false;
      modelViewer?.close();
      modelViewer = null;
      loadedModelKey = '';
      pendingModelKey = '';
      loadedModelSize = 0;
      resetModelProperties();
      $('workspace-state').textContent = 'ERROR DE CARGA';
      $('model-status').textContent = `No se pudo cargar el modelo: ${error.message}`;
      $('notice').textContent = `Error del visor 3D: ${error.message}`;
      return false;
    }
  }

  function renderActivity(items) {
    const target = $('activity');
    target.replaceChildren();
    for (const item of items) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${new Date(item.time).toLocaleTimeString('es-AR')} · ${statuses[item.status] || item.status} · ${item.tool} · ${item.project}/${item.path}`;
      details.append(summary);
      if (item.before !== undefined) {
        const versions = document.createElement('div');
        versions.className = 'versions';
        for (const [label, value] of [['Antes', item.before], ['Después', item.after]]) {
          const block = document.createElement('div');
          const heading = document.createElement('h3');
          const pre = document.createElement('pre');
          heading.textContent = label;
          pre.textContent = value || '(Sin contenido disponible)';
          block.append(heading, pre);
          versions.append(block);
        }
        details.append(versions);
      }
      target.append(details);
    }
    if (!target.children.length) target.innerHTML = '<p>Todavía no hay operaciones del proyecto en esta sesión.</p>';
  }

  async function refresh({ waitForModel = false } = {}) {
    const current = ++generation;
    try {
      const project = $('projects').value;
      const requestPath = selectedPath || '';
      const data = await window.projectPanel.snapshot({
        ...(project ? { project } : {}),
        ...(requestPath ? { path: requestPath, ...(isModelPath(requestPath) ? { metadataOnly: true } : {}) } : {}),
      });
      if (current !== generation) return;
      $('notice').textContent = data.notice || `Proyecto activo: ${data.activeProject || 'ninguno'} · Historial local de esta sesión`;
      $('projects').replaceChildren(new Option('Seguir proyecto activo', ''), ...data.projects.map(name => new Option(name, name)));
      $('projects').value = project;
      currentProject = project || data.activeProject || '';
      $('project-name').textContent = currentProject || 'Sin proyecto';
      $('project-location').textContent = currentProject ? 'ESPACIO LOCAL · CONTENIDO DEL PROYECTO' : 'Seleccione un proyecto local';
      $('workspace-project-label').textContent = (currentProject || 'SIN PROYECTO SELECCIONADO').toUpperCase();
      $('files').replaceChildren();
      for (const path of data.files) {
        const button = document.createElement('button');
        button.textContent = path;
        button.classList.toggle('active', path === selectedPath);
        button.onclick = () => { selectedPath = path; void refresh(); };
        $('files').append(button);
      }
      $('file-name').textContent = data.file?.path || 'Seleccione un archivo para leerlo.';
      const fileName = data.file?.path?.split(/[\\/]/u).pop() || '';
      const fileType = fileName.lastIndexOf('.') > 0 ? fileName.slice(fileName.lastIndexOf('.') + 1).toUpperCase() : 'Archivo';
      $('file-type').textContent = `Tipo: ${data.file ? fileType : '—'}`;
      $('file-size').textContent = `Tamaño: ${data.file?.size === undefined ? '—' : formatNumber(data.file.size) + ' bytes'}`;
      $('file-modified').textContent = data.file?.modifiedAt
        ? `Modificado: ${new Date(data.file.modifiedAt).toLocaleString('es-AR')}`
        : 'Modificado: —';
      $('file-versions').textContent = data.versions?.length
        ? `Versiones: ${data.versions.map(version => version.backupId).join(', ')}`
        : 'Sin versiones guardadas.';
      const projectName = project || data.activeProject || '';
      const modelSelected = Boolean(droppedModelPath || (selectedPath && isModelPath(selectedPath)));
      let modelLoadPromise = null;
      $('text-preview').hidden = modelSelected;
      $('model-viewer').hidden = !modelSelected;
      const closeModelButton = $('model-close');
      if (closeModelButton) closeModelButton.hidden = !modelSelected;
      if (modelSelected) {
        const modelPath = droppedModelPath || selectedPath;
        $('file-name').textContent = modelPath;
        const key = droppedModelPath ? `drop\0${modelPath}` : `${projectName}\0${modelPath}`;
        if (key !== loadedModelKey && key !== pendingModelKey) {
          closeModel();
          const currentModelGeneration = modelGeneration;
          pendingModelKey = key;
          modelLoadPromise = loadModel(projectName, modelPath, key, currentModelGeneration, Boolean(droppedModelPath));
        }
      } else {
        if (loadedModelKey || pendingModelKey || modelViewer) closeModel();
        $('content').textContent = data.file?.content ?? 'Seleccione un archivo para leerlo.';
      }
      const visibleActivity = data.activity.filter(item => !project || item.project === project);
      renderActivity(visibleActivity);
      $('file-count').textContent = String(data.files.length);
      $('project-file-total').textContent = String(data.files.length);
      $('change-count').textContent = String(visibleActivity.length);
      $('project-summary').textContent = `${data.files.length} archivos disponibles · ${visibleActivity.length} operaciones registradas · contenido local`;
      if (waitForModel && modelLoadPromise && !(await modelLoadPromise)) {
        throw new Error($('model-status').textContent);
      }
      return data;
    } catch (error) {
      if (current === generation) $('notice').textContent = error.message;
      if (waitForModel) throw error;
      return null;
    }
  }

  async function executeViewerCommand(request) {
    const { action } = request;
    if (action === 'load-dropped') {
      const path = request.filePath;
      if (typeof path !== 'string' || !isModelPath(path)) throw new Error('Suelte un archivo STL, 3MF, OBJ, GLB o glTF.');
      droppedModelPath = path;
      selectedPath = '';
      const data = await refresh({ waitForModel: true });
      if (!data || !loadedModelKey) throw new Error('No se pudo confirmar la carga del modelo.');
      return { ok: true, action, path, components: $('model-components').children.length };
    }
    if (action === 'load') {
      droppedModelPath = '';
      if (!currentProject && !request.project) await refresh();
      const project = request.project || currentProject;
      const path = request.path || selectedPath;
      if (!project) throw new Error('No hay un proyecto activo; seleccione uno en el Workspace.');
      if (!path || !isModelPath(path)) throw new Error('Seleccione en el explorador un archivo STL, 3MF, OBJ, GLB o glTF.');
      $('projects').value = project;
      selectedPath = path;
      const data = await refresh({ waitForModel: true });
      if (!data || !loadedModelKey) throw new Error('No se pudo confirmar la carga del modelo.');
      return { ok: true, action, project, path, components: $('model-components').children.length };
    }
    if (!modelViewer || !loadedModelKey) throw new Error('Primero cargue un modelo 3D en el Workspace.');
    switch (action) {
      case 'view':
        modelViewer.setView(request.view);
        break;
      case 'rotate':
        modelViewer.rotateBy(request.degrees, request.axis || 'y');
        break;
      case 'select':
        modelViewer.selectComponentByName(request.component);
        break;
      case 'hide':
        if (request.component) modelViewer.setComponentVisibleByName(request.component, false);
        else modelViewer.setSelectedComponentVisible(false);
        break;
      case 'show':
        if (request.component) modelViewer.setComponentVisibleByName(request.component, true);
        else modelViewer.setSelectedComponentVisible(true);
        break;
      case 'explode':
        modelViewer.setExploded(request.amount ?? 100);
        break;
      case 'assemble':
        modelViewer.setExploded(0);
        break;
      case 'reset':
        modelViewer.reset();
        break;
      case 'mode':
        modelViewer.setMode(request.mode);
        break;
      default:
        throw new Error(`Acción de visor 3D no compatible: ${action}`);
    }
    return { ok: true, action, status: $('model-status').textContent };
  }

  if (!window.projectPanel) {
    $('notice').textContent = 'Vista previa del espacio de proyectos';
    return;
  }
  $('projects').onchange = () => {
    droppedModelPath = '';
    selectedPath = '';
    const project = $('projects').value;
    void window.projectPanel.setActiveProject(project).then(() => refresh()).catch(error => {
      $('notice').textContent = error.message;
    });
  };
  $('model-close')?.addEventListener('click', () => { selectedPath = ''; droppedModelPath = ''; void refresh(); });
  $('refresh').onclick = () => void refresh();
  $('settings').onclick = () => {
    void window.projectPanel.showHome().catch(error => {
      $('notice').textContent = `No se pudo volver al inicio: ${error.message}`;
    });
  };
  const cleanupActivity = window.projectPanel.onActivity(() => { selectedPath = ''; void refresh(); });
  const cleanupProjectSelection = window.projectPanel.onProjectSelection?.(project => {
    $('projects').value = project;
    selectedPath = '';
    void refresh();
  });
  const cleanupProjectFileOpen = window.projectPanel.onProjectFileOpen?.(request => {
    if (!request?.project || !request?.path) return;
    droppedModelPath = '';
    $('projects').value = request.project;
    selectedPath = request.path;
    void refresh({ waitForModel: isModelPath(request.path) });
  });
  const cleanupWorkspaceTransition = window.projectPanel.onWorkspaceTransition?.(({ phase }) => setWorkspaceTransition(phase));
  if (!isProjectIntelligence) {
    for (const type of ['dragenter', 'dragover']) window.addEventListener(type, event => {
      if (!event.dataTransfer?.types?.includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      $('notice').textContent = 'Suelte un modelo STL, 3MF, OBJ, GLB o glTF para abrirlo en el visor.';
    }, true);
    window.addEventListener('drop', async event => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const filePath = window.projectPanel.getPathForFile(file);
        await executeViewerCommand({ action: 'load-dropped', filePath });
      } catch (error) {
        $('notice').textContent = `No se pudo abrir el modelo 3D: ${error.message}`;
      }
    }, true);
  }
  const cleanupViewerCommands = window.projectPanel.onViewerCommand(async ({ id, command }) => {
    try {
      const result = await executeViewerCommand(command);
      window.projectPanel.sendViewerCommandResult({ id, result });
    } catch (error) {
      window.projectPanel.sendViewerCommandResult({ id, error: error.message });
    }
  });
  const modelRoot = $('model-viewer');
  const onModelSummary = event => updateModelProperties(event.detail, loadedModelSize);
  modelRoot.addEventListener('bit-model-summary', onModelSummary);
  const cleanupChatChunks = window.projectPanel.onChatChunk(text => {
    if (activeCommand && typeof text === 'string') $('command-feedback').textContent += text;
  });
  const workshopPanel = document.createElement('section');
  workshopPanel.className = 'panel workshop-panel';
  workshopPanel.innerHTML = '<div class="panel-head"><span>ENSAYO LOCAL</span><small id="workshop-status">SIN SESIÓN</small></div><div class="workshop-controls"><button id="workshop-start" type="button">INICIAR</button><button id="workshop-mark" type="button" disabled>MARCAR</button><button id="workshop-stop" type="button" disabled>FINALIZAR</button><button id="workshop-gesture" type="button">ACTIVAR GESTOS</button></div><p id="workshop-feedback" class="notice" role="status">Sin dispositivo conectado. Las variables solo aparecen cuando una fuente autorizada las entrega.</p><div id="workshop-readings" class="activity"></div>';
  const hudRoot = document.querySelector('.hud');
  if (hudRoot && typeof hudRoot.insertBefore === 'function') hudRoot.insertBefore(workshopPanel, $('workspace-command-form'));
  const workshopStatus = $('workshop-status');
  const workshopFeedback = $('workshop-feedback');
  const renderWorkshop = snapshot => {
    const active = snapshot?.session?.status === 'active';
    workshopStatus.textContent = active ? 'ACTIVA' : snapshot?.session?.status === 'finished' ? 'FINALIZADA' : 'SIN SESIÓN';
    $('workshop-start').disabled = active;
    $('workshop-mark').disabled = !active;
    $('workshop-stop').disabled = !active;
    const readings = Object.entries(snapshot?.readings || {});
    $('workshop-readings').replaceChildren(...readings.map(([key, reading]) => {
      const row = document.createElement('p');
      row.textContent = `${key}: ${reading.value} ${reading.unit} · ${reading.origin} · ${reading.status === 'stale' ? 'DATO VENCIDO' : 'ACTUAL'}`;
      return row;
    }));
  };
  const workshopRequest = request => typeof window.projectPanel.getWorkshopSnapshot === 'function'
    ? window.projectPanel.getWorkshopSnapshot({ project: request?.project || currentProject })
    : Promise.resolve(null);
  $('workshop-start').onclick = async () => { try { renderWorkshop(await window.projectPanel.startWorkshopSession({ project: currentProject })); workshopFeedback.textContent = 'Ensayo iniciado. Sin dispositivo conectado.'; } catch (error) { workshopFeedback.textContent = `No se pudo iniciar: ${error.message}`; } };
  $('workshop-mark').onclick = async () => { try { renderWorkshop(await window.projectPanel.markWorkshopEvent({ project: currentProject, label: 'Marca manual' })); workshopFeedback.textContent = 'Marca temporal guardada como evento ingresado por el usuario.'; } catch (error) { workshopFeedback.textContent = `No se pudo marcar: ${error.message}`; } };
  $('workshop-stop').onclick = async () => { try { renderWorkshop(await window.projectPanel.stopWorkshopSession({ project: currentProject })); workshopFeedback.textContent = 'Ensayo finalizado. No se inventaron mediciones.'; } catch (error) { workshopFeedback.textContent = `No se pudo finalizar: ${error.message}`; } };
  let gestureStream = null;
  $('workshop-gesture').onclick = async () => {
    const button = $('workshop-gesture');
    if (gestureStream) { gestureStream.getTracks().forEach(track => track.stop()); gestureStream = null; button.textContent = 'ACTIVAR GESTOS'; workshopFeedback.textContent = 'Cámara suspendida; el control por mouse sigue disponible.'; return; }
    try {
      gestureStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      button.textContent = 'SUSPENDER CÁMARA';
      workshopFeedback.textContent = 'Cámara activa. Detector de manos no instalado; se mantiene el control por mouse y no se aplican gestos.';
    } catch (error) { workshopFeedback.textContent = `Cámara no disponible: ${error.message}`; }
  };
  void workshopRequest({ project: currentProject }).then(renderWorkshop).catch(() => {});
  $('workspace-command-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = $('workspace-command').value.trim();
    if (!message) return;
    if (typeof window.projectPanel.chat !== 'function') {
      $('command-feedback').textContent = 'El canal local de Bit no está disponible en esta ventana.';
      return;
    }
    activeCommand += 1;
    const commandId = activeCommand;
    $('workspace-command').value = '';
    $('workspace-command-submit').disabled = true;
    $('workspace-command-submit').textContent = 'PROCESANDO';
    $('workspace-state').textContent = 'PROCESANDO';
    $('command-feedback').textContent = '';
    try {
      const result = await window.projectPanel.chat(message);
      if (commandId !== activeCommand) return;
      $('command-feedback').textContent = result.text || (result.busy ? 'Bit ya está procesando otra consulta.' : 'Bit no devolvió una respuesta.');
      $('workspace-state').textContent = result.busy ? 'OCUPADO' : 'OPERATIVO';
    } catch (error) {
      if (commandId !== activeCommand) return;
      $('command-feedback').textContent = `No se pudo completar el comando: ${error.message}`;
      $('workspace-state').textContent = 'ERROR';
    } finally {
      if (commandId === activeCommand) {
        $('workspace-command-submit').disabled = false;
        $('workspace-command-submit').textContent = 'ENVIAR';
        $('workspace-command').focus();
      }
    }
  });
  window.bitWorkspaceViewer = Object.freeze({ execute: executeViewerCommand });
  window.addEventListener('beforeunload', () => {
    cleanupActivity();
    cleanupProjectSelection?.();
    cleanupProjectFileOpen?.();
    cleanupWorkspaceTransition?.();
    cleanupViewerCommands();
    cleanupChatChunks();
    modelRoot.removeEventListener('bit-model-summary', onModelSummary);
    closeModel();
  });
  void refresh();
})();
