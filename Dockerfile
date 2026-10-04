# chartview: build the UI, then run the FastAPI server.
# Default command runs the shareable public demo (no env API). For harness use, override:
#   docker run -p 8080:8080 -p 9090:9090 -e CHARTVIEW_ENV_TOKEN=... chartview-env \
#     .venv/bin/python -m app.main --host 0.0.0.0

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /usr/local/bin/uv
WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app/ app/
COPY --from=web /web/dist frontend/dist
ENV CHARTVIEW_DATA_DIR=/tmp/chartview \
    CHARTVIEW_SEED_CACHE=1 \
    PYTHONUNBUFFERED=1
EXPOSE 8080
# Render (and most hosts) pass the port to listen on in $PORT.
CMD ["sh", "-c", "CHARTVIEW_PUBLIC_PORT=${PORT:-8080} exec .venv/bin/python -m app.main --host 0.0.0.0 --public-demo ${DEMO_SEED:-1234}"]
