/* Edición local: no cambia la conversación hasta confirmar el nuevo envío. */
window.BitMessageEditor = {
  create({ input, isBusy, stop, onCommit = () => {}, onError = () => {} }) {
    let editing = null;
    let startingEdit = false;
    let draft = '';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'message-edit-cancel';
    cancelButton.textContent = 'Cancelar edición';
    cancelButton.hidden = true;
    input.parentNode.appendChild(cancelButton);
    function cancel() {
      if (!editing || isBusy()) return;
      input.value = draft;
      editing = null;
      cancelButton.hidden = true;
      input.focus();
    }
    cancelButton.onclick = cancel;
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' && editing) { event.preventDefault(); cancel(); }
    });
    return {
      cancel,
      attach(node, text, context) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'message-edit';
        button.textContent = 'Editar';
        button.onclick = async () => {
          if (startingEdit || (isBusy() && typeof stop !== 'function')) return;
          startingEdit = true;
          button.disabled = true;
          try {
            if (isBusy()) {
              button.textContent = 'Deteniendo…';
              await stop();
              if (isBusy()) throw new Error('La respuesta todavía no se detuvo.');
            }
            if (!editing) draft = input.value;
            editing = { node, context };
            input.disabled = false;
            input.value = text;
            cancelButton.hidden = false;
            input.focus();
          } catch (error) {
            onError(error);
          } finally {
            startingEdit = false;
            button.disabled = false;
            button.textContent = 'Editar';
          }
        };
        node.appendChild(button);
      },
      commit() {
        if (!editing) return;
        if (!editing.node.parentNode) { editing = null; cancelButton.hidden = true; return; }
        onCommit(editing.context);
        while (editing.node.nextElementSibling) editing.node.nextElementSibling.remove();
        editing.node.remove();
        editing = null;
        cancelButton.hidden = true;
      },
    };
  },
};
