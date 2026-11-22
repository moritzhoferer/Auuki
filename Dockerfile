# Auuki home: PWA + API in one container (branch `home` only).

# 1) build the PWA
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY .babelrc .htmlnanorc* ./
COPY src ./src
RUN npm run build

# 2) python runtime serving dist/ and /api
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/dist \
    GARMIN_TOKENSTORE=/data/garmin
WORKDIR /app/server
COPY --from=ghcr.io/astral-sh/uv:0.7.16 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    PATH=/app/server/.venv/bin:$PATH
COPY server/pyproject.toml server/uv.lock server/.python-version ./
RUN uv sync --frozen --no-dev --no-cache
COPY server/app ./app
COPY --from=web /app/dist /app/dist
RUN useradd --create-home auuki && mkdir -p /data && chown auuki /data
USER auuki
EXPOSE 8080
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers"]
