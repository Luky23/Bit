(() => {
  const $ = id => document.getElementById(id);
  const role = new URLSearchParams(location.search).get('role') || 'project';
  let selectedPath = '';
  let generation = 0;
  const statuses = { working: 'En curso', completed: 'Completado', failed: 'Falló' };
  $('role-label').textContent = role === 'info' ? 'ESTADO LOCAL' : 'PROYECTOS LOCALES';
  $('title').textContent = role === 'info' ? 'Estado local' : 'Espacio del proyecto';
  const overview = { innerHTML: '' };
  overview.innerHTML = '<div><h2>RESUMEN DEL PROYECTO</h2><p id="project-summary">Cargando información local…</p></div>';

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

  async function refresh() {
    const current = ++generation;
    try {
      const project = $('projects').value;
      const data = await window.projectPanel.snapshot({ ...(project ? { project } : {}), ...(selectedPath ? { path: selectedPath } : {}) });
      if (current !== generation) return;
      $('notice').textContent = data.notice || `Proyecto activo: ${data.activeProject || 'ninguno'} · Historial local de esta sesión`;
      $('projects').replaceChildren(new Option('Seguir proyecto activo', ''), ...data.projects.map(name => new Option(name, name)));
      $('projects').value = project;
      $('files').replaceChildren();
      for (const path of data.files) {
        const button = document.createElement('button');
        button.textContent = path;
        button.classList.toggle('active', path === selectedPath);
        button.onclick = () => { selectedPath = path; void refresh(); };
        $('files').append(button);
      }
      $('file-name').textContent = data.file?.path || 'Seleccione un archivo para leerlo.';
      $('content').textContent = data.file?.content ?? 'Seleccione un archivo para leerlo.';
      const visibleActivity = data.activity.filter(item => !project || item.project === project);
      renderActivity(visibleActivity);
      $('file-count').textContent = String(data.files.length);
      $('change-count').textContent = String(visibleActivity.length);
      $('project-summary').textContent = `${data.files.length} archivos disponibles · ${visibleActivity.length} operaciones registradas · contenido local`;
    } catch (error) {
      if (current === generation) $('notice').textContent = error.message;
    }
  }

  if (!window.projectPanel) {
    $('notice').textContent = 'Vista previa del espacio de proyectos';
    return;
  }
  $('projects').onchange = () => { selectedPath = ''; void refresh(); };
  $('refresh').onclick = () => void refresh();
  $('settings').onclick = () => window.projectPanel.openMain();
  const cleanup = window.projectPanel.onActivity(() => { selectedPath = ''; void refresh(); });
  window.addEventListener('beforeunload', cleanup);
  void refresh();
})();
