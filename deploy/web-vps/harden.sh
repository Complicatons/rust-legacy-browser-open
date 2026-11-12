#!/bin/bash
# Runbook Phase 4.1: Web VPS lock-down. Run as ubuntu with sudo.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo -E apt-get update -q
sudo -E apt-get -y -q -o Dpkg::Options::=--force-confold full-upgrade
sudo -E apt-get -y -q install ufw fail2ban unattended-upgrades
sudo timedatectl set-timezone Europe/London
sudo hostnamectl set-hostname rl-web

# 00-: sshd takes the first value it reads, and OVH's 50-cloud-init.conf turns PasswordAuthentication on.
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sudo mkdir -p /run/sshd   # Ubuntu 24.04 starts sshd by socket, so this is missing until the first login
sudo sshd -t
sudo systemctl reload ssh
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin) '

sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo systemctl enable --now fail2ban
echo 'unattended-upgrades unattended-upgrades/enable_auto_updates boolean true' | sudo debconf-set-selections
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
sudo ufw status verbose
systemctl is-active fail2ban unattended-upgrades
[ -f /var/run/reboot-required ] && echo REBOOT_REQUIRED || echo NO_REBOOT_NEEDED
