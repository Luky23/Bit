window.BitResponseTiming = {
  start(node) {
    const started = performance.now();
    let completed;
    const durationMs = () => completed ?? performance.now() - started;
    const seconds = () => (durationMs() / 1000).toFixed(1).replace('.', ',') + ' s';
    const update = () => { node.dataset.responseTime = 'Procesando · ' + seconds(); };
    update();
    const interval = setInterval(update, 250);
    return {
      durationMs,
      finish() {
        if (completed !== undefined) return;
        completed = performance.now() - started;
        clearInterval(interval);
        node.dataset.responseTime = 'Tiempo total: ' + seconds();
      },
    };
  },
};
