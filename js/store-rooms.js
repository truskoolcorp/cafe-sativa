/* ═══════════════════════════════════════════════════════════
   TRU SKOOL MALL — Store Room System (replaces panoramas)
   
   NEW ARCHITECTURE:
   - Stores with GLB rooms: load real 3D environment + props
   - Stores without rooms: fallback to panorama sphere
   - Room walls ARE the boundaries (visual + collision)
   ═══════════════════════════════════════════════════════════ */

(function() {

var STORE_ROOMS = {
  'The Verse Alkemist': {
    room: {
      src: 'assets/models/rooms/music-studio.glb',
      position: '0 0 -58',
      scale: '0.05 0.05 0.05',
      rotation: '0 0 0',
    },
    props: [
      { id: 'va-turntable',  src: 'assets/models/studio/turntable.glb',  position: '-1.2 0.82 -60',   scale: '0.5 0.5 0.5',   rotation: '0 0 0' },
      { id: 'va-mic',        src: 'assets/models/studio/mic.glb',        position: '0.5 0.82 -59.5',  scale: '0.4 0.4 0.4',   rotation: '0 15 0' },
      { id: 'va-mixer',      src: 'assets/models/studio/mixer.glb',      position: '0 0.82 -60.2',    scale: '0.6 0.6 0.6',   rotation: '0 0 0' },
      { id: 'va-headphones', src: 'assets/models/studio/headphones.glb', position: '1.6 0.85 -59',    scale: '0.25 0.25 0.25', rotation: '0 -30 0', clickable: true },
      { id: 'va-monitor-l',  src: 'assets/models/studio/monitor.glb',    position: '-1.8 0.85 -60.5', scale: '0.3 0.3 0.3',   rotation: '0 25 0' },
      { id: 'va-monitor-r',  src: 'assets/models/studio/monitor.glb',    position: '1.8 0.85 -60.5',  scale: '0.3 0.3 0.3',   rotation: '0 -25 0' },
      { id: 'va-mpc',        src: 'assets/models/studio/mpc.glb',        position: '1.2 0.82 -60',    scale: '0.3 0.3 0.3',   rotation: '0 0 0' },
    ],
    lights: [
      { color: '#a060e0', intensity: 1.5, distance: 8, position: '0 3 -58' },
      { color: '#fff2d8', intensity: 0.8, distance: 6, position: '0 4 -56' },
      { color: '#a060e0', intensity: 0.6, distance: 5, position: '0 0.5 -60' },
    ],
  },
};

var PANORAMA_FALLBACK = {
  'Concrete Rose':      'panoramas/concrete-rose.jpg',
  'BiJaDi':             'panoramas/bijadi.jpg',
  'Faithfully Faded':   'panoramas/faithfully-faded.jpg',
  'H.O.E.':             'panoramas/hoe.jpg',
  'Wanderlust':         'panoramas/wanderlust.jpg',
  'Cafe Sativa':        'panoramas/cafe-sativa.jpg',
};

var ROOM_ZONES = [
  { label: 'Concrete Rose',      x: -8,  z: -8,  w: 4,  d: 6 },
  { label: 'BiJaDi',             x: 8,   z: -8,  w: 4,  d: 6 },
  { label: 'Faithfully Faded',   x: -8,  z: -22, w: 4,  d: 6 },
  { label: 'H.O.E.',             x: 8,   z: -22, w: 4,  d: 6 },
  { label: 'Wanderlust',         x: -8,  z: -38, w: 4,  d: 6 },
  { label: 'Cafe Sativa',        x: 8,   z: -38, w: 4,  d: 6 },
  { label: 'The Verse Alkemist', x: 0,   z: -58, w: 10, d: 8 },
];

var ALWAYS_KEEP = new Set([
  'camera-rig', 'panorama-sphere', 'store-room-container',
  'glb-laviche', 'glb-ginger', 'glb-ahnika',
]);

// Follow-camera for panorama fallback
if (typeof AFRAME !== 'undefined' && !AFRAME.components['follow-camera']) {
  AFRAME.registerComponent('follow-camera', {
    tick: function() {
      var cam = document.querySelector('[camera]');
      if (!cam) return;
      var p = new THREE.Vector3();
      cam.object3D.getWorldPosition(p);
      this.el.object3D.position.copy(p);
      this.el.object3D.rotation.y += 0.0002;
    }
  });
}

var StoreRoomSystem = {
  pSphere: null, pMat: null, pTextures: {},
  container: null,
  hidden: [],
  _last: null,
  _pTarget: 0, _pCurrent: 0,

  init: function() {
    var scene = document.querySelector('a-scene');
    if (!scene) return;
    var S = this;

    // Room container
    S.container = document.createElement('a-entity');
    S.container.id = 'store-room-container';
    scene.appendChild(S.container);

    // Panorama sphere (fallback)
    var sp = document.createElement('a-sphere');
    sp.setAttribute('radius', '20');
    sp.setAttribute('segments-width', '64');
    sp.setAttribute('segments-height', '32');
    sp.setAttribute('position', '0 1.6 14');
    sp.setAttribute('material', 'side: back; shader: flat; opacity: 0; transparent: true; fog: false');
    sp.setAttribute('visible', 'false');
    sp.setAttribute('follow-camera', '');
    sp.id = 'panorama-sphere';
    sp.addEventListener('loaded', function() {
      var m = sp.getObject3D('mesh');
      if (m) { m.renderOrder = -100; m.material.depthWrite = false; m.material.depthTest = true; S.pMat = m.material; }
    });
    scene.appendChild(sp);
    S.pSphere = sp;

    // Load panorama textures
    var ldr = new THREE.TextureLoader();
    Object.keys(PANORAMA_FALLBACK).forEach(function(k) {
      ldr.load(PANORAMA_FALLBACK[k], function(t) {
        if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
        S.pTextures[k] = t;
      });
    });

    setInterval(function() { S.update(); }, 200);

    // Panorama fade
    (function fade() {
      requestAnimationFrame(fade);
      if (!S.pMat) return;
      S._pCurrent += (S._pTarget - S._pCurrent) * 0.15;
      S.pMat.opacity = S._pCurrent;
      sp.object3D.visible = S._pCurrent > 0.02;
    })();

    console.log('[StoreRooms] Ready — GLB rooms + panorama fallback');
  },

  detect: function() {
    var rig = document.getElementById('camera-rig');
    if (!rig) return null;
    var p = rig.getAttribute('position');
    for (var i = 0; i < ROOM_ZONES.length; i++) {
      var z = ROOM_ZONES[i];
      if (p.x >= z.x-z.w/2 && p.x <= z.x+z.w/2 && p.z >= z.z-z.d/2 && p.z <= z.z+z.d/2)
        return z;
    }
    return null;
  },

  hideScene: function() {
    var scene = document.querySelector('a-scene');
    if (!scene) return;
    this.hidden = [];
    var S = this;
    Array.from(scene.children).forEach(function(c) {
      var t = (c.tagName||'').toLowerCase();
      if (t === 'a-assets') return;
      if (ALWAYS_KEEP.has(c.id)) return;
      if (c.getAttribute && c.getAttribute('light') !== null) return;
      var v = c.getAttribute('visible');
      if (v !== 'false' && v !== false) {
        S.hidden.push(c);
        c.setAttribute('visible', 'false');
      }
    });
  },

  showScene: function() {
    this.hidden.forEach(function(c) { c.setAttribute('visible', 'true'); });
    this.hidden = [];
  },

  loadRoom: function(label) {
    var cfg = STORE_ROOMS[label];
    if (!cfg) return;
    this.container.innerHTML = '';
    var S = this;

    // Room model
    var room = document.createElement('a-entity');
    room.id = 'store-room-model';
    room.setAttribute('gltf-model', cfg.room.src);
    room.setAttribute('position', cfg.room.position);
    room.setAttribute('scale', cfg.room.scale);
    room.setAttribute('rotation', cfg.room.rotation);
    room.addEventListener('model-loaded', function() {
      var mesh = room.getObject3D('mesh');
      if (mesh) mesh.traverse(function(ch) { if (ch.isMesh) ch.frustumCulled = false; });
      console.log('[StoreRooms] Room model loaded: ' + label);
    });
    S.container.appendChild(room);

    // Props (world-space coordinates)
    (cfg.props || []).forEach(function(p) {
      var e = document.createElement('a-entity');
      e.id = p.id;
      e.setAttribute('gltf-model', p.src);
      e.setAttribute('position', p.position);
      e.setAttribute('scale', p.scale);
      e.setAttribute('rotation', p.rotation || '0 0 0');
      if (p.clickable) e.classList.add('clickable');
      e.addEventListener('model-loaded', function() {
        var mesh = e.getObject3D('mesh');
        if (mesh) mesh.traverse(function(ch) { if (ch.isMesh) ch.frustumCulled = false; });
      });
      S.container.appendChild(e);
    });

    // Lights
    (cfg.lights || []).forEach(function(l) {
      var le = document.createElement('a-entity');
      le.setAttribute('light', 'type:point; color:'+l.color+'; intensity:'+l.intensity+'; distance:'+l.distance+'; decay:1.5');
      le.setAttribute('position', l.position);
      S.container.appendChild(le);
    });
  },

  update: function() {
    var zone = this.detect();
    var label = zone ? zone.label : null;
    if (label === this._last) return;

    // Leave previous
    this.showScene();
    this.container.innerHTML = '';
    this._pTarget = 0;

    this._last = label;
    if (!label) return;

    // Enter new
    if (STORE_ROOMS[label]) {
      this.hideScene();
      this.loadRoom(label);
    } else if (this.pTextures[label] && this.pMat) {
      this.hideScene();
      this.pMat.map = this.pTextures[label];
      this.pMat.needsUpdate = true;
      this._pTarget = 1.0;
    }
  },
};

document.addEventListener('DOMContentLoaded', function() {
  var scene = document.querySelector('a-scene');
  if (scene) {
    var go = function() { setTimeout(function() { StoreRoomSystem.init(); }, 2000); };
    if (scene.hasLoaded) go(); else scene.addEventListener('loaded', go);
  }
});

window.StoreRoomSystem = StoreRoomSystem;
window.STORE_ROOMS = STORE_ROOMS;

})();
