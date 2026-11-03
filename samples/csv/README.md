# CSV de prueba para ingesta histórica

Los archivos usan `PL_NORTE` y contienen valores ficticios para probar la vista previa de ingesta.

- `telemetria_valida_basica.csv`: dos muestras válidas con solo las columnas requeridas; sirve para una importación de prueba.
- `telemetria_valida_completa.csv`: incluye todas las columnas opcionales y tres muestras válidas. Una muestra tiene turbidez y DQO elevadas para mostrar una excursión de calidad, sin errores de formato.
- `telemetria_delimitador_punto_y_coma.csv`: muestras válidas separadas por punto y coma para comprobar la detección del delimitador.
- `telemetria_con_errores.csv`: vista previa con errores intencionales de turno, dosis fuera de rango y fecha inválida. Corrige esos valores antes de importar.

Las tres primeras plantillas son importables siempre que `PL_NORTE` exista en la base de datos seleccionada. Los registros son de demostración, no representan mediciones operativas.
