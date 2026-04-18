#!/bin/bash
# SignalStack — EC2 Deployment Script
# Run this ON the EC2 instance after SSHing in.
# Prerequisites: Ubuntu 22.04, SSH access, .env file ready
set -euo pipefail

echo "=== SignalStack Deployment ==="

# --- 1. System Updates & Docker ---
echo "[1/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
    sudo apt-get update -y
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker $USER
    echo "Docker installed. You may need to log out and back in for group changes."
else
    echo "Docker already installed."
fi

# --- 2. Firewall ---
echo "[2/6] Configuring firewall..."
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (Caddy redirects to HTTPS)
sudo ufw allow 443/tcp  # HTTPS
sudo ufw --force enable
echo "Firewall configured: SSH, HTTP, HTTPS only."

# --- 3. Fail2ban (brute force protection) ---
echo "[3/6] Installing fail2ban..."
if ! command -v fail2ban-client &> /dev/null; then
    sudo apt-get install -y fail2ban
    sudo systemctl enable fail2ban
    sudo systemctl start fail2ban
    echo "Fail2ban installed and running."
else
    echo "Fail2ban already installed."
fi

# --- 4. Verify .env ---
echo "[4/6] Checking .env..."
if [ ! -f .env ]; then
    echo "ERROR: .env file not found. Copy .env.example and fill in real values."
    exit 1
fi

# Verify critical vars are set (not placeholder)
for var in SUPABASE_URL SUPABASE_ANON_KEY ANTHROPIC_API_KEY ENCRYPTION_KEY SUPABASE_JWT_SECRET DOMAIN; do
    val=$(grep "^${var}=" .env | cut -d'=' -f2-)
    if [ -z "$val" ] || [[ "$val" == *"your-"* ]] || [[ "$val" == *"changeme"* ]]; then
        echo "WARNING: $var appears unset or still has placeholder value."
    fi
done

# Update REDIS_URL to include password for Docker
REDIS_PW=$(grep "^REDIS_PASSWORD=" .env | cut -d'=' -f2-)
if [ -n "$REDIS_PW" ] && [ "$REDIS_PW" != "changeme" ]; then
    # Ensure REDIS_URL uses the password
    if ! grep -q "@redis:" .env; then
        sed -i "s|REDIS_URL=redis://redis:6379/0|REDIS_URL=redis://:${REDIS_PW}@redis:6379/0|" .env
        echo "Updated REDIS_URL with password."
    fi
fi

echo ".env verified."

# --- 5. Build frontend ---
echo "[5/6] Building frontend..."
if [ -d frontend/node_modules ]; then
    echo "node_modules exists, skipping npm install."
else
    # Install Node.js if needed
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    cd frontend && npm ci && cd ..
fi
cd frontend && npm run build && cd ..
echo "Frontend built to frontend/dist/"

# --- 6. Launch ---
echo "[6/6] Starting services..."
docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo "=== Deployment Complete ==="
echo "Services starting. Check status with: docker compose -f docker-compose.prod.yml ps"
echo "View logs with: docker compose -f docker-compose.prod.yml logs -f"
echo ""
echo "If you haven't set up your domain yet:"
echo "  1. Buy domain on GoDaddy"
echo "  2. Allocate an Elastic IP in AWS and associate it with this instance"
echo "  3. Add an A record in GoDaddy DNS pointing to the Elastic IP"
echo "  4. Set DOMAIN=yourdomain.com in .env"
echo "  5. Restart: docker compose -f docker-compose.prod.yml restart caddy"
