FROM python:3.11-slim AS builder

WORKDIR /app

# System dependencies for building wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# --- Production stage ---
FROM python:3.11-slim

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Application code
COPY backend/ backend/

# Non-root user for security
RUN useradd -m -s /usr/sbin/nologin appuser && chown -R appuser:appuser /app
USER appuser

# No build tools in production image
EXPOSE 8000

# Uvicorn with production settings
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
