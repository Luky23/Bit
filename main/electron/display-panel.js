(() => {
  const $=id=>document.getElementById(id);
  const role=new URLSearchParams(location.search).get('role')==='info'?'info':'project';
  document.body.dataset.role=role;
  $('title').textContent=role==='info'?'Información del proyecto':'Espacio del proyecto';
  $('preview').hidden=role==='info';
  let selectedPath='';
  let generation=0;
  const statuses={working:'En curso',completed:'Completado',failed:'Falló'};
  async function refresh(){
    const current=++generation;
    try {
      const project=$('projects').value;
      const data=await window.projectPanel.snapshot({...(project?{project}:{}),...(selectedPath?{path:selectedPath}:{})});
      if(current!==generation)return;
      $('notice').textContent=data.notice || `Proyecto activo: ${data.activeProject || 'ninguno'} · Historial local de esta sesión`;
      $('projects').replaceChildren(new Option('Seguir proyecto activo',''),...data.projects.map(name=>new Option(name,name)));
      $('projects').value=project;
      $('files').replaceChildren();
      for(const path of data.files){
        const button=document.createElement('button');button.textContent=path;
        button.onclick=()=>{selectedPath=path;void refresh();};$('files').append(button);
      }
      $('file-name').textContent=data.file?.path || 'Contenido del archivo';
      $('content').textContent=data.file?.content ?? 'Seleccione un archivo para leerlo.';
      $('activity').replaceChildren();
      for(const item of data.activity.filter(item=>!project||item.project===project)){
        const details=document.createElement('details');
        const summary=document.createElement('summary');
        summary.textContent=`${new Date(item.time).toLocaleTimeString('es-AR')} · ${statuses[item.status]} · ${item.tool} · ${item.project}/${item.path}`;
        details.append(summary);
        if(item.before!==undefined){
          const versions=document.createElement('div');versions.className='versions';
          for(const [label,text] of [['Antes',item.before],['Después',item.after]]){
            const section=document.createElement('div'),heading=document.createElement('h3'),pre=document.createElement('pre');
            heading.textContent=label;pre.textContent=text||'(Sin contenido disponible)';section.append(heading,pre);versions.append(section);
          }
          details.append(versions);
        }
        $('activity').append(details);
      }
      if(!$('activity').children.length)$('activity').textContent='Todavía no hay operaciones del proyecto en esta sesión.';
    } catch(error) { if(current===generation)$('notice').textContent=error.message; }
  }
  $('projects').onchange=()=>{selectedPath='';void refresh();};
  $('refresh').onclick=()=>void refresh();
  $('settings').onclick=()=>window.projectPanel.openMain();
  const cleanup=window.projectPanel.onActivity(()=>{selectedPath='';void refresh();});
  window.addEventListener('beforeunload',cleanup);
  void refresh();
})();
