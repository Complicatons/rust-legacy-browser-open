#!/bin/bash
# Local checks of the website through Caddy on this host (never via public DNS).
H=${1:-127.0.0.1}
sudo journalctl -u rlb-central --no-pager -n 8 -o cat
for p in / /servers /island /wiki /updates /roadmap /signin /register /site-config.json /site/content/roadmap/index.json; do
 printf '%-36s ' "$p"
 curl -sk -m 10 -o /dev/null -w '%{http_code} %{content_type} %{size_download}B\n' -H 'Accept: text/html' --resolve "your-domain.example:443:$H" "https://your-domain.example$p"
done
printf '%-36s ' 'GET /servers (JSON)'; curl -sk -m 10 --resolve "your-domain.example:443:$H" https://your-domain.example/servers | head -c 120; echo
sudo ls -l /etc/rlb-central /etc/rlb-central/keys /var/lib/rlb-central
