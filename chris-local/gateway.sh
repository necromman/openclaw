#!/usr/bin/env bash
# start | stop | restart | status | logs for the local gateway service.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oc-env.sh"
UNIT=openclaw-local.service
case "${1:-status}" in
  start|stop|restart) systemctl --user "$1" "$UNIT" ;;
  status)
    systemctl --user --no-pager status "$UNIT" | head -8
    ss -ltn | grep -E "127\.0\.0\.1:${OPENCLAW_LOCAL_PORT:-18789}" || echo "not listening"
    curl -s -o /dev/null -w "control-ui http=%{http_code}\n" --max-time 10 \
      "http://127.0.0.1:${OPENCLAW_LOCAL_PORT:-18789}/"
    ;;
  logs) tail -n "${2:-50}" "$OPENCLAW_LOCAL_ROOT/gateway.log" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs [n]}" >&2; exit 2 ;;
esac
