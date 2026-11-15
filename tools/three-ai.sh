#!/bin/sh
# the AI / control regression set on fixed seeds, JSON per job into tools/build/<out>/ai (run from the repo root)
# sh tools/three-ai.sh three-base ; then diff the two dirs: physics doesn't use three, so they must match
O=tools/build/${1:-three-base}/ai; mkdir -p "$O"
run(){ n=$1; s=$2; e=$3
 node tools/page-run.js tools/$s "$e" > "$O/$n.json" 2> "$O/$n.err" && echo "ok  $n" || echo "ERR $n"; }
run ka    kickangle-soak.js  "kaSoak({seeds:8,secs:120})"
run catch catch-soak.js      "catchSoak({seeds:8,secs:120,on:true})"
run bs    backswing-soak.js  "bsSoak({seeds:8,secs:120})"
run hs    humanseat-soak.js  "hsSoak({seeds:6,secs:120})"
run gk    keeper-soak.js     "gkCheck()"
run tr    trials-soak.js     "trSeeds({n:4})"
run ts    tutorial-soak.js   "tsAll()"
run pa    pinassist-soak.js  "paAll()"
run fh    fwdhuman-soak.js   "fhAll()"
