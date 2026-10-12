FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN apt-get update && apt-get install --no-install-recommends -y osmium-tool ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY osmium-export.json /etc/nearby-export.json
USER 65534:65534
ENTRYPOINT ["osmium"]
