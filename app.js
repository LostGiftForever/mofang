const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const AXIS_INDEX = { x:0,y:1,z:2 };
const COLORS = { white:'#f6f7ef',yellow:'#ffd536',red:'#ed6047',orange:'#f59a24',blue:'#306cbd',green:'#28966c' };
const NAMES = { white:'白',yellow:'黄',red:'红',orange:'橙',blue:'蓝',green:'绿' };
const vector = values => new THREE.Vector3(...values);
const mod = (value,divisor) => (value%divisor+divisor)%divisor;
const roundArray = value => value.toArray().map(number => Math.round(number)||0);
const nodeKey = (position,normal) => `${position.join(',')}|${normal.join(',')}`;

const FACES = {
  U:{ n:[0,1,0],u:[1,0,0],v:[0,0,-1],name:'上层',color:'white',axis:'y',coord:1 },
  D:{ n:[0,-1,0],u:[1,0,0],v:[0,0,1],name:'下层',color:'yellow',axis:'y',coord:-1 },
  R:{ n:[1,0,0],u:[0,0,-1],v:[0,1,0],name:'右层',color:'red',axis:'x',coord:1 },
  L:{ n:[-1,0,0],u:[0,0,1],v:[0,1,0],name:'左层',color:'orange',axis:'x',coord:-1 },
  F:{ n:[0,0,1],u:[1,0,0],v:[0,1,0],name:'前层',color:'green',axis:'z',coord:1 },
  B:{ n:[0,0,-1],u:[-1,0,0],v:[0,1,0],name:'后层',color:'blue',axis:'z',coord:-1 }
};
const RING_GEOMETRY = { y:{cx:320,cy:190},x:{cx:207,cy:378},z:{cx:433,cy:378} };
const RADIUS = {'-1':148,'0':166,'1':184};

let selected='U',busy=false,moves=0,totalAngle=0,previewAngle=0,animation=null,ringDrag=null;
let graphSnapshot=new Map(),graphMove=null;

const scene=new THREE.Scene(),cube=new THREE.Group(),pivot=new THREE.Group();
scene.add(cube,pivot);
const cubies=[];
const bodyGeometry=new THREE.BoxGeometry(.955,.955,.955);
const stickerGeometry=new THREE.PlaneGeometry(.88,.88);
const bodyMaterial=new THREE.MeshStandardMaterial({color:'#bcc5be',roughness:.7});
const materials=Object.fromEntries(Object.entries(COLORS).map(([name,color])=>[name,new THREE.MeshStandardMaterial({color,roughness:.48})]));

function buildCube(){
  cube.clear();pivot.clear();pivot.quaternion.identity();cubies.length=0;
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
    const block=new THREE.Group();
    block.position.set(x,y,z);block.add(new THREE.Mesh(bodyGeometry,bodyMaterial));block.userData.stickers=[];
    for(const face of Object.values(FACES)){
      const normal=vector(face.n);
      if(block.position.dot(normal)!==1)continue;
      const sticker=new THREE.Mesh(stickerGeometry,materials[face.color]);
      sticker.position.copy(normal).multiplyScalar(.482);
      sticker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
      block.add(sticker);block.userData.stickers.push({normal,color:face.color});
    }
    cube.add(block);cubies.push(block);
  }
}

const svgNS='http://www.w3.org/2000/svg';
function svgElement(tag,attrs,parent){
  const element=document.createElementNS(svgNS,tag);
  for(const [key,value]of Object.entries(attrs))element.setAttribute(key,value);
  parent.append(element);return element;
}

const circles=new Map(),graphNodes=[],graphNodeByKey=new Map();
const circleId=(axis,coord)=>`${axis}:${coord}`;

function circleIntersections(first,second){
  const dx=second.cx-first.cx,dy=second.cy-first.cy,distance=Math.hypot(dx,dy);
  const along=(first.r**2-second.r**2+distance**2)/(2*distance);
  const height=Math.sqrt(Math.max(0,first.r**2-along**2));
  const mx=first.cx+along*dx/distance,my=first.cy+along*dy/distance;
  const ox=-dy*height/distance,oy=dx*height/distance;
  return[{x:mx+ox,y:my+oy},{x:mx-ox,y:my-oy}];
}

function buildGraph(){
  for(const axis of ['y','x','z'])for(const coord of [-1,0,1]){
    const geometry={...RING_GEOMETRY[axis],r:RADIUS[coord],axis,coord};
    geometry.line=svgElement('circle',{cx:geometry.cx,cy:geometry.cy,r:geometry.r,class:`graph-ring${coord===0?' middle':''}`},$('ring-lines'));
    circles.set(circleId(axis,coord),geometry);
  }

  // 3 family pairs × 3×3 circle pairs × 2 intersections = 54 sticker vertices.
  for(const [firstAxis,secondAxis,normalAxis]of [['x','y','z'],['x','z','y'],['y','z','x']]){
    for(const firstCoord of [-1,0,1])for(const secondCoord of [-1,0,1]){
      const first=circles.get(circleId(firstAxis,firstCoord));
      const second=circles.get(circleId(secondAxis,secondCoord));
      const points=circleIntersections(first,second);
      [-1,1].forEach((normalSign,index)=>{
        const coords={x:0,y:0,z:0},normal={x:0,y:0,z:0};
        coords[firstAxis]=firstCoord;coords[secondAxis]=secondCoord;coords[normalAxis]=normalSign;normal[normalAxis]=normalSign;
        const position=[coords.x,coords.y,coords.z],normalVector=[normal.x,normal.y,normal.z];
        const key=nodeKey(position,normalVector),point=points[index];
        const element=svgElement('circle',{cx:point.x,cy:point.y,r:5.6,class:'graph-node',filter:'url(#shadow)','data-node':key},$('nodes'));
        const node={key,position,normal:normalVector,x:point.x,y:point.y,element,circleIds:[circleId(firstAxis,firstCoord),circleId(secondAxis,secondCoord)]};
        graphNodes.push(node);graphNodeByKey.set(key,node);
      });
    }
  }

  for(const [faceKey,face]of Object.entries(FACES)){
    const geometry=circles.get(circleId(face.axis,face.coord));
    svgElement('circle',{cx:geometry.cx,cy:geometry.cy,r:geometry.r,class:'ring-hit','data-face':faceKey,'aria-label':`${faceKey} ${face.name}`},$('ring-hits'));
  }
}

function findStickerColor(node){
  const block=cubies.find(item=>item.position.toArray().every((value,index)=>Math.round(value)===node.position[index]));
  if(!block)return'white';
  const targetNormal=vector(node.normal);
  return block.userData.stickers.find(item=>item.normal.clone().applyQuaternion(block.quaternion).dot(targetNormal)>.99)?.color||'white';
}

const readGraphColors=()=>new Map(graphNodes.map(node=>[node.key,findStickerColor(node)]));
function renderGraphStatic(){
  const colors=readGraphColors();
  for(const node of graphNodes){
    const color=colors.get(node.key);
    node.element.setAttribute('fill',COLORS[color]);node.element.dataset.color=color;node.element.style.opacity='1';
  }
  return colors;
}

function setActiveRing(active){
  for(const circle of circles.values())circle.line.classList.remove('active');
  if(active){const face=FACES[selected];circles.get(circleId(face.axis,face.coord)).line.classList.add('active');}
}

function transformedNode(node,direction){
  const quaternion=new THREE.Quaternion().setFromAxisAngle(vector(FACES[selected].n),-direction*QUARTER);
  return graphNodeByKey.get(nodeKey(roundArray(vector(node.position).applyQuaternion(quaternion)),roundArray(vector(node.normal).applyQuaternion(quaternion))));
}

function clearMovingNodes(){
  $('moving-nodes').replaceChildren();
  for(const node of graphNodes)node.element.style.opacity='1';
  graphMove=null;
}

function prepareGraphMove(direction){
  clearMovingNodes();
  const face=FACES[selected],axisIndex=AXIS_INDEX[face.axis],activeCircle=circles.get(circleId(face.axis,face.coord));
  const transitions=[],sideTransitions=[];
  for(const node of graphNodes){
    if(node.position[axisIndex]!==face.coord)continue;
    const target=transformedNode(node,direction);
    if(!target||target.key===node.key)continue;
    const transition={source:node,target,color:graphSnapshot.get(node.key),side:node.normal[axisIndex]===0};
    transitions.push(transition);if(transition.side)sideTransitions.push(transition);
  }
  const travel=(item,forward)=>{
    const from=Math.atan2(item.source.y-activeCircle.cy,item.source.x-activeCircle.cx);
    const to=Math.atan2(item.target.y-activeCircle.cy,item.target.x-activeCircle.cx);
    return forward?mod(to-from,TAU):mod(from-to,TAU);
  };
  const arcSign=sideTransitions.reduce((sum,item)=>sum+travel(item,true),0)<=sideTransitions.reduce((sum,item)=>sum+travel(item,false),0)?1:-1;
  for(const item of transitions){
    item.source.element.style.opacity='.16';
    item.mover=svgElement('circle',{cx:item.source.x,cy:item.source.y,r:6.1,class:'moving-node',fill:COLORS[item.color]},$('moving-nodes'));
    if(item.side){
      item.center=activeCircle;item.fromAngle=Math.atan2(item.source.y-activeCircle.cy,item.source.x-activeCircle.cx);
      const targetAngle=Math.atan2(item.target.y-activeCircle.cy,item.target.x-activeCircle.cx);
      item.deltaAngle=arcSign>0?mod(targetAngle-item.fromAngle,TAU):-mod(item.fromAngle-targetAngle,TAU);
    }else{
      const dx=item.target.x-item.source.x,dy=item.target.y-item.source.y;
      item.control={x:(item.source.x+item.target.x)/2-dy*.24*arcSign,y:(item.source.y+item.target.y)/2+dx*.24*arcSign};
    }
  }
  graphMove={direction,transitions};
}

function renderGraphMotion(angle){
  previewAngle=angle;
  const direction=angle<0?-1:1;
  if(Math.abs(angle)>.001&&graphMove?.direction!==direction)prepareGraphMove(direction);
  const progress=Math.min(1,Math.abs(angle)/QUARTER),eased=progress*progress*(3-2*progress);
  if(graphMove)for(const item of graphMove.transitions){
    let x,y;
    if(item.side){const theta=item.fromAngle+item.deltaAngle*eased;x=item.center.cx+item.center.r*Math.cos(theta);y=item.center.cy+item.center.r*Math.sin(theta);}
    else{const inverse=1-eased;x=inverse**2*item.source.x+2*inverse*eased*item.control.x+eased**2*item.target.x;y=inverse**2*item.source.y+2*inverse*eased*item.control.y+eased**2*item.target.y;}
    item.mover.setAttribute('cx',x);item.mover.setAttribute('cy',y);
  }
  $('graph-state').textContent=`${selected} · ${FACES[selected].name} · ${Math.round(angle*180/Math.PI)}°`;
}

function setLocked(value){busy=value;for(const id of['layer','cw','ccw'])$(id).disabled=value;}
function selectFace(key){
  selected=key;$('layer').value=key;$('face-label').textContent=`${key} · ${FACES[key].name}`;$('face-dot').style.background=COLORS[FACES[key].color];
  $('graph-state').textContent=`${key} · ${FACES[key].name}`;totalAngle=0;previewAngle=0;
}

function beginTurn(direction=null){
  setLocked(true);setActiveRing(true);graphSnapshot=renderGraphStatic();if(direction)prepareGraphMove(direction);
  const normal=vector(FACES[selected].n);cube.updateMatrixWorld(true);cubies.filter(block=>block.position.dot(normal)>.99).forEach(block=>pivot.attach(block));
}
function previewTurn(angle){pivot.quaternion.setFromAxisAngle(vector(FACES[selected].n),-angle);renderGraphMotion(angle);}
function isSolved(){return Object.values(FACES).every(face=>{const normal=vector(face.n),colors=[];for(const block of cubies)for(const sticker of block.userData.stickers)if(sticker.normal.clone().applyQuaternion(block.quaternion).dot(normal)>.99)colors.push(sticker.color);return colors.length===9&&new Set(colors).size===1;});}

function finishTurn(angle){
  const quarterTurns=Math.round(angle/QUARTER);pivot.updateMatrixWorld(true);
  [...pivot.children].forEach(block=>{cube.attach(block);block.position.set(...roundArray(block.position));const matrix=new THREE.Matrix4().makeRotationFromQuaternion(block.quaternion);matrix.elements=matrix.elements.map(value=>Math.round(value)||0);block.quaternion.setFromRotationMatrix(matrix).normalize();});
  pivot.quaternion.identity();totalAngle+=quarterTurns*90;
  if(quarterTurns){moves+=Math.abs(quarterTurns);$('last-move').textContent=selected+(quarterTurns===1?'':quarterTurns===-1?'′':` ${quarterTurns*90}°`);}
  $('move-count').textContent=String(moves).padStart(2,'0');clearMovingNodes();setActiveRing(false);renderGraphStatic();previewAngle=0;
  $('graph-state').textContent=`${selected} · ${FACES[selected].name}`;setLocked(false);$('status').textContent=isSolved()?'已还原 · 试试切换另一层':'状态已同步 · 交点颜色完成一次置换';
}
function animateTurn(from,to){animation={from,to,start:performance.now(),duration:matchMedia('(prefers-reduced-motion: reduce)').matches?1:440};}
function turn(direction){if(busy)return;beginTurn(direction);animateTurn(0,direction*QUARTER);}
$('cw').onclick=()=>turn(1);$('ccw').onclick=()=>turn(-1);$('layer').onchange=event=>{if(!busy)selectFace(event.target.value);};

function svgPointer(event){const point=$('ring').createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform($('ring').getScreenCTM().inverse());}
const pointerAngle=(event,circle)=>{const point=svgPointer(event);return Math.atan2(point.y-circle.cy,point.x-circle.cx);};
$('ring').addEventListener('pointerdown',event=>{
  if(busy||event.button!==0||!event.target.classList.contains('ring-hit'))return;
  const faceKey=event.target.dataset.face;selectFace(faceKey);const face=FACES[faceKey],circle=circles.get(circleId(face.axis,face.coord));
  $('ring').setPointerCapture(event.pointerId);beginTurn();ringDrag={id:event.pointerId,circle,last:pointerAngle(event,circle),angle:0};
});
$('ring').addEventListener('pointermove',event=>{
  if(!ringDrag||ringDrag.id!==event.pointerId)return;
  const next=pointerAngle(event,ringDrag.circle),delta=Math.atan2(Math.sin(next-ringDrag.last),Math.cos(next-ringDrag.last));
  ringDrag.angle=Math.max(-QUARTER,Math.min(QUARTER,ringDrag.angle+delta));ringDrag.last=next;previewTurn(ringDrag.angle);
});
function endRing(event,cancel=false){if(!ringDrag||ringDrag.id!==event.pointerId)return;const angle=ringDrag.angle;ringDrag=null;animateTurn(angle,cancel||Math.abs(angle)<QUARTER*.25?0:Math.sign(angle)*QUARTER);}
$('ring').addEventListener('pointerup',event=>endRing(event));$('ring').addEventListener('pointercancel',event=>endRing(event,true));$('ring').addEventListener('lostpointercapture',event=>endRing(event,true));

if($('palette'))for(const[key,color]of Object.entries(COLORS)){const item=document.createElement('span');item.innerHTML=`<i style="background:${color}"></i>${NAMES[key]}`;$('palette').append(item);}

let renderer,camera,viewDrag=null,yaw=.65,pitch=.5;
function updateCamera(){camera.position.set(9.7*Math.cos(pitch)*Math.sin(yaw),9.7*Math.sin(pitch),9.7*Math.cos(pitch)*Math.cos(yaw));camera.lookAt(0,0,0);camera.updateMatrixWorld();}
function resetView(){yaw=.65;pitch=.5;if(camera)updateCamera();}
$('view-reset').onclick=resetView;
$('reset').onclick=()=>{animation=null;ringDrag=null;viewDrag=null;clearMovingNodes();setActiveRing(false);setLocked(false);moves=0;buildCube();selectFace('U');renderGraphStatic();resetView();$('move-count').textContent='00';$('last-move').textContent='—';$('status').textContent='已还原 · 准备开始探索';};

function initialize3D(){
  const stage=$('cube-stage');renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;stage.append(renderer.domElement);
  camera=new THREE.PerspectiveCamera(34,1,.1,100);updateCamera();scene.add(new THREE.HemisphereLight(0xffffff,0xc5c9dd,2.4));
  const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(-3,7,5);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1);fill.position.set(5,1,-4);scene.add(fill);
  new ResizeObserver(()=>{camera.aspect=stage.clientWidth/stage.clientHeight;camera.updateProjectionMatrix();renderer.setSize(stage.clientWidth,stage.clientHeight);}).observe(stage);
  const canvas=renderer.domElement;canvas.setAttribute('aria-label','三维魔方。拖动旋转视角，点击面顺时针旋转；也可使用上方选择器和按钮操作。');const raycaster=new THREE.Raycaster();
  canvas.addEventListener('pointerdown',event=>{if(viewDrag||event.button!==0)return;viewDrag={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!viewDrag||viewDrag.id!==event.pointerId)return;if(Math.hypot(event.clientX-viewDrag.x,event.clientY-viewDrag.y)>5)viewDrag.moved=true;if(viewDrag.moved){yaw-=(event.clientX-viewDrag.lastX)*.008;pitch=Math.max(-1.45,Math.min(1.45,pitch+(event.clientY-viewDrag.lastY)*.008));updateCamera();}viewDrag.lastX=event.clientX;viewDrag.lastY=event.clientY;});
  canvas.addEventListener('pointerup',event=>{if(!viewDrag||viewDrag.id!==event.pointerId)return;const click=!viewDrag.moved;viewDrag=null;if(!click||busy)return;const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);scene.updateMatrixWorld(true);const hit=raycaster.intersectObjects(cube.children,true)[0];if(!hit)return;const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);const face=Object.keys(FACES).find(key=>normal.dot(vector(FACES[key].n))>.99);if(face){selectFace(face);turn(event.shiftKey?-1:1);}});
  canvas.addEventListener('pointercancel',()=>{viewDrag=null;});canvas.addEventListener('lostpointercapture',()=>{viewDrag=null;});$('loading').hidden=true;
}

buildCube();buildGraph();selectFace('U');renderGraphStatic();
try{initialize3D();}catch(error){$('loading').textContent='无法启动 WebGL，请使用支持硬件加速的浏览器。';console.error(error);}
function frame(now){if(animation){const progress=Math.min(1,(now-animation.start)/animation.duration),eased=progress*progress*(3-2*progress);previewTurn(animation.from+(animation.to-animation.from)*eased);if(progress===1){const target=animation.to;animation=null;finishTurn(target);}}if(renderer&&camera)renderer.render(scene,camera);requestAnimationFrame(frame);}
requestAnimationFrame(frame);

window.mathLab={getState:()=>{const active=[...circles.values()].find(circle=>circle.line.classList.contains('active'));return{selected,busy,moves,totalAngle,previewAngle,solved:isSolved(),pivotCount:pivot.children.length,graph:{ringCount:circles.size,nodeCount:graphNodes.length,movingCount:$('moving-nodes').childElementCount,activeCircle:active?circleId(active.axis,active.coord):null,positions:graphNodes.map(node=>[node.x,node.y]),colors:graphNodes.map(node=>node.element.dataset.color),incidences:graphNodes.map(node=>node.circleIds.length)},positions:cubies.map(block=>roundArray(block.position))};}};
