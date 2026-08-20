'use strict';
/* ===== screens — navigation router ===== */
/* One registry for every full-page screen you NAVIGATE to. Before this, "go back to the menu"
   was a raw $('menu').classList.remove('hidden') repeated across seven files (intro, flow,
   customize, options, league ×5, input), so adding ONE screen meant editing all of them — which
   is exactly what made a landing page expensive. Now: showScreen(id) hides the rest and shows
   one, backScreen() reads the entry's `back`.

   OVERLAYS ARE DELIBERATELY NOT REGISTERED. #pause, #win, #lgForfeit, #lgTape and #lgSeasonEnd
   carry class="screen" but they stack ON TOP of whatever screen is underneath rather than
   replacing it, and their own code owns their visibility. hideScreens() therefore leaves them
   alone; a caller that also wants them down (startMatchNow, openCup) hides them itself.

   A registry entry:
     back — id shown by backScreen() / Esc. null = top level, Esc falls through to the caller.
     lay  — optional layout-editor block (js/layout.js), or an ARRAY of them when the screen has
            tabs (Kick Off has one per tab, each arranged and saved separately). ITS PRESENCE IS
            THE ONLY THING NEEDED to make panels drag/resizable: layApplyScreen(id) runs on every
            show, the ⊞ buttons are wired at layout.js load, and each block persists under
            cfg.layouts[key] (key defaults to the screen id — DON'T rename one, saves are keyed
            on it). wrap = panel-container selector, btn = ⊞ button's element id, panels = the
            draggable panel ids (they need stable ids in index.html).
     onShow(prevId) / onHide(nextId) — optional hooks, run AFTER the class flip so anything
            they measure is live. Screens ATTACH THEIR OWN hooks from their own file
            (SCREENS.customize.onHide=… in customize.js) rather than having them declared here,
            so this file stays pure routing and never reaches into another module's state.
            The hooks are what make Esc safe: backScreen() out of a screen runs the same
            teardown its Back button would.

   Elements are resolved LAZILY on every call, never cached, so this file can load before the
   DOM has settled and before any screen's own module has parsed. */
const SCREENS={
 home:{back:null},                    // the landing screen — top of the tree, Esc falls through here
 // "menu" is the KICK OFF screen; the id is kept so cfg.layouts saves survive. It has TWO tabs,
 // hence two lay blocks — each arranged and saved independently (see js/layout.js). The 'menu'
 // KEY must stay on the team tab: it's what existing cfg.layouts saves are stored under.
 // Match Setup lives in its own tab because it's tall, and underneath a team panel holding four
 // players it would be pushed off the bottom of the screen.
 menu:{back:'home',lay:[
  {key:'menu',wrap:'#menuTab_team .panelWrap',btn:'menuEditLayout',
   panels:['menuKitPanel0','menuTeamPanel','menuKitPanel1']},
  {key:'menuRules',wrap:'#menuTab_rules .panelWrap',btn:'menuRulesEditLayout',
   panels:['menuSetupPanel','menuTablePanel','menuAudioPanel']}]},
 // Dev tool. Registered like any other screen so Esc and the router work on it for free; the
 // CARD that reaches it is what's gated on CONFIG.debug.roomEditor, not the route itself.
 roomEdit:{back:'home'},
 customize:{back:'menu'},             // only reachable from the Kick Off kit panel
 lgSlots:{back:'home'},
 lgSetup:{back:'lgSlots'},
 league:{back:'home',lay:{wrap:'#league .lgWrap',btn:'lgEditLayout',
  panels:['lgStandingsPanel','lgHistPanel','lgFixturePanel','lgLastPanel','lgSettingsPanel','lgSquadPanel','lgScout']}},
 // back:null on purpose — leaving the cup bracket is NOT a plain screen change. Arriving here
 // from a finished tie's win screen leaves S.lg still set, and cupReturn() (the Back button)
 // clears it via gotoMenu before re-opening the lobby with fresh content. A bare
 // showScreen('league') would strand the bridge and render a stale lobby, so Esc falls through
 // here exactly as it did before. Give this a `back` only once that teardown is an onHide.
 championsCup:{back:null,lay:{wrap:'#championsCup .lgWrap',btn:'cupEditLayout',
  panels:['cupBracketPanel','cupFixturePanel','cupSettingsPanel','cupHistPanel','cupSquadPanel','cupScout']}},
 options:{back:'menu'}   // rewritten per-open by openOptions — Options is reachable from several screens
};
let scrCur='home';                                   // #home is the screen live at boot (the intro reveals it)
function screenId(){return scrCur;}
/* Hide every REGISTERED screen (overlays untouched — see header). Used by the match start,
   which tears the whole menu stack down without navigating anywhere. */
function hideScreens(){for(const id in SCREENS){const el=$(id);if(el)el.classList.add('hidden');}}
function showScreen(id){
 const d=SCREENS[id];if(!d)return false;
 const el=$(id);if(!el)return false;
 const prev=scrCur,pd=SCREENS[prev];
 if(pd&&pd.onHide&&prev!==id)pd.onHide(id);
 hideScreens();
 el.classList.remove('hidden');
 scrCur=id;
 // Re-clamp every saved panel arrangement on this screen to the live window. Called for EVERY
 // screen, not just ones with a `lay` block: it is also where layout.js notices that an open
 // layout editor has just been navigated away from and shuts it down (layEditGuard). Gate it on
 // d.lay again and Esc-ing out of the league mid-edit strands the editor, because #home has no
 // block to route the call through.
 if(typeof layApplyScreen==='function')layApplyScreen(id);
 if(d.onShow)d.onShow(prev);
 return true;
}
/* One step back up the tree. Returns false at a top-level screen so the caller can fall
   through (Esc on the menu should still reach togglePause, not swallow the key). */
function backScreen(){
 const d=SCREENS[scrCur];
 return !!(d&&d.back)&&showScreen(d.back);
}
