#!/bin/sh
# renders the three-upgrade reference frame set into tools/build/<out>/frames (run from the repo root)
# sh tools/three-frames.sh three-base
O=tools/build/${1:-three-base}/frames; J=$O/json; mkdir -p "$J"
run(){ n=$1; s=$2; e=$3; shift 3
 node tools/page-run.js --log "$@" tools/$s "$e" > "$J/$n.json" 2> "$J/$n.err" && node tools/fx-shots-save.js "$J/$n.json" "$O/$n" "$n" > /dev/null && echo "ok  $n" || echo "ERR $n"; }
run room  room-shots.js  "roomShots({rooms:['arcade','open','saucer','moon'],cams:['home',0,2,4]})"
run goal  fx-shots.js    "fxShots({what:'goal',at:[0.05,0.2,0.5,1.2]})"
run cannon fx-shots.js   "fxShots({what:'cannon',at:[0.05,0.2,0.5]})"
run pickup fx-shots.js   "fxShots({what:'pickup',at:[0.05,0.3,0.8]})"
run finale fx-shots.js   "fxShots({what:'finale',at:[0.2,1,2.5]})"
run fire  fire-shots.js  "fireShots({})"
run ice   ice-shots.js   "iceShots({team:1,at:[0.05,0.3,1,2.6,4.25,4.6],hold:4})"
run boost boost-shots.js "boostShots({at:[2,4,7,15,30]})"
run cine  cine-shots.js  "cineShots({secs:40,seed:7})" --size=1280x720
