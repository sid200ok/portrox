/**
 * Portrox Studio UI. Zero CDN, zero build step.
 *
 * HARD RULE: the browser <script> is emitted from a template literal, so a
 * bare \n would become a REAL newline inside a single-quoted JS string and
 * break the whole script. Use the NL constant instead. Never write \n here.
 * scripts/verify-ui.mjs syntax-checks the EMITTED script to enforce this.
 */

const SPRITE = `<svg style="display:none" aria-hidden="true">
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></symbol>
<symbol id="i-layers" viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></symbol>
<symbol id="i-cog" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-eyeoff" viewBox="0 0 24 24"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.6 6.6A13.3 13.3 0 0 0 2 11s3.6 7 10 7a9 9 0 0 0 5.4-1.6"/><path d="m2 2 20 20"/></symbol>
<symbol id="i-out" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></symbol>
<symbol id="i-up" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></symbol>
<symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></symbol>
<symbol id="i-git" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-key" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 8.3-8.3 3 3-3 3-2-2-2 2-2-2"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></symbol>
<symbol id="i-ext" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/></symbol>
<symbol id="i-menu" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></symbol>
<symbol id="i-panel" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="m6 3 14 9-14 9V3Z"/></symbol>
<symbol id="i-palette" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="8.5" cy="9.5" r="1.2"/><circle cx="15.5" cy="9.5" r="1.2"/><circle cx="12" cy="15" r="1.2"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></symbol>
</svg>`;

const CSS = `
*,*::before,*::after{box-sizing:border-box}
:root{--bg:#020617;--surface:#0f172a;--surface2:#131f38;--raise:#182642;--line:#1e293b;--line2:#293548;
--fg:#e2e8f0;--muted:#94a3b8;--dim:#64748b;--acc:#22d3ee;--accink:#04222b;--ok:#4ade80;--warn:#fbbf24;--err:#f87171;
--sb:250px;--tb:56px;--r:12px;--rs:9px;--sh:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6)}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
svg.i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none}
svg.i.lg{width:20px;height:20px}
a{color:var(--acc);text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px;border-radius:6px}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:#243350;border-radius:8px;border:2px solid var(--bg)}
.hide{display:none!important}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}

/* auth */
.auth{min-height:100%;display:grid;place-items:center;padding:24px;background:radial-gradient(900px 480px at 50% -8%,rgba(34,211,238,.14),transparent 62%),var(--bg)}
.authcard{width:100%;max-width:396px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:30px;box-shadow:var(--sh)}
.brand{display:flex;align-items:center;gap:10px}
.mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(140deg,var(--acc),#3b82f6);color:var(--accink);font-weight:800;font-size:15px;flex:none}
.brand h1{margin:0;font-size:17px;letter-spacing:-.02em}
.brand small{display:block;color:var(--dim);font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.auth h2{margin:22px 0 4px;font-size:19px;letter-spacing:-.02em}
.auth p.sub{margin:0 0 20px;color:var(--muted);font-size:13px}
.authfoot{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);color:var(--dim);font-size:11.5px;display:flex;justify-content:space-between;gap:8px}

/* fields */
.field{margin-bottom:14px}
.field>label{display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px}
.inp{width:100%;padding:10px 12px;background:#0b1220;border:1px solid var(--line2);border-radius:var(--rs);color:var(--fg);font:inherit;transition:border-color .15s,box-shadow .15s}
.inp::placeholder{color:#4b5b74}
.inp:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(34,211,238,.14)}
select.inp{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 17px) 18px,calc(100% - 12px) 18px;background-size:5px 5px;background-repeat:no-repeat;padding-right:32px}
.pw{position:relative}.pw .inp{padding-right:40px}
.pw button{position:absolute;right:4px;top:4px;width:32px;height:32px;display:grid;place-items:center;background:none;border:0;color:var(--muted);cursor:pointer;border-radius:7px}
.pw button:hover{color:var(--fg);background:var(--raise)}
.hint{font-size:11.5px;color:var(--dim);margin:5px 0 0}
.row{display:flex;gap:10px;align-items:center}.row.wrap{flex-wrap:wrap}
.check{display:flex;gap:9px;align-items:flex-start;font-size:12.5px;color:var(--muted);cursor:pointer}
.check input{margin:2px 0 0;accent-color:var(--acc);width:15px;height:15px;flex:none}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 15px;border-radius:var(--rs);border:1px solid var(--line2);background:var(--raise);color:var(--fg);font-weight:600;font-size:13px;cursor:pointer;transition:background .15s,border-color .15s,transform .08s;white-space:nowrap}
.btn:hover{background:#1f2f4f;border-color:#3a4a66}.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.5;cursor:not-allowed;transform:none}
.btn.pri{background:var(--acc);border-color:var(--acc);color:var(--accink)}
.btn.pri:hover{background:#67e8f9;border-color:#67e8f9}
.btn.ghost{background:transparent}.btn.ghost:hover{background:var(--raise)}
.btn.danger{color:var(--err);border-color:#4c2230}.btn.danger:hover{background:#2a1420}
.btn.block{width:100%}.btn.sm{padding:6px 11px;font-size:12px}
.btn.busy{pointer-events:none;opacity:.7}
.iconbtn{width:32px;height:32px;display:grid;place-items:center;background:none;border:1px solid transparent;color:var(--muted);cursor:pointer;border-radius:8px;flex:none}
.iconbtn:hover{background:var(--raise);color:var(--fg);border-color:var(--line2)}

/* shell + sliding nav */
.app{display:grid;grid-template-columns:var(--sb) 1fr;min-height:100vh;transition:grid-template-columns .22s ease}
body.navcollapsed{--sb:66px}
body.navright .app{grid-template-columns:1fr var(--sb)}
body.navright .sb{order:2;border-right:0;border-left:1px solid var(--line)}
body.navright .main{order:1}
.sb{background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:hidden;z-index:120}
.sbhead{height:var(--tb);display:flex;align-items:center;gap:10px;padding:0 14px;border-bottom:1px solid var(--line);flex:none}
.sbhead .mark{width:26px;height:26px;border-radius:8px;font-size:12px}
.sbhead b{font-size:14.5px;letter-spacing:-.01em;white-space:nowrap}
.nav{padding:14px 10px;flex:1;overflow-y:auto;overflow-x:hidden}
.nav .lbl{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);padding:0 8px;margin:0 0 7px;white-space:nowrap}
.nav a{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--rs);color:var(--muted);font-weight:600;font-size:13px;margin-bottom:2px;transition:background .13s,color .13s;white-space:nowrap}
.nav a:hover{background:var(--raise);color:var(--fg);text-decoration:none}
.nav a.on{background:rgba(34,211,238,.11);color:var(--acc)}
.sbfoot{padding:12px;border-top:1px solid var(--line);font-size:11.5px;color:var(--dim);flex:none}
.sbfoot .u{display:flex;align-items:center;gap:9px;margin-bottom:9px}
.av{width:26px;height:26px;border-radius:50%;background:linear-gradient(140deg,var(--acc),#3b82f6);color:var(--accink);display:grid;place-items:center;font-weight:800;font-size:11px;flex:none}
.uname{color:var(--fg);font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
body.navcollapsed .nav .lbl,body.navcollapsed .nav a span,body.navcollapsed .sbhead b,
body.navcollapsed .sbfoot .u>div,body.navcollapsed .sbfoot .ver,body.navcollapsed .sbfoot .btn span{display:none}
body.navcollapsed .nav a{justify-content:center;padding:10px}
body.navcollapsed .sbhead{justify-content:center;padding:0}
body.navcollapsed .sbfoot .u{justify-content:center}
body.navcollapsed .sbfoot .btn{padding:8px}
.scrim{position:fixed;inset:0;background:rgba(2,6,23,.66);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .2s;z-index:110}
.main{display:flex;flex-direction:column;min-width:0}
.tb{height:var(--tb);position:sticky;top:0;z-index:20;background:rgba(2,6,23,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 18px}
.tb h2{margin:0;font-size:15px;letter-spacing:-.01em;font-weight:700}
.tb .crumb{color:var(--dim);font-size:11.5px;font-weight:500}
.tbl{display:flex;align-items:center;gap:11px;min-width:0}
.content{padding:20px;max-width:1200px;width:100%}
@media(max-width:900px){
  .app,body.navright .app{grid-template-columns:1fr}
  .sb{position:fixed;top:0;bottom:0;left:0;width:272px;transform:translateX(-100%);transition:transform .24s ease;border-right:1px solid var(--line)}
  body.navright .sb{left:auto;right:0;transform:translateX(100%);border-left:1px solid var(--line);border-right:0}
  body.navopen .sb{transform:none;box-shadow:0 0 60px rgba(0,0,0,.6)}
  body.navopen .scrim{opacity:1;pointer-events:auto}
  body.navcollapsed{--sb:250px}
  body.navcollapsed .nav .lbl,body.navcollapsed .nav a span,body.navcollapsed .sbhead b,
  body.navcollapsed .sbfoot .u>div,body.navcollapsed .sbfoot .ver,body.navcollapsed .sbfoot .btn span{display:revert}
  body.navcollapsed .nav a{justify-content:flex-start;padding:9px 10px}
  .content{padding:16px}
}

/* banner + cards */
.banner{display:flex;gap:11px;align-items:flex-start;padding:12px 14px;border-radius:var(--r);margin-bottom:16px;font-size:13px;border:1px solid}
.banner.warn{background:rgba(251,191,36,.07);border-color:rgba(251,191,36,.3);color:#fcd34d}
.banner b{color:#fff}.banner .btn{margin-left:auto}
.grid{display:grid;gap:14px}
.g4{grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.g2{grid-template-columns:repeat(auto-fit,minmax(330px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:17px}
.card>header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:13px}
.card h3{margin:0;font-size:13.5px;font-weight:700;letter-spacing:-.01em}
.card .desc{color:var(--muted);font-size:12.5px;margin:0 0 14px}
.metric .k{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px;font-weight:600;margin-bottom:9px}
.metric .v{font-size:25px;font-weight:800;letter-spacing:-.03em;line-height:1.1}
.metric .n{font-size:11.5px;color:var(--dim);margin-top:5px;word-break:break-all}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;white-space:nowrap}
.pill.ok{color:var(--ok);background:rgba(74,222,128,.09);border-color:rgba(74,222,128,.3)}
.pill.warn{color:var(--warn);background:rgba(251,191,36,.09);border-color:rgba(251,191,36,.3)}
.pill.err{color:var(--err);background:rgba(248,113,113,.09);border-color:rgba(248,113,113,.3)}
.pill.acc{color:var(--acc);background:rgba(34,211,238,.09);border-color:rgba(34,211,238,.3)}
.pill.mute{color:var(--muted);background:var(--raise);border-color:var(--line2)}
.dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.tblwrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:10px 13px;font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);background:#0c1526;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 13px;border-bottom:1px solid var(--line);vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover{background:#101c33}
td .name{font-weight:700;font-size:13px}
td .sub{color:var(--dim);font-size:11.5px;margin-top:2px}
td.act{text-align:right;white-space:nowrap}td.act .btn{margin-left:5px}
.empty{text-align:center;padding:44px 22px}
.empty .ic{width:46px;height:46px;border-radius:13px;background:var(--raise);display:grid;place-items:center;margin:0 auto 14px;color:var(--acc)}
.empty h4{margin:0 0 6px;font-size:15px}
.empty p{margin:0 auto 17px;color:var(--muted);font-size:13px;max-width:400px}
pre.log,.log{background:#080e1b;border:1px solid var(--line);border-radius:var(--r);padding:13px;max-height:300px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.65;margin:0;white-space:pre-wrap;word-break:break-word}
.log .ln{display:flex;gap:10px;padding:1px 0}
.log .t{color:#4b5b74;flex:none}
.log .ok .m{color:var(--ok)}.log .err .m{color:var(--err)}.log .warn .m{color:var(--warn)}
.steps{list-style:none;margin:0;padding:0}
.steps li{display:flex;gap:11px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--line)}
.steps li:last-child{border-bottom:0}
.tick{width:20px;height:20px;border-radius:50%;border:1.5px solid var(--line2);display:grid;place-items:center;flex:none;margin-top:1px;color:transparent}
.steps li.done .tick{background:rgba(74,222,128,.14);border-color:var(--ok);color:var(--ok)}
.steps .tx b{display:block;font-size:13px;font-weight:600}
.steps .tx span{font-size:12px;color:var(--muted)}
.steps li.done .tx b{color:var(--muted);text-decoration:line-through}
.bar{height:5px;border-radius:99px;background:var(--raise);overflow:hidden;margin:4px 0 15px}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),#3b82f6);transition:width .4s}
.split{display:grid;grid-template-columns:190px 1fr;gap:20px;align-items:start}
.subnav{display:flex;flex-direction:column;gap:2px;position:sticky;top:calc(var(--tb) + 20px)}
.subnav button{text-align:left;padding:8px 11px;border-radius:var(--rs);background:none;border:0;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer;display:flex;gap:9px;align-items:center}
.subnav button:hover{background:var(--raise);color:var(--fg)}
.subnav button.on{background:rgba(34,211,238,.11);color:var(--acc)}
@media(max-width:900px){.split{grid-template-columns:1fr}.subnav{flex-direction:row;position:static;overflow-x:auto}}
.kv{display:grid;grid-template-columns:auto 1fr;gap:7px 16px;font-size:12.5px;margin:0}
.kv dt{color:var(--dim)}.kv dd{margin:0;font-weight:600;word-break:break-all}
h4.sec{margin:0 0 11px;font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--dim)}
p.note{color:var(--muted);font-size:12.5px;margin:0 0 14px}
.hr{height:1px;background:var(--line);margin:18px 0}
.sw{display:flex;gap:8px;flex-wrap:wrap}
.sw i{width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);display:block}
.alert{padding:10px 13px;border-radius:var(--rs);font-size:12.5px;margin-bottom:14px;border:1px solid}
.alert.err{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.3);color:#fca5a5}
.alert.ok{background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.3);color:#86efac}
.alert.warn{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.3);color:#fcd34d}
.ov{position:fixed;inset:0;background:rgba(2,6,23,.76);backdrop-filter:blur(3px);display:grid;place-items:center;padding:22px;z-index:200}
.modal{width:100%;max-width:520px;max-height:88vh;overflow:auto;background:var(--surface);border:1px solid var(--line2);border-radius:15px;box-shadow:0 24px 64px -16px rgba(0,0,0,.8)}
.modal.wide{max-width:660px}
.modal>header{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:19px 21px;border-bottom:1px solid var(--line)}
.modal>header h3{margin:0;font-size:15.5px}
.modal>header p{margin:4px 0 0;color:var(--muted);font-size:12.5px}
.modal .body{padding:21px}
.modal>footer{display:flex;justify-content:flex-end;gap:9px;padding:15px 21px;border-top:1px solid var(--line);background:#0c1526}
.toasts{position:fixed;right:18px;bottom:18px;z-index:300;display:flex;flex-direction:column;gap:9px;max-width:370px}
.toast{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:var(--r);background:var(--surface2);border:1px solid var(--line2);box-shadow:var(--sh);font-size:13px}
.toast.ok{border-left:3px solid var(--ok)}.toast.err{border-left:3px solid var(--err)}.toast.info{border-left:3px solid var(--acc)}
.toast .m{flex:1;word-break:break-word}
`;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (n, cls) => `<svg class="i ${cls || ''}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

/* ---------------------------------------------------------------- LOGIN */
export function renderLogin({ csrf, state, port }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Sign in · Portrox</title>
<style>${CSS}</style></head><body>
${SPRITE}
<div class="auth"><div class="authcard">
  <div class="brand"><div class="mark">P</div><div><h1>Portrox</h1><small>Portfolio Studio</small></div></div>
  <div id="p-login">
    <h2>Sign in</h2><p class="sub">Local instance · reachable only from this machine.</p>
    <div id="l-err" class="alert err hide"></div>
    ${state.weakPassword ? '<div class="alert warn">The password is still the shipped default (<b>admin</b>). You will be asked to change it.</div>' : ''}
    <form id="f-login">
      <div class="field"><label for="u">Username</label><input class="inp" id="u" autocomplete="username" required autofocus value="${state.usingDefaults ? 'admin' : ''}"></div>
      <div class="field"><label for="p">Password</label><div class="pw"><input class="inp" id="p" type="password" autocomplete="current-password" required><button type="button" id="tg1" aria-label="Show password">${ic('eye')}</button></div></div>
      <button class="btn pri block" type="submit" id="go">Sign in</button>
    </form>
    <div class="hr"></div>
    <button class="btn ghost block sm" id="to-rec">${ic('key')}<span>Forgot username or password?</span></button>
  </div>
  <div id="p-rec" class="hide">
    <h2>Recover access</h2><p class="sub">Answer your security questions, or use your recovery key.</p>
    <div id="r-err" class="alert err hide"></div>
    <div id="r-none" class="alert warn hide">No recovery method configured. From a terminal on this machine run:<br><span class="mono">node packages/cli/auth-store.mjs reset</span></div>
    <div id="r-body">
      <div class="row" style="margin-bottom:14px"><button class="btn sm" id="tab-q" type="button">Questions</button><button class="btn sm ghost" id="tab-k" type="button">Recovery key</button></div>
      <form id="f-rq"><div id="q-list"></div><p class="hint" id="q-need"></p><button class="btn pri block" type="submit">Verify answers</button></form>
      <form id="f-rk" class="hide"><div class="field"><label for="rk">Recovery key</label><input class="inp mono" id="rk" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off"></div><button class="btn pri block" type="submit">Verify key</button></form>
    </div>
    <div class="hr"></div><button class="btn ghost block sm" id="back">Back to sign in</button>
  </div>
  <div id="p-reset" class="hide">
    <h2>Set new credentials</h2><p class="sub">Recovery verified. Choose a new username and password.</p>
    <div id="s-err" class="alert err hide"></div>
    <form id="f-reset">
      <div class="field"><label for="nu">New username</label><input class="inp" id="nu" autocomplete="username" required></div>
      <div class="field"><label for="np">New password</label><div class="pw"><input class="inp" id="np" type="password" autocomplete="new-password" required minlength="8"><button type="button" id="tg2" aria-label="Show password">${ic('eye')}</button></div><p class="hint">Minimum 8 characters.</p></div>
      <div class="field"><label for="np2">Confirm password</label><input class="inp" id="np2" type="password" autocomplete="new-password" required></div>
      <button class="btn pri block" type="submit">Save and sign in</button>
    </form>
  </div>
  <div class="authfoot"><span>127.0.0.1:${esc(port)}</span><span>Portrox · MIT</span></div>
</div></div>
<script>
var CSRF=${JSON.stringify(csrf)},ST=${JSON.stringify(state)},RT=null;
function $(i){return document.getElementById(i)}
function show(e,m){e.textContent=m;e.classList.remove('hide')}
function hide(e){e.classList.add('hide')}
function pane(n){['login','rec','reset'].forEach(function(x){$('p-'+x).classList.toggle('hide',x!==n)})}
function post(p,b){return fetch(p,{method:'POST',headers:{'Content-Type':'application/json','x-portrox-token':CSRF},body:JSON.stringify(b||{})}).then(function(r){return r.json().catch(function(){return{error:'Bad response'}}).then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j})})}
function pw(btn,inp){btn.onclick=function(){var s=inp.type==='password';inp.type=s?'text':'password';btn.innerHTML='<svg class="i"><use href="#i-'+(s?'eyeoff':'eye')+'"/></svg>';inp.focus()}}
pw($('tg1'),$('p'));pw($('tg2'),$('np'));
$('f-login').onsubmit=function(e){e.preventDefault();hide($('l-err'));var b=$('go');b.disabled=true;b.textContent='Signing in…';
  post('/api/auth/login',{username:$('u').value,password:$('p').value}).then(function(){location.reload()}).catch(function(x){show($('l-err'),x.message);b.disabled=false;b.textContent='Sign in';$('p').select()})};
$('to-rec').onclick=function(){pane('rec');
  if(!ST.recoveryConfigured&&!ST.recoveryKeySet){$('r-none').classList.remove('hide');$('r-body').classList.add('hide');return}
  var h='';ST.recoveryQuestions.forEach(function(q){h+='<div class="field"><label>'+q.label+'</label><input class="inp" data-q="'+q.id+'" autocomplete="off"></div>'});
  $('q-list').innerHTML=h||'<p class="note">No questions configured.</p>';
  $('q-need').textContent='Answer at least '+ST.recoveryRequired+' correctly.';
  $('tab-q').classList.toggle('hide',!ST.recoveryConfigured);$('tab-k').classList.toggle('hide',!ST.recoveryKeySet);
  if(!ST.recoveryConfigured&&ST.recoveryKeySet){$('f-rq').classList.add('hide');$('f-rk').classList.remove('hide');$('tab-k').classList.remove('ghost');$('tab-q').classList.add('ghost')}};
$('back').onclick=function(){pane('login')};
$('tab-q').onclick=function(){$('f-rq').classList.remove('hide');$('f-rk').classList.add('hide');$('tab-q').classList.remove('ghost');$('tab-k').classList.add('ghost')};
$('tab-k').onclick=function(){$('f-rk').classList.remove('hide');$('f-rq').classList.add('hide');$('tab-k').classList.remove('ghost');$('tab-q').classList.add('ghost')};
$('f-rq').onsubmit=function(e){e.preventDefault();hide($('r-err'));var a=[];document.querySelectorAll('[data-q]').forEach(function(i){if(i.value.trim())a.push({id:i.getAttribute('data-q'),value:i.value})});
  post('/api/auth/recover',{answers:a}).then(function(j){RT=j.resetToken;pane('reset');$('nu').focus()}).catch(function(x){show($('r-err'),x.message)})};
$('f-rk').onsubmit=function(e){e.preventDefault();hide($('r-err'));
  post('/api/auth/recover',{key:$('rk').value}).then(function(j){RT=j.resetToken;pane('reset');$('nu').focus()}).catch(function(x){show($('r-err'),x.message)})};
$('f-reset').onsubmit=function(e){e.preventDefault();hide($('s-err'));
  if($('np').value!==$('np2').value){show($('s-err'),'Passwords do not match.');return}
  post('/api/auth/reset',{resetToken:RT,username:$('nu').value,password:$('np').value}).then(function(){location.reload()}).catch(function(x){show($('s-err'),x.message)})};
</script></body></html>`;
}

/* ------------------------------------------------------------------ APP */
export function renderApp({ csrf, auth, port, pid, version }) {
  const initial = (auth.username || 'A').slice(0, 2).toUpperCase();
  const navItem = (route, icon, label) =>
    `<a href="#/${route}" data-nav="${route}" title="${label}">${ic(icon)}<span>${label}</span></a>`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Portrox Studio</title>
<style>${CSS}</style></head><body>
${SPRITE}
<div class="scrim" id="scrim"></div>
<div class="app">
  <aside class="sb" id="sb">
    <div class="sbhead"><div class="mark">P</div><b>Portrox</b></div>
    <nav class="nav">
      <p class="lbl">Workspace</p>
      ${navItem('dashboard', 'grid', 'Dashboard')}
      ${navItem('studio', 'layers', 'Studio')}
      <p class="lbl" style="margin-top:16px">Configure</p>
      ${navItem('settings', 'cog', 'Settings')}
      ${navItem('about', 'info', 'About app')}
    </nav>
    <div class="sbfoot">
      <div class="u"><div class="av">${esc(initial)}</div><div style="min-width:0"><div class="uname">${esc(auth.username)}</div><div>Local administrator</div></div></div>
      <button class="btn ghost sm block" id="signout" title="Sign out">${ic('out')}<span>Sign out</span></button>
      <div class="ver" style="margin-top:9px;text-align:center">v${esc(version)} · 127.0.0.1:${esc(port)}</div>
    </div>
  </aside>
  <div class="main">
    <header class="tb">
      <div class="tbl">
        <button class="iconbtn" id="navtoggle" title="Toggle navigation (Ctrl+B)" aria-label="Toggle navigation">${ic('menu')}</button>
        <div style="min-width:0"><h2 id="ttl">Dashboard</h2><div class="crumb" id="crumb">Portrox / Overview</div></div>
      </div>
      <div class="row">
        <span class="pill mute" id="sync">loading…</span>
        <span class="pill ok"><span class="dot"></span>Daemon active</span>
        <button class="iconbtn" id="refresh" title="Refresh" aria-label="Refresh">${ic('refresh')}</button>
      </div>
    </header>
    <div class="content">
      <div id="secwarn" class="banner warn hide">${ic('alert', 'lg')}<div><b>Default password in use.</b> Any local process can sign in with it. Change the password now.</div><button class="btn sm" id="fixcreds">Change password</button></div>
      <div id="view"></div>
    </div>
  </div>
</div>
<div class="toasts" id="toasts"></div>
<div id="modalroot"></div>
<script>
var CSRF=${JSON.stringify(csrf)},AUTH=${JSON.stringify(auth)},PORT=${JSON.stringify(port)},PID=${JSON.stringify(pid)},VER=${JSON.stringify(version)};
var NL=String.fromCharCode(10);
var S={cfg:null,sites:[],route:'dashboard',sub:'supabase',sel:null,log:[],loading:true};
function $(i){return document.getElementById(i)}
function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function ic(n,c){return '<svg class="i '+(c||'')+'" aria-hidden="true"><use href="#i-'+n+'"/></svg>'}
function api(p,b){return fetch(p,{method:b?'POST':'GET',headers:{'Content-Type':'application/json','x-portrox-token':CSRF},body:b?JSON.stringify(b):undefined}).then(function(r){if(r.status===401){location.reload();throw new Error('Session expired')}return r.json().catch(function(){return{error:'Bad response'}}).then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j})})}
function toast(m,k){var t=document.createElement('div');t.className='toast '+(k||'info');t.innerHTML=ic(k==='err'?'alert':k==='ok'?'check':'info')+'<div class="m">'+h(m)+'</div>';$('toasts').appendChild(t);setTimeout(function(){t.remove()},k==='err'?7000:4200)}
function logline(m,k){S.log.unshift({t:new Date().toTimeString().slice(0,8),m:m,k:k||''});if(S.log.length>200)S.log.pop();var e=$('log');if(e)e.innerHTML=logHtml()}
function logHtml(){if(!S.log.length)return '<div class="ln"><span class="t">--:--:--</span><span class="m" style="color:var(--dim)">No activity yet in this session.</span></div>';return S.log.map(function(l){return '<div class="ln '+l.k+'"><span class="t">'+l.t+'</span><span class="m">'+h(l.m)+'</span></div>'}).join('')}

/* ---------- navigation: collapse / slide / side ---------- */
function ls(k,d){try{var v=localStorage.getItem(k);return v===null?d:v}catch(e){return d}}
function lss(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function applyNav(){
  document.body.classList.toggle('navcollapsed',ls('portrox.nav','expanded')==='collapsed');
  document.body.classList.toggle('navright',ls('portrox.side','left')==='right');
}
function toggleNav(){
  if(window.matchMedia('(max-width:900px)').matches){document.body.classList.toggle('navopen');return}
  var next=ls('portrox.nav','expanded')==='collapsed'?'expanded':'collapsed';
  lss('portrox.nav',next);applyNav();
}
function closeDrawer(){document.body.classList.remove('navopen')}
function setSide(v){lss('portrox.side',v);applyNav();render()}
function setCollapsed(v){lss('portrox.nav',v?'collapsed':'expanded');applyNav();render()}

/* ---------- modal ---------- */
function modal(o){
  var root=$('modalroot');
  root.innerHTML='<div class="ov" id="ov"><div class="modal'+(o.wide?' wide':'')+'" role="dialog" aria-modal="true"><header><div><h3>'+h(o.title)+'</h3>'+(o.sub?'<p>'+h(o.sub)+'</p>':'')+'</div><button class="iconbtn" id="mx" aria-label="Close">'+ic('x')+'</button></header><div class="body">'+o.body+'</div>'+(o.footer?'<footer>'+o.footer+'</footer>':'')+'</div></div>';
  function close(){root.innerHTML='';document.removeEventListener('keydown',key)}
  function key(e){if(e.key==='Escape')close()}
  document.addEventListener('keydown',key);
  $('mx').onclick=close;
  $('ov').onclick=function(e){if(e.target.id==='ov')close()};
  if(o.onMount)o.onMount(close);
  return close;
}
function busy(form,on){var b=form.querySelector('button[type=submit]');if(!b)return;b.disabled=on;b.classList.toggle('busy',on);if(on){b.dataset.t=b.textContent;b.textContent='Working…'}else if(b.dataset.t){b.textContent=b.dataset.t}}

/* ---------- shared fragments ---------- */
function metric(i,k,v,n){return '<div class="card metric"><div class="k">'+ic(i)+h(k)+'</div><div class="v">'+h(v)+'</div><div class="n">'+h(n)+'</div></div>'}
function empty(i,t,p,label,act){return '<div class="empty"><div class="ic">'+ic(i,'lg')+'</div><h4>'+h(t)+'</h4><p>'+h(p)+'</p>'+(label?'<button class="btn pri" data-act="'+act+'">'+ic('plus')+'<span>'+h(label)+'</span></button>':'')+'</div>'}
function statePill(c){return c.published?'<span class="pill ok"><span class="dot"></span>Live</span>':(c.registered?'<span class="pill acc">Registered</span>':'<span class="pill mute">Draft</span>')}
function siteTable(){
  return '<div class="tblwrap"><table><thead><tr><th>Site</th><th>Mode</th><th>State</th><th>Live URL</th><th></th></tr></thead><tbody>'
  +S.sites.map(function(s){var c=s.cfg||{},p=c.pages||{};
    return '<tr><td><div class="name">'+h(s.id)+'</div><div class="sub">'+h((c.seo&&c.seo.title)||'')+'</div></td>'
    +'<td><span class="pill mute">'+h(p.mode||'user')+'</span></td><td>'+statePill(c)+'</td>'
    +'<td class="mono" style="max-width:230px;overflow:hidden;text-overflow:ellipsis">'+(c.live_url?h(c.live_url):'<span style="color:var(--dim)">cname pending</span>')+'</td>'
    +'<td class="act"><button class="btn sm" data-act="detail" data-id="'+h(s.id)+'">Details</button>'
    +'<button class="btn sm" data-act="build" data-id="'+h(s.id)+'">Build</button>'
    +'<button class="btn sm" data-act="register" data-id="'+h(s.id)+'">Register</button>'
    +'<button class="btn sm pri" data-act="publish" data-id="'+h(s.id)+'">'+ic('up')+'<span>Publish</span></button>'
    +'<a class="btn sm ghost" href="/preview/'+encodeURIComponent(s.id)+'/" target="_blank" rel="noopener" title="Preview">'+ic('ext')+'</a></td></tr>'}).join('')
  +'</tbody></table></div>';
}
function setupSteps(){
  var c=S.cfg||{},sb=c.supabase||{},gh=c.github||{};
  return [
    {d:!AUTH.weakPassword,t:'Replace the default password',s:'Settings → Security'},
    {d:!!(sb.account&&sb.account.configured),t:'Connect Supabase account',s:'Personal access token (sbp_)'},
    {d:(sb.project_count||0)>0,t:'Load or create a project',s:'One account, many projects'},
    {d:!!sb.project_ready,t:'Fetch the publishable key',s:'Default project resolves URL + key'},
    {d:!!sb.schema_complete,t:'Bootstrap the Portrox schema',s:'Recorded against the default project'},
    {d:!!gh.configured,t:'Connect GitHub',s:'Personal access token, repo + workflow'},
    {d:S.sites.length>0,t:'Create a portfolio site',s:'user, project, org or custom mode'},
    {d:S.sites.some(function(s){return s.cfg&&s.cfg.registered}),t:'Register a site',s:'Create the tenant row under your owner id'},
    {d:S.sites.some(function(s){return s.cfg&&s.cfg.published}),t:'Publish to GitHub Pages',s:'Push the bundle and mark the site live'}
  ];
}

/* ---------- Dashboard ---------- */
function vDashboard(){
  var c=S.cfg||{},sb=c.supabase||{},gh=c.github||{},n=S.sites.length;
  var pub=S.sites.filter(function(s){return s.cfg&&s.cfg.published}).length;
  var steps=setupSteps(),done=steps.filter(function(s){return s.d}).length;
  return '<div class="grid g4" style="margin-bottom:16px">'
   +metric('layers','Sites',n,n===1?'1 portfolio workspace':'portfolio workspaces')
   +metric('up','Published',pub,pub?'live on GitHub Pages':'none live yet')
   +metric('db','Supabase',sb.db_ok?'Ready':(sb.project_ready?'Schema?':(sb.project_count?'Fetch key':'Off')),sb.project_ref||'no project')
   +metric('git','GitHub',gh.configured?(gh.login||'On'):'Off',gh.configured?'token validated':'not connected')
   +'</div><div class="grid g2">'
   +'<div class="card"><header><h3>Getting started</h3><span class="pill '+(done===steps.length?'ok':'acc')+'">'+done+'/'+steps.length+'</span></header>'
   +'<div class="bar"><i style="width:'+Math.round(done/steps.length*100)+'%"></i></div><ul class="steps">'
   +steps.map(function(s){return '<li class="'+(s.d?'done':'')+'"><span class="tick">'+ic('check')+'</span><span class="tx"><b>'+h(s.t)+'</b><span>'+h(s.s)+'</span></span></li>'}).join('')+'</ul></div>'
   +'<div class="card"><header><h3>Runtime</h3><span class="pill ok"><span class="dot"></span>Active</span></header>'
   +'<dl class="kv"><dt>Bind</dt><dd class="mono">127.0.0.1:'+h(PORT)+'</dd><dt>Process</dt><dd class="mono">'+h(PID)+'</dd>'
   +'<dt>Port</dt><dd>kernel-assigned, changes on restart</dd><dt>Exposure</dt><dd>loopback only</dd>'
   +'<dt>Studio</dt><dd>v'+h(VER)+'</dd><dt>Engine</dt><dd>Node 20+ · zero dependencies</dd></dl>'
   +'<div class="hr"></div><h4 class="sec">Recent activity</h4><div class="log" id="log">'+logHtml()+'</div></div></div>'
   +'<div class="card" style="margin-top:14px"><header><h3>Sites</h3><button class="btn sm pri" data-act="new">'+ic('plus')+'<span>New site</span></button></header>'
   +(n?siteTable():empty('layers','No sites yet','Create your first portfolio workspace. It renders locally before anything is published.','Create site','new'))+'</div>';
}

/* ---------- Studio ---------- */
function vStudio(){
  var sel=S.sel?S.sites.filter(function(s){return s.id===S.sel})[0]:null;
  var detail='';
  if(sel){
    var c=sel.cfg||{},p=c.pages||{},seo=c.seo||{},nav=c.nav||{},fl=c.flags||{},th=c.theme||{};
    detail='<div class="card" style="margin-top:14px"><header><h3>'+h(sel.id)+'</h3><div class="row">'+statePill(c)
      +'<button class="iconbtn" data-act="closedetail" title="Close">'+ic('x')+'</button></div></header>'
      +'<div class="grid g2"><div><h4 class="sec">Deployment</h4><dl class="kv">'
      +'<dt>Mode</dt><dd>'+h(p.mode||'')+'</dd><dt>Repository</dt><dd class="mono">'+h(p.repo||'')+'</dd>'
      +'<dt>Branch</dt><dd class="mono">'+h(p.branch||'gh-pages')+'</dd><dt>Base path</dt><dd class="mono">'+h(p.base_path||'/')+'</dd>'
      +'<dt>Custom domain</dt><dd class="mono">'+h(p.cname||'—')+'</dd><dt>Live URL</dt><dd class="mono">'+h(c.live_url||'—')+'</dd></dl></div>'
      +'<div><h4 class="sec">Content &amp; SEO</h4><dl class="kv">'
      +'<dt>Title</dt><dd>'+h(seo.title||'')+'</dd><dt>Description</dt><dd>'+h(seo.description||'')+'</dd>'
      +'<dt>OG image</dt><dd>'+h(seo.og_image||'—')+'</dd>'
      +'<dt>Forms</dt><dd>'+((c.supabase&&c.supabase.url)?'enabled':'disabled (no Supabase)')+'</dd></dl>'
      +'<h4 class="sec" style="margin-top:16px">Public navigation</h4><div class="row wrap">'
      +['services','appointments','about','client_auth'].map(function(k){return '<span class="pill '+(nav[k]?'acc':'mute')+'">'+h(k)+' '+(nav[k]?'on':'off')+'</span>'}).join('')+'</div>'
      +'<h4 class="sec" style="margin-top:16px">Flags</h4><div class="row wrap">'
      +Object.keys(fl).map(function(k){return '<span class="pill '+(fl[k]?'acc':'mute')+'">'+h(k)+' '+(fl[k]?'on':'off')+'</span>'}).join('')+'</div>'
      +'<h4 class="sec" style="margin-top:16px">Theme</h4><div class="sw">'
      +['bg','panel','accent'].map(function(k){return '<i title="'+h(k)+' '+h(th[k]||'')+'" style="background:'+h(th[k]||'#000')+'"></i>'}).join('')+'</div>'
      +'</div></div>'
      +'<div class="hr"></div>'
      +'<h4 class="sec">Database</h4>'
      +(function(){
        var db=(c.database||{}),pjs=((S.cfg&&S.cfg.supabase&&S.cfg.supabase.projects)||[]);
        var cur=pjs.filter(function(x){return x.ref===db.project_ref})[0];
        var opts=pjs.map(function(x){return '<option value="'+h(x.ref)+'"'+(db.project_ref===x.ref?' selected':'')+'>'+h(x.name||x.ref)+' · '+h(x.ref)+'</option>'}).join('');
        return '<div class="grid g2"><div>'
          +'<div class="field"><label>Isolation mode</label><select class="inp" id="db-mode">'
          +'<option value="shared"'+(db.mode!=='dedicated'?' selected':'')+'>shared — one project, many sites (unlimited, free)</option>'
          +'<option value="dedicated"'+(db.mode==='dedicated'?' selected':'')+'>dedicated — one project per site (2 free max)</option></select></div>'
          +'<div class="field"><label>Supabase project</label><select class="inp" id="db-ref"><option value="">— select —</option>'+opts+'</select>'
          +'<p class="hint">Each site binds exactly one project. The renderer injects that project URL and publishable key at build time.</p></div>'
          +'<div class="row wrap"><button class="btn pri" data-act="dbbind" data-id="'+h(sel.id)+'">Bind database</button>'
          +'<button class="btn" data-act="pnew" data-site="'+h(sel.id)+'">'+ic('plus')+'<span>New project</span></button></div>'
          +'</div><div><dl class="kv">'
          +'<dt>Bound ref</dt><dd class="mono">'+h(db.project_ref||'—')+'</dd>'
          +'<dt>Project URL</dt><dd class="mono">'+h((cur&&cur.url)||'—')+'</dd>'
          +'<dt>Status</dt><dd>'+h((cur&&cur.status)||'—')+'</dd>'
          +'<dt>Publishable key</dt><dd>'+(cur&&cur.has_key?'····'+h(cur.key_tail):'none')+'</dd>'
          +'<dt>Schema</dt><dd>'+(cur&&cur.schema_complete?(cur.schema_applied.length+' files via '+h(cur.schema_via||'')):'not applied')+'</dd>'
          +'</dl><div class="row wrap" style="margin-top:12px">'
          +'<button class="btn" data-act="dbkey" data-id="'+h(sel.id)+'">Fetch key</button>'
          +'<button class="btn" data-act="dbapply" data-id="'+h(sel.id)+'">Apply schema</button>'
          +'<button class="btn" data-act="dbhealth" data-id="'+h(sel.id)+'">Health</button>'
          +'</div></div></div>';
      })()
      +'<div class="hr"></div><div class="row wrap">'
      +'<button class="btn" data-act="build" data-id="'+h(sel.id)+'">'+ic('play')+'<span>Build</span></button>'
      +'<button class="btn" data-act="register" data-id="'+h(sel.id)+'">'+ic('db')+'<span>Register</span></button>'
      +'<button class="btn pri" data-act="publish" data-id="'+h(sel.id)+'">'+ic('up')+'<span>Publish</span></button>'
      +'<a class="btn ghost" href="/preview/'+encodeURIComponent(sel.id)+'/" target="_blank" rel="noopener">'+ic('ext')+'<span>Preview</span></a>'
      +'</div></div>';
  }
  return '<div class="card"><header><div><h3>Portfolio sites</h3></div><button class="btn pri sm" data-act="new">'+ic('plus')+'<span>New site</span></button></header>'
   +'<p class="desc">Each site renders to a fully static bundle. Build and preview locally, then register the tenant and publish.</p>'
   +(S.sites.length?siteTable():empty('layers','No portfolio sites','A site holds your intro, profile, experience, projects and services. Nothing is published until you click Publish.','Create your first site','new'))
   +'</div>'+detail
   +'<div class="grid g2" style="margin-top:14px">'
   +'<div class="card"><header><h3>Publish pipeline</h3></header><ul class="steps">'
   +[['Build','Render Markdown + JSON into static HTML/CSS in dist/'],
     ['Register','Insert the sites row and owner membership under RLS'],
     ['Provision','Create the GitHub repository if it does not exist'],
     ['Push','Force-push an orphan branch to gh-pages'],
     ['Configure Pages','Set legacy build type + source, disable competing workflows'],
     ['Mark live','Set is_published so the intake RPC accepts submissions']]
     .map(function(x,i){return '<li><span class="tick" style="border-color:var(--acc);color:var(--acc)">'+(i+1)+'</span><span class="tx"><b>'+h(x[0])+'</b><span>'+h(x[1])+'</span></span></li>'}).join('')
   +'</ul></div>'
   +'<div class="card"><header><h3>Activity</h3><button class="btn sm ghost" data-act="clearlog">Clear</button></header><div class="log" id="log">'+logHtml()+'</div></div></div>';
}

/* ---------- Settings ---------- */
function vSettings(){
  var c=S.cfg||{},sb=c.supabase||{},gh=c.github||{};
  var tabs=[['account','key','Supabase account'],['supabase','db','Site database'],['github','git','GitHub'],['security','lock','Security'],['appearance','palette','Appearance']];
  var body='';
  if(S.sub==='account'){
    var ac=(sb.account||{}),pjs=sb.projects||[],orgs=ac.orgs||[];
    body='<div class="card"><header><h3>Supabase account</h3>'+(ac.configured?'<span class="pill ok"><span class="dot"></span>Connected</span>':'<span class="pill mute">Not connected</span>')+'</header>'
      +'<p class="desc">One account token drives every project. Create a personal access token at supabase.com/dashboard/account/tokens. A scoped token needs organisation read, project create, and database write permissions.</p>'
      +'<form id="f-sbtok"><div class="field"><label>Personal access token</label><div class="pw"><input class="inp mono" id="sb-tok" type="password" placeholder="sbp_…" autocomplete="off"></div>'
      +'<p class="hint">'+(ac.configured?'Stored token ends ·'+h(ac.token_tail)+'. Paste a new one to replace it.':'The token is stored locally at 0600 and never sent back to this page.')+'</p></div>'
      +'<button class="btn pri" type="submit" data-act="sbtoken">Validate and load projects</button></form>'
      +(ac.error?'<div class="alert err" style="margin-top:14px">'+h(ac.error)+'</div>':'')
      +(ac.configured?'<div class="hr"></div><div class="row wrap"><button class="btn" data-act="sbrefresh">'+ic('refresh')+'<span>Refresh projects</span></button><button class="btn danger" data-act="sbforget">Forget token</button></div>':'')
      +'</div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Organisations</h3><span class="pill mute">'+orgs.length+'</span></header>'
      +(orgs.length?'<div class="tblwrap"><table><thead><tr><th>Name</th><th>Slug</th></tr></thead><tbody>'
        +orgs.map(function(o){return '<tr><td>'+h(o.name)+'</td><td class="mono">'+h(o.slug)+'</td></tr>'}).join('')
        +'</tbody></table></div>':'<p class="note">Validate the token to load organisations.</p>')+'</div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Projects</h3><span class="pill '+((sb.active_count||0)>=(sb.free_limit||2)?'warn':'acc')+'">'+(sb.active_count||0)+' active / '+(sb.free_limit||2)+' free</span></header>'
      +'<div class="alert warn">The Supabase Free plan allows '+(sb.free_limit||2)+' active projects, and free projects pause after one week of inactivity. For unlimited sites use <b>shared</b> mode: one project, many tenants separated by site_id and row level security.</div>'
      +(pjs.length?'<div class="tblwrap"><table><thead><tr><th>Project</th><th>Region</th><th>Status</th><th>Key</th><th>Schema</th><th></th></tr></thead><tbody>'
        +pjs.map(function(p){return '<tr><td><div class="name">'+h(p.name||p.ref)+'</div><div class="sub mono">'+h(p.ref)+'</div></td>'
          +'<td class="mono">'+h(p.region||'—')+'</td>'
          +'<span></span><td>'+(/ACTIVE_HEALTHY/.test(p.status||'')?'<span class="pill ok"><span class="dot"></span>Healthy</span>':'<span class="pill mute">'+h(p.status||'?')+'</span>')+'</td>'
          +'<td>'+(p.has_key?'<span class="pill ok">····'+h(p.key_tail)+'</span>':'<span class="pill warn">none</span>')+'</td>'
          +'<td>'+(p.schema_complete?'<span class="pill ok">'+p.schema_applied.length+' files</span>':'<span class="pill warn">not applied</span>')+'</td>'
          +'<td class="act"><button class="btn sm" data-act="pkey" data-ref="'+h(p.ref)+'">Key</button>'
          +'<button class="btn sm" data-act="pschema" data-ref="'+h(p.ref)+'">Schema</button>'
          +'<button class="btn sm" data-act="phealth" data-ref="'+h(p.ref)+'">Health</button>'
          +'<button class="btn sm'+(ac.default_project_ref===p.ref?' pri':'')+'" data-act="pdefault" data-ref="'+h(p.ref)+'">Default</button></td></tr>'}).join('')
        +'</tbody></table></div>'
        +'<div class="hr"></div><button class="btn pri" data-act="pnew">'+ic('plus')+'<span>Create project</span></button>'
        :'<p class="note">No projects loaded yet.</p>')
      +'</div>';
  } else if(S.sub==='supabase'){
    /* PORTROX_PROJECT_TAB — real project binding. No deleted endpoints. */
    var pjs=sb.projects||[],ac=sb.account||{};
    body='<div class="card"><header><h3>Project binding</h3>'
      +(sb.project_ref?'<span class="pill ok"><span class="dot"></span>'+h(sb.project_ref)+'</span>':'<span class="pill warn">No default</span>')+'</header>'
      +'<p class="desc">One Supabase account drives many projects. The default project is used by new sites; each site can override it in Studio, Details, Database. The renderer resolves the bound project at build time.</p>'
      +(ac.configured?'':'<div class="alert warn">Connect the account first: <b>Supabase account</b> tab.</div>')
      +(pjs.length?'<div class="tblwrap"><table><thead><tr><th>Project</th><th>Status</th><th>Key</th><th>Schema</th><th></th></tr></thead><tbody>'
        +pjs.map(function(p){return '<tr><td><div class="name">'+h(p.name||p.ref)+'</div><div class="sub mono">'+h(p.url||'')+'</div></td>'
          +'<td>'+(p.healthy?'<span class="pill ok"><span class="dot"></span>Healthy</span>':'<span class="pill mute">'+h(p.status||'?')+'</span>')+'</td>'
          +'<td>'+(p.has_key?'<span class="pill ok">key set</span>':'<span class="pill warn">none</span>')+'</td>'
          +'<td>'+(p.schema_complete?'<span class="pill ok">'+p.schema_applied.length+' files</span>':'<span class="pill warn">not recorded</span>')+'</td>'
          +'<td class="act"><button class="btn sm" data-act="pkey" data-ref="'+h(p.ref)+'">Key</button>'
          +'<button class="btn sm" data-act="pboot" data-ref="'+h(p.ref)+'">Bootstrap</button>'
          +'<button class="btn sm" data-act="phealth" data-ref="'+h(p.ref)+'">Health</button>'
          +'<button class="btn sm'+(sb.project_ref===p.ref?' pri':'')+'" data-act="pdefault" data-ref="'+h(p.ref)+'">Default</button></td></tr>'}).join('')
        +'</tbody></table></div>'
        :'<p class="note">No projects yet. Validate the account token, then Refresh projects or Create project.</p>')
      +'<div class="hr"></div><dl class="kv"><dt>Default ref</dt><dd class="mono">'+h(sb.project_ref||'—')+'</dd>'
      +'<dt>Resolved URL</dt><dd class="mono">'+h(sb.url||'—')+'</dd>'
      +'<dt>Project ready</dt><dd>'+(sb.project_ready?'yes':'no')+'</dd>'
      +'<dt>Healthy</dt><dd>'+(sb.db_ok?'yes':'no')+'</dd>'
      +'<dt>Schema files</dt><dd>'+(sb.schema_files||0)+'</dd></dl>'
      +'<p class="hint" style="margin-top:12px">Bootstrap applies the Portrox schema only. Legacy sample-site history is never pushed into a new project.</p></div>';
  } else if(S.sub==='github'){
    body='<div class="card"><header><h3>Personal access token</h3>'+(gh.configured?'<span class="pill ok"><span class="dot"></span>Validated</span>':'<span class="pill mute">Not set</span>')+'</header>'
      +'<p class="desc">Classic token with <span class="mono">repo</span> + <span class="mono">workflow</span>, or fine-grained with Contents, Pages, Administration and Workflows write. Passed to git through the environment only — never argv, never <span class="mono">.git/config</span>.</p>'
      +(gh.configured?'<dl class="kv" style="margin-bottom:15px"><dt>Account</dt><dd>'+h(gh.login)+'</dd><dt>Token</dt><dd class="mono">····'+h(gh.token_tail)+'</dd><dt>Scopes</dt><dd class="mono">'+h(gh.scopes||'fine-grained')+'</dd></dl>':'')
      +'<form id="f-gh"><div class="field"><label>'+(gh.configured?'Replace token':'Token')+'</label><div class="pw"><input class="inp mono" id="gh-tok" type="password" placeholder="github_pat_… or ghp_…"></div></div><button class="btn pri" type="submit">Validate and save</button></form></div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Publishing modes</h3></header><div class="tblwrap"><table><thead><tr><th>Mode</th><th>URL</th><th>Limit</th></tr></thead><tbody>'
      +'<tr><td><span class="pill mute">user</span></td><td class="mono">account.github.io</td><td>1 per account</td></tr>'
      +'<tr><td><span class="pill acc">project</span></td><td class="mono">account.github.io/repo</td><td>unlimited</td></tr>'
      +'<tr><td><span class="pill mute">org</span></td><td class="mono">org.github.io</td><td>1 per org</td></tr>'
      +'<tr><td><span class="pill mute">custom</span></td><td class="mono">yourdomain.com</td><td>needs DNS + cname</td></tr>'
      +'</tbody></table></div></div>';
  } else if(S.sub==='security'){
    body='<div class="card"><header><h3>Studio credentials</h3>'+(AUTH.weakPassword?'<span class="pill err"><span class="dot"></span>Default password</span>':'<span class="pill ok"><span class="dot"></span>Password rotated</span>')+'</header>'
      +'<p class="desc">Username and password for this local Studio. Hashed with scrypt and a per-user salt. Changing only the username does <b>not</b> clear the default-password warning.</p>'
      +'<dl class="kv" style="margin-bottom:15px"><dt>Username</dt><dd>'+h(AUTH.username)+'</dd><dt>Password rotated</dt><dd>'+(AUTH.passwordRotated?'yes':'no')+'</dd><dt>First-login prompt</dt><dd>'+(AUTH.promptDismissed?'dismissed':'active')+'</dd></dl>'
      +'<button class="btn pri" data-act="creds">Change credentials</button></div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Recovery</h3>'+((AUTH.recoveryConfigured||AUTH.recoveryKeySet)?'<span class="pill ok"><span class="dot"></span>Configured</span>':'<span class="pill warn">None</span>')+'</header>'
      +'<div class="alert warn">Security questions are weaker than a recovery key — birthplace and teacher names are often discoverable. Prefer the key, or configure both.</div>'
      +'<div class="row wrap"><button class="btn" data-act="recq">'+ic('key')+'<span>Set security questions</span></button><button class="btn" data-act="reck">'+ic('lock')+'<span>Generate recovery key</span></button></div>'
      +'<div class="hr"></div><dl class="kv"><dt>Questions</dt><dd>'+AUTH.recoveryQuestions.length+' set, '+AUTH.recoveryRequired+' required</dd><dt>Recovery key</dt><dd>'+(AUTH.recoveryKeySet?'set':'not generated')+'</dd></dl></div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Session</h3></header><dl class="kv"><dt>Cookie</dt><dd class="mono">HttpOnly · SameSite=Strict</dd><dt>Idle timeout</dt><dd>30 minutes</dd><dt>Absolute timeout</dt><dd>8 hours</dd><dt>Lockout</dt><dd>5 failures / 15 min</dd><dt>Recovery limit</dt><dd>3 failures / hour</dd></dl><div class="hr"></div><button class="btn danger" data-act="signout">Sign out</button></div>';
  } else {
    var side=ls('portrox.side','left'),col=ls('portrox.nav','expanded')==='collapsed';
    body='<div class="card"><header><h3>Navigation</h3></header>'
      +'<p class="desc">The sidebar can collapse to an icon rail, slide away entirely on small screens, and sit on either edge. Preferences are stored in this browser only.</p>'
      +'<div class="field"><label>Sidebar edge</label><select class="inp" id="ap-side"><option value="left"'+(side==='left'?' selected':'')+'>Left</option><option value="right"'+(side==='right'?' selected':'')+'>Right</option></select></div>'
      +'<label class="check"><input type="checkbox" id="ap-col"'+(col?' checked':'')+'><span>Start collapsed (icon rail only)</span></label>'
      +'<div class="hr"></div><div class="row wrap"><button class="btn" data-act="navtoggle">'+ic('panel')+'<span>Toggle now</span></button><button class="btn ghost" data-act="navreset">Reset preferences</button></div>'
      +'<p class="hint" style="margin-top:12px">Shortcut: <span class="mono">Ctrl+B</span> toggles the sidebar. <span class="mono">Esc</span> closes the drawer and any dialog.</p></div>'
      +'<div class="card" style="margin-top:14px"><header><h3>Keyboard</h3></header><div class="tblwrap"><table><thead><tr><th>Keys</th><th>Action</th></tr></thead><tbody>'
      +'<tr><td class="mono">Ctrl + B</td><td>Collapse / expand the sidebar (opens the drawer on small screens)</td></tr>'
      +'<tr><td class="mono">Esc</td><td>Close the drawer or the active dialog</td></tr>'
      +'</tbody></table></div></div>';
  }
  return '<div class="split"><div class="subnav">'+tabs.map(function(t){return '<button data-sub="'+t[0]+'" class="'+(S.sub===t[0]?'on':'')+'">'+ic(t[1])+'<span>'+h(t[2])+'</span></button>'}).join('')+'</div><div>'+body+'</div></div>';
}

/* ---------- About ---------- */
function vAbout(){
  var arch=['Portrox Studio  (127.0.0.1, kernel-assigned port)','  |  session cookie + CSRF token + Host check','  |-- auth-store    scrypt credentials, recovery, lockout','  |-- config-store  Supabase + GitHub, mode 0600','  |-- render.mjs    Markdown + JSON -> static HTML/CSS','  |-- publish       orphan branch -> gh-pages -> Pages API','','Public portfolio  (GitHub Pages, HTTPS)','  |-- static HTML + CSS, zero CDN, zero runtime deps'].join(NL);
  var cli=['portrox start | stop | restart | status | logs','portrox build <site> | --all','portrox enable-autostart | disable-autostart','portrox doctor | help','','node packages/cli/auth-store.mjs status','node packages/cli/auth-store.mjs reset      # emergency local reset','','node scripts/verify-ui.mjs                  # emitted browser script','node scripts/verify-auth.mjs                # sandboxed auth regression','bash scripts/verify-all.sh                  # every gate in order'].join(NL);
  var sec=['Studio binds 127.0.0.1 only; the kernel assigns a free port each start','~/.portrox is 0700; auth.json, config.json and state.json are 0600','Every write needs a valid Host, a loopback Origin and the per-run CSRF token','Passwords and recovery answers are scrypt-hashed with per-item salts','Rotation status derives from the password, never from the username','Secret and service-role keys are rejected before reaching any bundle','Anonymous visitors have no direct table write; a rate-limited RPC is the only intake','Applied migrations are immutable and excluded from formatting hooks'];
  var shipped=['Local Studio with session auth, lockout and recovery','Sliding / collapsing navigation, four routed pages','Supabase + GitHub configuration entered only in the UI','Static renderer: 6 routes, sitemap, 404, zero CDN','Multi-tenant Postgres schema with is_published-gated reads','One-click provision, push, Pages configuration, mark live','Secret scanning locally and in CI, with a positive control'];
  var pending=['Next.js Studio modules (rich CRUD, media uploads, inbox)','Guided Q&A intro wizard alongside the Markdown editor','Paid-booking verification and automated email','Client portal and premium service access'];
  return '<div class="grid g2">'
   +'<div class="card"><div class="brand" style="margin-bottom:16px"><div class="mark">P</div><div><h1 style="font-size:16px;margin:0">Portrox</h1><small>Portfolio Studio</small></div></div>'
   +'<p class="desc">A self-hostable, multi-tenant portfolio engine. A private local Studio renders fully static sites and publishes them to GitHub Pages.</p>'
   +'<dl class="kv"><dt>Version</dt><dd>'+h(VER)+'</dd><dt>Creator</dt><dd>Siddhant Kumar</dd><dt>Licence</dt><dd>MIT</dd><dt>Runtime</dt><dd>Node 20+ · zero dependencies</dd><dt>Repository</dt><dd class="mono">github.com/sid200ok/portrox</dd></dl></div>'
   +'<div class="card"><header><h3>Architecture</h3></header><pre class="log" style="max-height:none">'+h(arch)+'</pre></div></div>'
   +'<div class="card" style="margin-top:14px"><header><h3>Security model</h3></header><ul class="steps">'
   +sec.map(function(t){return '<li class="done"><span class="tick">'+ic('check')+'</span><span class="tx"><b>'+h(t)+'</b></span></li>'}).join('')+'</ul></div>'
   +'<div class="grid g2" style="margin-top:14px">'
   +'<div class="card"><header><h3>Implemented</h3><span class="pill ok">'+shipped.length+'</span></header><ul class="steps">'
   +shipped.map(function(t){return '<li class="done"><span class="tick">'+ic('check')+'</span><span class="tx"><b>'+h(t)+'</b></span></li>'}).join('')+'</ul></div>'
   +'<div class="card"><header><h3>Not built yet</h3><span class="pill warn">'+pending.length+'</span></header><ul class="steps">'
   +pending.map(function(t){return '<li><span class="tick"></span><span class="tx"><b>'+h(t)+'</b></span></li>'}).join('')+'</ul></div></div>'
   +'<div class="card" style="margin-top:14px"><header><h3>CLI reference</h3></header><pre class="log" style="max-height:none">'+h(cli)+'</pre></div>';
}

/* ---------- render ---------- */
var TITLES={dashboard:['Dashboard','Portrox / Overview'],studio:['Studio','Portrox / Sites'],settings:['Settings','Portrox / Configuration'],about:['About app','Portrox / Information']};
function render(){
  var r=S.route;
  document.querySelectorAll('[data-nav]').forEach(function(a){a.classList.toggle('on',a.getAttribute('data-nav')===r)});
  $('ttl').textContent=TITLES[r][0];$('crumb').textContent=TITLES[r][1];
  $('secwarn').classList.toggle('hide',!AUTH.weakPassword);
  $('sync').textContent=S.loading?'loading…':'synced';
  $('sync').className='pill '+(S.loading?'mute':'ok');
  $('view').innerHTML=r==='dashboard'?vDashboard():r==='studio'?vStudio():r==='settings'?vSettings():vAbout();
  bind();
}
function route(){var k=(location.hash||'#/dashboard').replace('#/','');S.route=TITLES[k]?k:'dashboard';closeDrawer();render()}
window.addEventListener('hashchange',route);

function bind(){
  document.querySelectorAll('[data-sub]').forEach(function(b){b.onclick=function(){S.sub=b.getAttribute('data-sub');render()}});
  document.querySelectorAll('[data-act]').forEach(function(b){b.onclick=function(){act(b.getAttribute('data-act'),b.getAttribute('data-id'),b)}});
  var f;
  if((f=$('f-gh')))f.onsubmit=function(e){e.preventDefault();busy(e.target,true);
    api('/api/config/github',{token:$('gh-tok').value}).then(function(c){S.cfg=c;toast('GitHub token validated.','ok');logline('github token validated','ok');render()}).catch(function(x){toast(x.message,'err');logline('github: '+x.message,'err')}).finally(function(){busy(e.target,false)})};
  if((f=$('ap-side')))f.onchange=function(){setSide(f.value)};
  if((f=$('ap-col')))f.onchange=function(){setCollapsed(f.checked)};
}

/* ---------- actions ---------- */
function act(a,id,btn){
  if(a==='new')return newSite();
  if(a==='creds')return credsModal();
  if(a==='recq')return recQModal();
  if(a==='reck')return recKModal();
  if(a==='signout')return api('/api/auth/logout',{}).then(function(){location.reload()}).catch(function(){location.reload()});
  if(a==='sbtoken'){var f=$('f-sbtok');if(f){busy(f,true);}logline('validating Supabase access token …');
    return api('/api/supabase/token',{access_token:$('sb-tok').value}).then(function(c){S.cfg=c;toast('Supabase account connected. '+c.supabase.project_count+' project(s).','ok');logline('supabase account ok projects='+c.supabase.project_count,'ok');render()}).catch(function(x){toast(x.message,'err');logline('supabase token: '+x.message,'err');render()})};
  if(a==='sbrefresh')return api('/api/supabase/refresh',{}).then(function(c){S.cfg=c;toast('Projects refreshed.','ok');render()}).catch(function(x){toast(x.message,'err')});
  if(a==='sbforget')return api('/api/supabase/forget',{}).then(function(c){S.cfg=c;toast('Supabase token removed.','info');render()}).catch(function(x){toast(x.message,'err')});
  if(a==='pdefault')return api('/api/supabase/default',{ref:btn.getAttribute('data-ref')}).then(function(c){S.cfg=c;toast('Default project set.','ok');render()}).catch(function(x){toast(x.message,'err')});
  if(a==='pboot'){var pr=btn.getAttribute('data-ref');btn.disabled=true;btn.classList.add('busy');logline('bootstrap '+pr+' …');return api('/api/supabase/projects/'+pr+'/schema',{bootstrap:true}).then(function(j){toast('Bootstrap: '+j.count+' files via '+j.via,'ok');logline('bootstrap '+pr+' OK '+JSON.stringify(j),'ok');return api('/api/config').then(function(c){S.cfg=c;render()})}).catch(function(x){toast(x.message,'err');logline('bootstrap FAILED: '+x.message,'err');render()}).finally(function(){btn.disabled=false;btn.classList.remove('busy')})}
  if(a==='pkey'||a==='pschema'||a==='phealth'){var ref=btn.getAttribute('data-ref');var ep=a==='pkey'?'key':(a==='pschema'?'schema':'health');
    btn.disabled=true;btn.classList.add('busy');logline(a+' '+ref+' …');
    return api('/api/supabase/projects/'+ref+'/'+ep,{}).then(function(j){logline(a+' '+ref+' OK '+JSON.stringify(j),'ok');toast(a+' succeeded','ok');return api('/api/config').then(function(c){S.cfg=c;render()})}).catch(function(x){logline(a+' '+ref+' FAILED: '+x.message,'err');toast(x.message,'err');render()}).finally(function(){btn.disabled=false;btn.classList.remove('busy')})};
  if(a==='dbbind')return api('/api/sites/'+encodeURIComponent(id)+'/db',{mode:$('db-mode').value,project_ref:$('db-ref').value}).then(function(j){toast('Database bound: '+j.database.project_ref,'ok');logline('db bind '+id+' -> '+j.database.project_ref,'ok');return load()}).catch(function(x){toast(x.message,'err')});
  if(a==='dbkey'||a==='dbapply'||a==='dbhealth'){var ep2=a==='dbkey'?'db/key':(a==='dbapply'?'db/apply':'db/health');
    btn.disabled=true;btn.classList.add('busy');logline(a+' '+id+' …');
    return api('/api/sites/'+encodeURIComponent(id)+'/'+ep2,{}).then(function(j){logline(a+' '+id+' OK '+JSON.stringify(j),'ok');toast(a+' succeeded','ok');return load()}).catch(function(x){logline(a+' '+id+' FAILED: '+x.message,'err');toast(x.message,'err');render()}).finally(function(){btn.disabled=false;btn.classList.remove('busy')})};
  if(a==='pnew')return newProjectModal(btn.getAttribute('data-site'));
  if(a==='build'||a==='register'||a==='publish'){
    if(a==='publish'&&!confirm('Publish '+id+'?'+NL+NL+'This force-pushes the rendered bundle to the gh-pages branch, switches that repository to branch deployment, and marks the site live.'))return;
    if(btn){btn.disabled=true;btn.classList.add('busy')}
    logline(a+' '+id+' …');
    return api('/api/sites/'+encodeURIComponent(id)+'/'+a,{}).then(function(j){logline(a+' '+id+' OK '+JSON.stringify(j),'ok');toast(a+' succeeded for '+id,'ok');return load()}).catch(function(x){logline(a+' '+id+' FAILED: '+x.message,'err');toast(x.message,'err')}).finally(function(){if(btn){btn.disabled=false;btn.classList.remove('busy')}});
  }
}
function newSite(){
  modal({title:'Create portfolio site',sub:'Renders locally first. Nothing is published until you choose to.',
    body:'<div id="ns-err" class="alert err hide"></div><div class="field"><label>Site name / slug</label><input class="inp" id="ns-name" placeholder="client-x" autocomplete="off"></div><div class="field"><label>Display name / headline</label><input class="inp" id="ns-head" placeholder="Client X"></div><div class="field"><label>GitHub Pages mode</label><select class="inp" id="ns-mode"><option value="project">project — account.github.io/repo (unlimited)</option><option value="user">user — account.github.io (one per account)</option><option value="org">org — org.github.io (org must exist)</option><option value="custom">custom — your own domain</option></select><p class="hint" id="ns-hint"></p></div>',
    footer:'<button class="btn ghost" id="ns-c">Cancel</button><button class="btn pri" id="ns-ok">Create site</button>',
    onMount:function(close){
      $('ns-c').onclick=close;
      function hint(){var m=$('ns-mode').value;$('ns-hint').textContent=m==='user'?'One per GitHub account. Use project for additional sites.':m==='org'?'The organisation must already exist on GitHub.':m==='custom'?'Set pages.cname in site.json before publishing.':'Unlimited sites under your account.'}
      $('ns-mode').onchange=hint;hint();$('ns-name').focus();
      $('ns-ok').onclick=function(){var b=$('ns-ok');b.disabled=true;b.textContent='Creating…';
        api('/api/sites',{name:$('ns-name').value,headline:$('ns-head').value,mode:$('ns-mode').value}).then(function(j){close();toast('Created '+j.id,'ok');logline('created '+j.id,'ok');S.sel=j.id;return load()}).catch(function(x){var e=$('ns-err');e.textContent=x.message;e.classList.remove('hide');b.disabled=false;b.textContent='Create site'})};
    }});
}
function newProjectModal(siteId){
  var ac=(S.cfg&&S.cfg.supabase&&S.cfg.supabase.account)||{},orgs=ac.orgs||[],groups=(S.cfg&&S.cfg.supabase&&S.cfg.supabase.smart_groups)||['americas','emea','apac'];
  modal({title:'Create Supabase project',sub:'One project per site in dedicated mode. Free plan allows 2 active projects.',wide:true,
    body:'<div id="np-err" class="alert err hide"></div>'
      +'<div class="alert warn">The database password is generated for you and shown <b>once</b>. Supabase cannot change it programmatically afterwards.</div>'
      +'<div class="field"><label>Project name</label><input class="inp" id="np-name" placeholder="portrox-client-x"></div>'
      +'<div class="field"><label>Organisation</label><select class="inp" id="np-org">'+orgs.map(function(o){return '<option value="'+h(o.slug)+'">'+h(o.name)+' · '+h(o.slug)+'</option>'}).join('')+'</select></div>'
      +'<div class="field"><label>Region group</label><select class="inp" id="np-region">'+groups.map(function(g){return '<option value="'+h(g)+'"'+(g==='apac'?' selected':'')+'>'+h(g)+'</option>'}).join('')+'</select>'
      +'<p class="hint">Smart region selection picks a zone with capacity inside the group.</p></div>'
      +'<label class="check"><input type="checkbox" id="np-store"><span>Remember the password locally (only needed for the psql fallback)</span></label>'
      +'<div id="np-out" class="hide"><div class="alert ok">Project created. Copy the password now — it cannot be shown again.</div><pre class="log" id="np-pass" style="max-height:none;font-size:14px;text-align:center"></pre><pre class="log" id="np-meta" style="max-height:none"></pre></div>',
    footer:'<button class="btn ghost" id="np-c">Close</button><button class="btn pri" id="np-go">Create project</button>',
    onMount:function(close){
      $('np-c').onclick=close;
      $('np-go').onclick=function(){
        var e=$('np-err');e.classList.add('hide');var b=$('np-go');b.disabled=true;b.textContent='Provisioning…';
        logline('creating Supabase project …');
        api('/api/supabase/projects',{name:$('np-name').value,organization_slug:$('np-org').value,region_code:$('np-region').value,store_password:$('np-store').checked,site_id:siteId||null})
          .then(function(j){
            $('np-pass').textContent=j.db_password_once;
            $('np-meta').textContent=JSON.stringify({ref:j.ref,status:j.status,healthy:j.healthy,waited_seconds:j.waited_seconds,key:j.key,schema:j.schema},null,2);
            $('np-out').classList.remove('hide');b.classList.add('hide');
            logline('project '+j.ref+' status='+j.status,'ok');toast('Project '+j.ref+' created.','ok');
            return api('/api/config').then(function(c){S.cfg=c;return siteId?load():render()});
          })
          .catch(function(x){e.textContent=x.message;e.classList.remove('hide');b.disabled=false;b.textContent='Create project';logline('project create FAILED: '+x.message,'err')});
      };
    }});
}
function credsModal(){
  modal({title:'Change credentials',sub:'Rotation is tracked from the password, not the username.',wide:true,
    body:'<div id="cr-err" class="alert err hide"></div>'
      +(AUTH.weakPassword?'<div class="alert warn">The password is still the shipped default. Any local process can sign in. Set a new password below.</div>':'')
      +'<div class="field"><label>Current password</label><div class="pw"><input class="inp" id="cr-cur" type="password" autocomplete="current-password"></div></div><div class="hr"></div>'
      +'<div class="field"><label>New username (optional)</label><input class="inp" id="cr-user" placeholder="'+h(AUTH.username)+'" autocomplete="username"></div>'
      +'<div class="field"><label>New password (optional, min 8)</label><div class="pw"><input class="inp" id="cr-pw" type="password" autocomplete="new-password"></div></div>'
      +'<div class="field"><label>Confirm new password</label><input class="inp" id="cr-pw2" type="password" autocomplete="new-password"></div>'
      +'<div class="hr"></div><h4 class="sec">Recovery (optional, recommended)</h4><p class="note">Answers are normalised and scrypt-hashed. Two must match to recover access. Saved in the same request as the password.</p><div id="cr-qs"></div>'
      +'<label class="check" style="margin-top:14px"><input type="checkbox" id="cr-dis"><span>Do not show the first-login reminder again</span></label>',
    footer:'<button class="btn ghost" id="cr-skip">Skip for now</button><button class="btn pri" id="cr-save">Save changes</button>',
    onMount:function(close){
      $('cr-qs').innerHTML=(AUTH.questionBank||[]).slice(0,4).map(function(q){return '<div class="field"><label>'+h(q.label)+'</label><input class="inp" data-rq="'+h(q.id)+'" autocomplete="off"></div>'}).join('');
      $('cr-cur').focus();
      $('cr-skip').onclick=function(){if($('cr-dis').checked){api('/api/auth/dismiss',{}).then(function(a){AUTH=a;close();render();toast('Reminder dismissed.','info')}).catch(function(x){toast(x.message,'err')})}else close()};
      $('cr-save').onclick=function(){
        var e=$('cr-err');e.classList.add('hide');
        var pw=$('cr-pw').value,pw2=$('cr-pw2').value;
        if(pw&&pw!==pw2){e.textContent='New passwords do not match.';e.classList.remove('hide');return}
        var ans=[];document.querySelectorAll('[data-rq]').forEach(function(i){if(i.value.trim())ans.push({id:i.getAttribute('data-rq'),value:i.value})});
        var b=$('cr-save');b.disabled=true;b.textContent='Saving…';
        api('/api/auth/credentials',{currentPassword:$('cr-cur').value,username:$('cr-user').value,password:pw,dismissPrompt:$('cr-dis').checked,recoveryAnswers:ans,recoveryRequired:2})
          .then(function(r){toast(r&&r.recoverySaved?'Credentials and recovery saved. Sign in again.':'Credentials updated. Sign in again.','ok');setTimeout(function(){location.reload()},900)})
          .catch(function(x){e.textContent=x.message;e.classList.remove('hide');b.disabled=false;b.textContent='Save changes'})};
    }});
}
function recQModal(){
  modal({title:'Security questions',sub:'Two correct answers are required to recover access.',wide:true,
    body:'<div id="rq-err" class="alert err hide"></div><div class="alert warn">These answers can be guessable. A recovery key is stronger — configure both if possible.</div><div class="field"><label>Current password</label><div class="pw"><input class="inp" id="rq-cur" type="password"></div></div><div class="hr"></div>'
      +(AUTH.questionBank||[]).map(function(q){return '<div class="field"><label>'+h(q.label)+'</label><input class="inp" data-rq2="'+h(q.id)+'" autocomplete="off"></div>'}).join(''),
    footer:'<button class="btn ghost" id="rq-c">Cancel</button><button class="btn pri" id="rq-s">Save questions</button>',
    onMount:function(close){$('rq-c').onclick=close;
      $('rq-s').onclick=function(){var a=[];document.querySelectorAll('[data-rq2]').forEach(function(i){if(i.value.trim())a.push({id:i.getAttribute('data-rq2'),value:i.value})});
        var b=$('rq-s');b.disabled=true;b.textContent='Saving…';
        api('/api/auth/recovery/setup',{currentPassword:$('rq-cur').value,answers:a,required:2}).then(function(x){AUTH=x;close();render();toast('Recovery questions saved.','ok')}).catch(function(x){var e=$('rq-err');e.textContent=x.message;e.classList.remove('hide');b.disabled=false;b.textContent='Save questions'})};
    }});
}
function recKModal(){
  modal({title:'Recovery key',sub:'Shown once. Store it somewhere safe.',
    body:'<div id="rk-err" class="alert err hide"></div><div class="field"><label>Current password</label><div class="pw"><input class="inp" id="rk-cur" type="password"></div></div><div id="rk-out" class="hide"><div class="alert ok">Copy this key now. It cannot be shown again.</div><pre class="log" id="rk-val" style="max-height:none;font-size:15px;text-align:center"></pre><button class="btn block sm" id="rk-copy" style="margin-top:10px">Copy to clipboard</button></div>',
    footer:'<button class="btn ghost" id="rk-c">Close</button><button class="btn pri" id="rk-g">Generate key</button>',
    onMount:function(close){$('rk-c').onclick=close;
      $('rk-g').onclick=function(){var b=$('rk-g');b.disabled=true;b.textContent='Generating…';
        api('/api/auth/recovery/key',{currentPassword:$('rk-cur').value}).then(function(j){$('rk-val').textContent=j.key;$('rk-out').classList.remove('hide');b.classList.add('hide');AUTH.recoveryKeySet=true;
          $('rk-copy').onclick=function(){navigator.clipboard.writeText(j.key).then(function(){toast('Copied.','ok')}).catch(function(){toast('Copy failed — select manually.','err')})}}).catch(function(x){var e=$('rk-err');e.textContent=x.message;e.classList.remove('hide');b.disabled=false;b.textContent='Generate key'})};
    }});
}

/* ---------- boot ---------- */
function load(){
  S.loading=true;
  return Promise.all([api('/api/config'),api('/api/sites'),api('/api/session')])
    .then(function(r){S.cfg=r[0];S.sites=r[1];AUTH=r[2].auth;S.loading=false;render()})
    .catch(function(x){S.loading=false;render();toast(x.message,'err')});
}
applyNav();
route();
$('navtoggle').onclick=toggleNav;
$('scrim').onclick=closeDrawer;
$('signout').onclick=function(){act('signout')};
$('refresh').onclick=function(){load().then(function(){toast('Refreshed.','info')})};
$('fixcreds').onclick=function(){credsModal()};
document.addEventListener('keydown',function(e){
  if((e.ctrlKey||e.metaKey)&&(e.key==='b'||e.key==='B')){e.preventDefault();toggleNav();return}
  if(e.key==='Escape')closeDrawer();
});
load().then(function(){if(AUTH.weakPassword&&!AUTH.promptDismissed)setTimeout(function(){credsModal()},450)});
</script></body></html>`;
}
