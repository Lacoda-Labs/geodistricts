#!/bin/sh

# Substitute PORT environment variable in nginx config
envsubst '$PORT' < /etc/nginx/nginx.conf > /tmp/nginx.conf

# Start nginx with the modified config
nginx -g "daemon off;" -c /tmp/nginx.conf
