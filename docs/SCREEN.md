# Pantalla

Las preguntas sobre el contenido visible capturan la pantalla principal bajo demanda, con un lado máximo de 1280 px. La captura no se guarda. El OCR local usa Tesseract con `spa+eng` cuando ambos datos de idioma están instalados; si falta `spa.traineddata`, usa `eng` para no perder por completo el texto. Los datos de idioma los instala el usuario, sin descarga automática.

Las preguntas que piden leer texto usan el OCR. Las preguntas generales sobre lo que hay en pantalla o sobre imágenes usan además un modelo visual local. En este equipo, `qwen2.5vl:3b` identificó correctamente una imagen sintética con «Hola Luca» y un rectángulo rojo; `moondream:1.8b` inventó detalles en la misma prueba. Por eso se prefiere Qwen si está instalado. La consulta con Qwen tardó 109 s, consumió 641,5 s de CPU en 109,3 s de reloj (5,87 núcleos de media, 12 procesadores lógicos) y el proceso usó 3769 MB de memoria residente. El OCR de la misma imagen tardó unos 180 ms. Estas cifras corresponden a una imagen sintética de 1280 × 720 y no garantizan el mismo resultado con otros documentos o imágenes.

## Comprobación manual pendiente

- Abrir un documento real con texto pequeño en la pantalla principal y preguntar «¿Qué dice este documento?». Comparar la respuesta con el texto visible, incluidos acentos y números.
- Abrir una imagen real y preguntar «¿Qué ves en la pantalla?». Confirmar la descripción y medir tiempo y memoria.
- Comprobar ventanas con diferentes escalas de pantalla y la captura desde la ventana principal y desde el overlay.
- Instalar manualmente `spa.traineddata` en `tessdata` si se necesita OCR español, repetir la prueba del documento y comparar la precisión con el respaldo inglés.
