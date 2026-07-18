# syntax=docker/dockerfile:1.7

FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS ui-builder

WORKDIR /src

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@11.9.0 --activate

COPY . .

RUN while IFS="$(printf '\t')" read -r link target; do \
        rm -f "${link}"; \
        ln -s "${target}" "${link}"; \
      done < vortex/symlinks.tsv \
  && sed -i 's/\r$//' .node-version \
  && pnpm install --frozen-lockfile \
  && git init --quiet \
  && git -c user.name='Vortex Builder' -c user.email='builder@vortex.invalid' \
    commit --allow-empty --quiet --message='Vortex packaged Lila' \
  && chmod +x ./ui/build \
  && ./ui/build --no-install -p

FROM eclipse-temurin:21-jdk-jammy@sha256:9d8dcf999b0bce2453e913823595a5ff2a4e8e9e5d5241b45280d0ff069818ec AS server-builder

ARG SBT_LAUNCH_SHA256=417cfb07bfe267348ba551a4b83693cbd5cfbf792ad64048fe6489ced4dc4fcb
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown

WORKDIR /src

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl --fail --silent --show-error --location \
    https://repo1.maven.org/maven2/org/scala-sbt/sbt-launch/2.0.2/sbt-launch-2.0.2.jar \
    --output /usr/local/lib/sbt-launch.jar \
  && echo "${SBT_LAUNCH_SHA256}  /usr/local/lib/sbt-launch.jar" | sha256sum --check --strict \
  && printf '%s\n' '#!/bin/sh' 'exec java -jar /usr/local/lib/sbt-launch.jar "$@"' > /usr/local/bin/sbt \
  && chmod 0755 /usr/local/bin/sbt

COPY . .
COPY --from=ui-builder /src/public ./public

RUN printf 'app.version.commit = "%s"\napp.version.date = "%s"\n' "${VCS_REF}" "${BUILD_DATE}" > conf/version.conf \
  && cp conf/application.conf.default conf/application.conf \
  && sed -i 's/\r$//' ./lila.sh \
  && chmod +x ./lila.sh \
  && ./lila.sh -Depoll=true "web/testOnly lila.web.VortexIdentityTest lila.web.VortexPublicOriginTest;stage"

FROM eclipse-temurin:21-jre-jammy@sha256:d63bd8d9b171999cbed8576f2c76e874dd4856791a358536e5c4d407e77edc13 AS runtime

LABEL org.opencontainers.image.source="https://github.com/Hannibal420King/lila" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.title="Lila for Vortex"

ARG UID=10001
ARG GID=10001

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl nginx \
  && if [ -e /var/log/nginx/error.log ] && [ ! -f /var/log/nginx/error.log ] && [ ! -L /var/log/nginx/error.log ]; then \
       echo '/var/log/nginx/error.log is not a replaceable file' >&2; \
       exit 1; \
     fi \
  && ln -sfn /dev/stderr /var/log/nginx/error.log \
  && rm -rf /var/lib/apt/lists/* /usr/share/doc /usr/share/man \
  && groupadd --gid "${GID}" lila \
  && useradd --uid "${UID}" --gid "${GID}" --home-dir /opt/lila --no-create-home --shell /usr/sbin/nologin lila

WORKDIR /opt/lila

COPY --from=server-builder --chown=lila:lila /src/target/universal/stage/ ./
COPY --from=server-builder --chown=lila:lila /src/public/ ./public/
COPY --chown=lila:lila vortex/application.conf ./conf/application.conf
COPY --chown=lila:lila vortex/logger.xml vortex/entrypoint.sh vortex/nginx.conf vortex/nginx.dev.conf ./vortex/
COPY --chown=lila:lila vortex/browser/ ./vortex/browser/
COPY --from=server-builder --chown=lila:lila /src/LICENSE /src/COPYING.md /src/vortex/ATTRIBUTION.md ./licenses/

RUN mkdir -p /opt/lila/runtime /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi \
  && chown lila:lila /opt/lila/runtime /tmp/nginx /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi \
  && chmod 0755 /opt/lila/vortex/entrypoint.sh

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

USER lila:lila

EXPOSE 8080 9663

STOPSIGNAL SIGTERM

ENTRYPOINT ["/opt/lila/vortex/entrypoint.sh"]
CMD ["lila"]
