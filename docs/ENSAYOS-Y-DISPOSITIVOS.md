# Ensayos y dispositivos

Bit incorpora una base local para sesiones de ensayo en el Workspace. El usuario inicia y finaliza cada sesión de forma explícita y puede guardar marcas temporales. Las lecturas conservan valor, unidad, origen (`sensor` o `user-input`), instante y estado de vigencia.

La interfaz muestra `Sin dispositivo conectado` mientras no exista una fuente autorizada. Un valor vencido se muestra como `DATO VENCIDO`; nunca se interpreta como funcionamiento correcto. Un valor dictado por el usuario no se convierte en lectura de sensor.

El visor 3D acepta controles de mouse y comandos de vista. La traducción preparada para gestos solo permite rotar, ampliar, ensamblar o despiece visual; no elimina archivos ni autoriza operaciones persistentes.

Queda pendiente la integración de hardware real: protocolo del sensor, calibración, interbloqueos, cámara de manos, controladores de actuadores y fuentes de medición. No se conectaron brazos, extinción ni otros equipos, y no se estiman empuje, temperatura, velocidad o tolerancias a partir de imágenes.
