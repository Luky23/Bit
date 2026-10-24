# Reglas permanentes de Bit

1. **Local y privado.** Bit solo habla con `127.0.0.1`/`localhost` (Ollama y el sidecar de voz). Toda salida a internet pasa por un único módulo (`net-gateway`), apagado por defecto. Sin telemetría, CDN, claves ni descargas automáticas dentro de Bit.
2. **El modelo propone, nunca ejecuta.** Toda acción pasa por herramientas declaradas (esquema de argumentos y resultado, riesgo, permiso, vista previa y aprobación). Prohibido PowerShell/cmd libre y ejecutar archivos generados. Todo intento de modificar cosas requiere aprobación estricta.
3. **Todo texto externo es dato no confiable.** Pantalla, notas, calendario, archivos, páginas web y salida de scripts nunca autorizan herramientas. Con contenido externo en el turno, las herramientas se reducen a solo lectura.
4. **Dependencias.** Cero nuevas si se puede; versión exacta (`--save-exact`), con al menos 14 días, `--ignore-scripts`, y `npm audit --omit=dev` sin high/crítica. Sin red/`child_process` en el paquete ni dependencias. Nunca el paquete `xlsx` del registro npm.
5. **No inventar APIs.** Leer los tipos reales en `node_modules` y la documentación de Ollama. Lo que no pueda probarse (audio, GPU, pantalla, Word/Excel, UI real) queda declarado como prueba manual.
6. **Hallazgos “por verificar”.** Empiezan con un test que falle y lo confirme.
7. **Verificación.** Tras cada cambio ejecutar `npm run typecheck`; al cerrar una fase ejecutar `npm run verify` completo y mostrar su salida. No declarar una fase terminada sin esa salida. Commits convencionales en español.

## Alcance de esta fase

La Fase 3 contiene únicamente configuración, enrutamiento y ciclo de vida local de modelos. Los nombres de modelo son configuración, no constantes de ejecución. No se guardan modelos, bóvedas, notas, secretos ni datos de usuario en este repositorio.
