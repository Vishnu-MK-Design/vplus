import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildDesktopPlayer} from './player/build.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'..'),out=path.join(dir,'generated/assets');
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,'shared/assets'),out,{recursive:true});
await fs.mkdir(path.join(dir,'generated/tools'),{recursive:true});
await fs.cp(path.join(root,'shared/metadata'),path.join(dir,'generated/tools'),{recursive:true});
await fs.mkdir(path.join(dir,'generated/engine'),{recursive:true});
for(const f of ['transport.cjs','service.cjs'])await fs.copyFile(path.join(root,'engines/cs3',f),path.join(dir,'generated/engine',f));
for(const f of ['extension-player.html','extension-player.js','source-status.js','source-status.css'])await fs.copyFile(path.join(dir,f),path.join(out,f));
await fs.copyFile(path.join(dir,'node_modules/hls.js/dist/hls.min.js'),path.join(out,'hls.min.js'));
await fs.copyFile(path.join(dir,'node_modules/hls.js/LICENSE'),path.join(out,'HLS-LICENSE.txt'));
await buildDesktopPlayer(out);
await fs.copyFile(path.join(dir,'player/preview-worker.js'),path.join(out,'preview-worker.js'));
for(const f of ['index.html','app.js','model.js','cinematic.css','trailer.js','discovery.js','discovery.css','episode-browser.js','airing.js','window-controls.js'])await fs.copyFile(path.join(dir,'cinematic',f),path.join(out,f));
await fs.copyFile(path.join(root,'shared/interactions.js'),path.join(out,'interactions.js'));
await fs.copyFile(path.join(dir,'cinematic-fallback.json'),path.join(out,'cinematic-fallback.json'));
await fs.copyFile(path.join(dir,'content-policy.cjs'),path.join(out,'content-policy.js'));
const pref=path.join(out,'preferences.js');await fs.writeFile(pref,(await fs.readFile(pref,'utf8')).replace('resumeByDefault:true','matureContent:false,autoPlayNext:true,resumeByDefault:true').replace("defaultSource:['auto','vidly','cinesrc']","defaultSource:['auto','vidly','cinesrc','vidfast','vidlink']"));
// Preserve the original catalogue/playback status distinction in the legacy helper.
const p=path.join(out,'providers.js');let providers=await fs.readFile(p,'utf8');
for(const [a,b] of [
 ['Browse and search the public title catalogue.','Catalogue only: titles, images and descriptions. Video uses your playback connection.'],
 ['Its catalogue is available. Its published video host is currently unreachable.','Catalogue source. Direct StreamFlix playback is not connected in this build. Check connection below.'],
 ["E(small?p.sub:p.description)","E(small&&p.mode!=='catalogue'?p.sub:p.description)"],
 ["'</small></span>'+(active(p)?", "'</small>'+ (p.mode==='catalogue'?'<em class=\"provider-catalogue-note\">'+(active(p)?'Selected catalogue · not a playback connection':'Catalogue source')+'</em>':'')+'</span>'+(active(p)?"]
]){if(!providers.includes(a))throw Error('Shared provider source changed');providers=providers.replace(a,b);}
await fs.writeFile(p,providers);
console.log('V+ PC sources prepared. No Mobile/TV application or external engine was built.');
