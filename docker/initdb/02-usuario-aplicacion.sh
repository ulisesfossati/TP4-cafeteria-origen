#!/bin/bash
# =============================================================================
# Usuario de aplicación con mínimos privilegios.
#
# La app se conecta como `origen_app`, que NO es superusuario: no puede crear
# bases, usuarios ni tocar el esquema. Sólo lee y escribe los datos.
#
# Es un .sh y no un .sql para que la contraseña llegue por la variable
# APP_DB_PASSWORD (docker-compose.yml la toma del .env) y no quede escrita
# en el repositorio. Corre una sola vez, cuando el volumen de la base está vacío.
# =============================================================================

psql -v ON_ERROR_STOP=1 -v clave="$APP_DB_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE origen_app LOGIN PASSWORD :'clave';

GRANT CONNECT ON DATABASE origen TO origen_app;
GRANT USAGE ON SCHEMA public TO origen_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO origen_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO origen_app;

-- Si más adelante se agregan tablas nuevas, hay que repetir los permisos:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO origen_app;
SQL
