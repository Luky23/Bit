# Memoria de Bit en Obsidian

Bit usa la bóveda elegida por el usuario desde **Ajustes → Bóveda de Obsidian**. Al conectarla solo se analiza su compatibilidad; no se crean ni modifican notas automáticamente.

## Preparar el grafo

En Ajustes, elija la bóveda y pulse **Generar grafo**. Un diálogo nativo muestra la ruta seleccionada y pide confirmación. Bit crea únicamente notas que todavía no existan dentro de `Bit/`; nunca reemplaza una nota previa.

La estructura inicial contiene:

- `Bit/Inicio.md`: índice enlazado a las otras notas.
- `Bit/Hoja de ruta.md`: objetivos y orden de trabajo, incluida la visión por cámara como fase futura.
- `Bit/Capacidades.md`: inventario de capacidades deseadas, sin presentarlas como verificadas.
- `Bit/Instrucciones del agente.md`: reglas para la memoria personal de Bit.

Las notas de conversación guardadas con autorización enlazan a `[[Bit/Inicio]]`. Las instrucciones de la bóveda orientan a Bit, pero no reemplazan las instrucciones de desarrollo del repositorio en `AGENTS.md`.

## Enlaces y consultas

El indexador resuelve enlaces `[[Nota]]`, enlaces con alias `[[Nota|texto]]`, encabezados y rutas de bóveda. Ignora wikilinks dentro de bloques y fragmentos de código. Los enlaces rotos no se convierten en aristas.

La herramienta de solo lectura `obsidian.graph` entrega nodos y aristas del grafo, o el entorno inmediato de una nota cuando recibe `notePath`. La respuesta está limitada a 200 nodos por defecto y 1000 como máximo. No lee rutas indicadas por el modelo: las notas de destino deben existir en el índice de la bóveda.

Para inspeccionar o buscar recuerdos, Bit usa las herramientas de lectura; solo guarda cuando el usuario lo pide y confirma el diálogo nativo.

## Validación manual en Windows

1. Abrir **Ajustes**, elegir una bóveda de prueba y comprobar que el estado muestre la ruta.
2. Pulsar **Generar grafo** y cancelar: no debe aparecer ninguna nota nueva.
3. Volver a pulsarlo y confirmar: deben aparecer cuatro notas nuevas enlazadas bajo `Bit/`.
4. Repetir: las cuatro notas deben figurar como existentes y conservar exactamente su contenido.
5. Abrir la vista de grafo de Obsidian y verificar los enlaces; guardar una memoria de prueba con confirmación y comprobar el enlace a `[[Bit]]`.
6. Cambiar a otra bóveda desde Ajustes y confirmar que las operaciones posteriores usan la nueva ruta.

Las pruebas automatizadas usan bóvedas temporales; no leen ni modifican la bóveda personal.
