#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

: "${DOMAIN_NAME:?DOMAIN_NAME is not set in .env}"
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL is not set in .env}"

COMPOSE="docker compose -f docker-compose.prod.yml"
RSA_KEY_SIZE=4096

echo "### Creating dummy certificate for ${DOMAIN_NAME} ..."
$COMPOSE run --rm --entrypoint "\
  sh -c 'mkdir -p /etc/letsencrypt/live/${DOMAIN_NAME} && \
  openssl req -x509 -nodes -newkey rsa:${RSA_KEY_SIZE} -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem \
    -subj "/CN=localhost"'" certbot

echo "### Starting nginx ..."
$COMPOSE up -d nginx

echo "### Deleting dummy certificate ..."
$COMPOSE run --rm --entrypoint "\
  rm -rf /etc/letsencrypt/live/${DOMAIN_NAME} \
  /etc/letsencrypt/archive/${DOMAIN_NAME} \
  /etc/letsencrypt/renewal/${DOMAIN_NAME}.conf" certbot

echo "### Requesting real certificate for ${DOMAIN_NAME} ..."
$COMPOSE run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    --email ${CERTBOT_EMAIL} \
    -d ${DOMAIN_NAME} \
    --rsa-key-size ${RSA_KEY_SIZE} \
    --agree-tos \
    --non-interactive" certbot

echo "### Reloading nginx ..."
$COMPOSE exec nginx nginx -s reload

echo "### Done. Certificate installed for ${DOMAIN_NAME}."
