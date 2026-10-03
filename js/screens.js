'use strict';
/* ===== screens — navigation router ===== */
// one registry for every full-page screen you navigate to: showScreen(id) hides the rest, backScreen() reads the entry's `back`
// overlays (#pause, #win, #lgForfeit, #lgTape, #lgSeasonEnd) are not registered: they stack on top and own their visibility; hideScreens() leaves them alone
// an entry: back = id for backScreen() / Esc (null = top level); lay = layout-editor block(s) (js/layout.js; presence alone makes panels arrangeable; persists under cfg.layouts[key], never rename one); onShow(prevId) / onHide(nextId) hooks (screens attach their own, which makes Esc run the same teardown as Back)
// elements are resolved lazily on every call, never cached
const SCREENS={
 home:{back:null},                    // the landing screen: top of the tree, Esc falls through here
 // 'menu' is the KICK OFF screen (id kept so cfg.layouts saves survive); two tabs = two lay blocks, saved separately; the 'menu' key must stay on the team tab
 menu:{back:'home',lay:[
  {key:'menu',wrap:'#menuTab_team .panelWrap',btn:'menuEditLayout',
   panels:['menuKitPanel0','menuTeamPanel','menuKitPanel1']},
  {key:'menuRules',wrap:'#menuTab_rules .panelWrap',btn:'menuRulesEditLayout',
   panels:['menuSetupPanel','menuTablePanel']}]},
 // dev tool: the card that reaches it is gated on CONFIG.debug.roomEditor, not the route
 roomEdit:{back:'home'},
 // TRAINING is a two-route section (the sandbox, js/training.js, and Skill Trials); #trials is registered here so the route always exists and a stale back-target can't strand anyone
 training:{back:'home'},
 trials:{back:'training'},
 // the tutorial's control picker; back is rewritten per open (tutOpen)
 tutorial:{back:'training'},
 // the daily is its own top-level route (buried under Training it goes unnoticed); registered even when CONFIG.trials.daily.on is false, which only hides the card
 daily:{back:'home'},
 customize:{back:'menu'},             // only reachable from the Kick Off kit panel
 lgSlots:{back:'home'},
 lgSetup:{back:'lgSlots'},
 // three tabs (Season / Squad / Club); the 'league' key stays on Season so older saves apply
 league:{back:'home',lay:[
  {key:'league',wrap:'#lgTab_season .lgWrap',btn:'lgEditLayout',panels:['lgStandingsPanel','lgFixturePanel','lgLastPanel','lgScout']},
  {key:'leagueClub',wrap:'#lgTab_club .lgWrap',btn:'lgClubEditLayout',panels:['lgSettingsPanel','lgHistPanel','lgCabinetPanel']}]},
 // back:null on purpose: leaving the cup bracket isn't a plain screen change (cupReturn() clears S.lg via gotoMenu before re-opening the lobby); give it a `back` only once that teardown is an onHide
 // tabbed like the league (Cup / Squad / Club); the 'championsCup' key stays on the Cup tab
 championsCup:{back:null,lay:[
  {key:'championsCup',wrap:'#cupTab_cup .lgWrap',btn:'cupEditLayout',panels:['cupBracketPanel','cupFixturePanel','cupScout']},
  {key:'cupClub',wrap:'#cupTab_club .lgWrap',btn:'cupClubEditLayout',panels:['cupSettingsPanel','cupHistPanel']}]},
 options:{back:'menu'}   // rewritten per-open by openOptions — Options is reachable from several screens
};
let scrCur='home';                                   // #home is the screen live at boot (the intro reveals it)
function screenId(){return scrCur;}
// hide every registered screen (overlays untouched); used by the match start, which tears the stack down without navigating
function hideScreens(){for(const id in SCREENS){const el=$(id);if(el)el.classList.add('hidden');}}
function showScreen(id){
 const d=SCREENS[id];if(!d)return false;
 const el=$(id);if(!el)return false;
 const prev=scrCur,pd=SCREENS[prev];
 if(pd&&pd.onHide&&prev!==id)pd.onHide(id);
 hideScreens();
 el.classList.remove('hidden');
 scrCur=id;
 // a screen change arrives behind one diagonal wipe (.scrIn); the class comes off when it ends so no clip-path cuts the pad cursor's ring
 if(prev!==id){el.classList.remove('scrIn');void el.offsetWidth;el.classList.add('scrIn');
  el.addEventListener('animationend',function e(ev){if(ev.target!==el)return;el.classList.remove('scrIn');el.removeEventListener('animationend',e);});}
 // re-clamp saved panel arrangements to the window; called for every screen, since it's also how layout.js notices an open editor was navigated away from (layEditGuard)
 if(typeof layApplyScreen==='function')layApplyScreen(id);
 if(d.onShow)d.onShow(prev);
 return true;
}
// one step back up the tree; false at a top-level screen so Esc on the menu still reaches togglePause
function backScreen(){
 const d=SCREENS[scrCur];
 return !!(d&&d.back)&&showScreen(d.back);
}
