FROM node:22-bookworm-slim

ARG HERDR_DOWNLOAD_URL
RUN test -n "$HERDR_DOWNLOAD_URL"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "$HERDR_DOWNLOAD_URL" -o /usr/local/bin/herdr \
  && chmod +x /usr/local/bin/herdr \
  && herdr --version

COPY run.sh ping.mjs /probe/
RUN chmod +x /probe/run.sh

ENTRYPOINT ["/probe/run.sh"]
