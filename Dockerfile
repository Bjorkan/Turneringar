FROM node:20-slim AS frontend-builder

WORKDIR /app

COPY package.json tsconfig.frontend.json ./
COPY frontend/src ./frontend/src
RUN npm install --no-audit --no-fund \
    && npm run build:frontend

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
COPY frontend/static/app.css ./frontend/static/app.css
COPY frontend/static/vendor ./frontend/static/vendor
COPY --from=frontend-builder /app/frontend/static/app.js ./frontend/static/app.js
COPY --from=frontend-builder /app/frontend/static/tv.js ./frontend/static/tv.js

RUN mkdir -p /data/turneringar

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "turneringar.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
