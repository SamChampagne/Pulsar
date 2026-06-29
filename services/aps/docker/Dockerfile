FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libharfbuzz0b \
        libffi-dev \
        libjpeg-dev \
        libxml2 \
        libxslt1.1 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml alembic.ini ./
COPY planiadvance_v2/README.md ./README.md
COPY alembic ./alembic
COPY planiadvance_v2 ./planiadvance_v2

RUN pip install --upgrade pip \
    && pip install -e ".[cpsat,sftp]"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "planiadvance_v2.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
