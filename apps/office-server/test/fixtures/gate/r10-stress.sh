#!/bin/bash
# Runs R10 RUNS times, PAR at a time, while BURN busy-loop processes load the CPU. Writes each run's output to $OUT/run-N.txt.
RUNS=${RUNS:-20}; PAR=${PAR:-8}; BURN=${BURN:-16}; OUT=${OUT:-/tmp/r10/runs}; DIR=${DIR:-$HOME/Projects/control-center-r10/apps/office-server}
rm -rf "$OUT"; mkdir -p "$OUT"
burners=()
for i in $(seq 1 "$BURN"); do (while :; do :; done) & burners+=($!); done
run() { cd "$DIR" && ECONOMY_GOLDEN_OUT=$OUT/log-$1.json npx vitest run test/economy.scenario.test.ts -t R10 > "$OUT/run-$1.txt" 2>&1; echo "$1 $?" >> "$OUT/exit.txt"; }
export -f run; export DIR OUT
seq 1 "$RUNS" | xargs -P "$PAR" -I{} bash -c 'run {}'
kill "${burners[@]}" 2>/dev/null
pass=$(awk '$2==0' "$OUT/exit.txt" | wc -l); echo "koşu: $RUNS (aynı anda $PAR, yük: $BURN meşgul döngü / $(nproc) çekirdek) — geçti: $pass, düştü: $((RUNS-pass))"
