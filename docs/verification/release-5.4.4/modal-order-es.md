# Novedades de Nodus 5.4.4

1. El Índice documental muestra también los escaneos sueltos. El análisis de una sola obra o la preparación de un Deep Research creaban un trabajo sin campaña que no aparecía en ninguna fila, así que pulsar reintentar encolaba trabajo invisible. Ahora cada uno tiene su fila, con un botón de reintento si falló y otro de cancelación si sigue en marcha, y el panel y el contador de la cabecera lo cuentan como cualquier otro trabajo.

2. Enlazar desde la biblioteca global se refleja al instante. Al llevar obras a una bóveda, su lista de Biblioteca se servía de una caché que el enlace no invalidaba, así que al volver a «Esta bóveda» veías la página anterior. Ahora el enlace refresca la lista. La cola de extracción también deja de mostrar mensajes sin traducir, y una fila solo se pinta en rojo cuando el trabajo ha fallado de verdad.

3. Nodus Research ya está disponible en chino simplificado.

4. Los escaneos sobre una pasarela propia dejan de morir por una conexión caída. Un fallo de socket sin estado, el «Connection error.» del SDK o un reinicio de conexión, ahora se trata como recuperable, así que la cola vuelve a intentarlo en lugar de darse por vencida. Nodus también envía al proveedor personalizado el esfuerzo de razonamiento que elijas y pide a un modelo con razonamiento que omita su traza privada en los escaneos de fondo, que era lo que agotaba el presupuesto y alargaba la generación hasta que la pasarela la cortaba.

5. La imagen de Nodus Server vuelve a arrancar. Su ruta de PDF importaba una dependencia para recortar los glifos chinos que la imagen no instalaba, así que el contenedor se caía nada más iniciarse. La dependencia ya está declarada y la comprobación de salud del arranque pasa.
