#!/bin/sh
set -eu

runtime_dir=/opt/lila/runtime
native_workdir="${runtime_dir}/netty-native"
secrets_file="${runtime_dir}/secrets.conf"

ensure_secrets() {
  mkdir -p "${runtime_dir}"
  if [ ! -s "${secrets_file}" ]; then
    umask 077
    temporary="${runtime_dir}/.secrets.conf.$$"
    play_secret="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
    password_secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    storm_secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    {
      printf 'play.http.secret.key = "%s"\n' "${play_secret}"
      printf 'user.password.bpass.secret = "%s"\n' "${password_secret}"
      printf 'storm.secret = "%s"\n' "${storm_secret}"
    } > "${temporary}"
    chmod 0600 "${temporary}"
    mv "${temporary}" "${secrets_file}"
  fi
}

case "${1:-lila}" in
  lila)
    ensure_secrets
    rm -rf "${native_workdir}"
    mkdir -m 0700 "${native_workdir}"
    exec /opt/lila/bin/lila \
      -J-Xms256m \
      -J-Xmx3072m \
      -J-XX:+ExitOnOutOfMemoryError \
      -Dreactivemongo.io.netty.native.workdir="${native_workdir}" \
      -Dio.netty.native.workdir="${native_workdir}" \
      -Dconfig.file=/opt/lila/conf/application.conf \
      -Dlogger.file=/opt/lila/vortex/logger.xml
    ;;
  gateway)
    mkdir -p /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
    exec nginx -c /opt/lila/vortex/nginx.conf -g 'daemon off;'
    ;;
  gateway-dev)
    mkdir -p /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi
    exec nginx -c /opt/lila/vortex/nginx.dev.conf -g 'daemon off;'
    ;;
  *)
    echo "Unsupported Lila process: $1" >&2
    exit 64
    ;;
esac
