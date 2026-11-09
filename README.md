# Bit

Bit es un asistente personal local y privado para Windows.

## Canales

La rama Git `main` es el canal estable. La rama Git `preview` contiene el desarrollo en prueba. La carpeta `main/` contiene el código estable que compartirá el canal preview; `preview/` contiene funciones experimentales aisladas. Todo el trabajo de esta fase está en la rama `preview`.

Esta fase no descarga modelos. Los nombres y parámetros se editan desde la configuración y los modelos se administran por Ollama en `localhost`.

## Comandos

```text
npm run typecheck
npm test
npm run verify
npm run eval:models
```

## Memoria en Obsidian

La bóveda se elige desde Ajustes. Para crear las notas iniciales enlazadas del grafo, use **Generar grafo** y confirme el diálogo nativo. Consulte [docs/OBSIDIAN.md](./docs/OBSIDIAN.md) para conocer la estructura y las pruebas manuales.

## Proyectos locales

En Ajustes, elija una carpeta local para los proyectos de Bit. Bit puede crear proyectos y archivos de texto, leerlos, modificarlos y restaurar versiones. Cada escritura o restauración requiere confirmación nativa; antes de modificar o restaurar un archivo, Bit conserva una copia local en `.bit-backups/`. No ejecuta archivos generados. Evite seleccionar una carpeta sincronizada o un repositorio Git. Consulte [docs/PRIVACY.md](./docs/PRIVACY.md) para conocer los límites de privacidad y almacenamiento.

## Estado funcional

La diferencia entre funciones implementadas, parciales y pendientes se mantiene en [docs/AUDITORIA-FUNCIONAL.md](./docs/AUDITORIA-FUNCIONAL.md). Bit no debe anunciar como disponible una función que figure allí como pendiente.
