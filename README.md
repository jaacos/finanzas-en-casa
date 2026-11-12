# Finanzas en casa

PWA de finanzas familiares: importación de extractos (Santander, BBVA, Revolut en PDF; cualquier banco en Excel/CSV), clasificación por reglas que aprenden, análisis categoría › subcategoría › comercio y resumen mensual.

- Datos en Supabase con reglas de acceso por fila: cada miembro ve el detalle de sus cuentas y de la común; de las del otro, solo totales.
- Sin dependencias externas en tiempo de ejecución: las librerías están en `vendor/`.
- Al cambiar cualquier fichero, sube la versión de `CACHE` en `sw.js` y `APP_VERSION` en `js/config.js`.
