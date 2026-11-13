(() => {
  window.addEventListener('dragover',event=>{
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
  });
  window.addEventListener('drop',async event=>{
    event.preventDefault();
    const file=event.dataTransfer?.files?.[0];
    if(!file)return;
    try {
      const path=window.bitRuntime.getPathForFile(file);
      if(!path)throw new Error('El archivo no tiene una ruta local.');
      await window.bitRuntime.forwardDroppedFile(path);
    } catch(error) {
      document.querySelector('.orb-button')?.setAttribute('title',`No se pudo recibir el archivo: ${error.message}`);
    }
  });
})();
