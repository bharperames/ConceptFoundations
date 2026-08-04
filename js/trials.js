import { $ } from './core.js';

function rowXs(n){
  if (n===1) return [50];
  const gap = Math.min(26, 76/(n-1));
  return Array.from({length:n}, (_,i) => 50 + (i-(n-1)/2)*gap);
}
const elShape = (id, html, x, y, s, extra={}) => ({ id, html, x, y, s, ...extra });

function tapTrial({prompt, say, beatEls, elements, state}){
  return { kind:'tap', state, prompt, say: say||prompt, beatEls, elements, timeoutMs: 9000 };
}
function watchTrial({prompt, say, beatEls, elements, state, autoMs}){
  return { kind:'watch', state, prompt, say: say||prompt, beatEls, elements, autoMs: autoMs||800, timeoutMs: 0 };
}
function dragTrial({prompt, say, beatEls, elements, pieces, state, decoys}){
  return { kind:'drag', state, prompt, say: say||prompt, beatEls, elements, pieces, decoys: decoys||[], timeoutMs: 14000 };
}

/* Cluster offsets (in % of zone box) for quantity groups, counts 1–6 */
const CLUSTER = {
  1:[[50,50]], 2:[[36,50],[64,50]], 3:[[50,32],[34,64],[66,64]],
  4:[[34,34],[66,34],[34,66],[66,66]], 5:[[50,28],[30,50],[70,50],[38,74],[62,74]],
  6:[[32,30],[68,30],[26,58],[74,58],[42,78],[58,78]],
};
function zoneEl(id, x, count, itemSvg){
  const minis = CLUSTER[count].map(([mx,my]) =>
    `<span class="mini" style="left:${mx}%;top:${my}%;width:${count > 4 ? 21 : 26}%;height:${count > 4 ? 21 : 26}%">${itemSvg}</span>`).join('');
  return { id, x, y:50, s:42, zone:true, html:minis, count };
}

export { rowXs, elShape, tapTrial, watchTrial, dragTrial, CLUSTER, zoneEl };
