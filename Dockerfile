FROM node:20-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
RUN npm run build:frontend

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TURNERINGAR_DB=/data/turneringar/turneringar.sqlite3

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend/index.html frontend/tv.html ./frontend/
COPY --from=frontend-builder /app/frontend/static ./frontend/static

RUN mkdir -p /data/turneringar

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "turneringar.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
