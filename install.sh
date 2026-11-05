#!/bin/sh
# Installs this mod for every Claude session, or updates it when already installed.
# The repo is the marketplace, so Claude reads the mod from this folder.
set -eu

PLUGIN=opencode-agent-monitor
MARKETPLACE=marques-local
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

for tool in claude opencode sqlite3; do
  command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; exit 1; }
done

# A failing mod must not replace a working install.
claude plugin validate "$ROOT"
claude plugin test "$ROOT"

if claude plugin marketplace list | grep -q "$MARKETPLACE"; then
  claude plugin marketplace update "$MARKETPLACE"
else
  claude plugin marketplace add "$ROOT"
fi

if claude plugin list | grep -q "$PLUGIN@$MARKETPLACE"; then
  claude plugin update "$PLUGIN@$MARKETPLACE"
else
  claude plugin install "$PLUGIN@$MARKETPLACE"
fi

echo "Done. Start a new Claude session, or run /reload-plugins in an open one."
