/* ═══════════════════════════════════════════════════════════
   TRU SKOOL MALL — Navigation & Collision System v2
   
   CRITICAL: This script MUST be loaded BEFORE <a-scene> tag
   (alongside avatar-interaction.js, music-player.js, etc.)
   Otherwise the component registration is silently ignored.
   
   Features:
   - Walkable zones: corridor + store interiors (connected)
   - Sliding collision along walls
   - Y-axis lock (no flying)
   - Zones overlap at store entrances so you can walk in/out
   ═══════════════════════════════════════════════════════════ */

(function() {
  if (typeof AFRAME === 'undefined') return;

  // Walkable zones — corridor + stores with OVERLAPPING entries
  // Left stores open at their RIGHT edge (x = -5.5)
  // Right stores open at their LEFT edge (x = 5.5)
  // Corridor extends to x=±6 to overlap with store openings
  var WALKABLE_ZONES = [
    // Main corridor (wide enough to overlap store openings)
    { name: 'corridor', xMin: -6, xMax: 6, zMin: -65, zMax: 14 },

    // Left-side stores (open toward corridor at x=-5.5, overlap with corridor at x=-6)
    { name: 'concrete-rose',    xMin: -14, xMax: -5, zMin: -12, zMax: -4 },
    { name: 'faithfully-faded', xMin: -14, xMax: -5, zMin: -26, zMax: -18 },
    { name: 'wanderlust',       xMin: -14, xMax: -5, zMin: -42, zMax: -34 },

    // Right-side stores (open toward corridor at x=5.5, overlap with corridor at x=6)
    { name: 'bijadi',           xMin: 5,  xMax: 14, zMin: -12, zMax: -4 },
    { name: 'hoe',              xMin: 5,  xMax: 14, zMin: -26, zMax: -18 },
    { name: 'cafe-sativa',      xMin: 5,  xMax: 14, zMin: -42, zMax: -34 },

    // Verse Alkemist (end of mall, wider, centered)
    { name: 'verse-alkemist',   xMin: -7, xMax: 7,  zMin: -64, zMax: -52 },
  ];

  function pointInAnyZone(x, z) {
    for (var i = 0; i < WALKABLE_ZONES.length; i++) {
      var zone = WALKABLE_ZONES[i];
      if (x >= zone.xMin && x <= zone.xMax &&
          z >= zone.zMin && z <= zone.zMax) {
        return zone;
      }
    }
    return null;
  }

  AFRAME.registerComponent('mall-nav', {
    schema: {
      enabled: { default: true },
    },

    init: function() {
      this.lastValid = { x: 0, z: 14 };
      console.log('[MallNav v2] Collision system active (registered before scene)');
    },

    tick: function() {
      if (!this.data.enabled) return;

      var pos = this.el.object3D.position;

      // Y-LOCK: stay at ground level
      if (Math.abs(pos.y) > 0.01) {
        pos.y = 0;
      }

      var newX = pos.x;
      var newZ = pos.z;

      // Check if new position is valid
      var zone = pointInAnyZone(newX, newZ);

      if (zone) {
        // Valid — update last known good position
        this.lastValid.x = newX;
        this.lastValid.z = newZ;
        return;
      }

      // Invalid — try SLIDING (keep one axis, revert the other)
      // Try keeping X movement (Z hit a wall)
      if (pointInAnyZone(newX, this.lastValid.z)) {
        pos.z = this.lastValid.z;
        this.lastValid.x = newX;
        return;
      }

      // Try keeping Z movement (X hit a wall)
      if (pointInAnyZone(this.lastValid.x, newZ)) {
        pos.x = this.lastValid.x;
        this.lastValid.z = newZ;
        return;
      }

      // Both invalid — snap back
      pos.x = this.lastValid.x;
      pos.z = this.lastValid.z;
    },
  });

  window.MallWalkableZones = WALKABLE_ZONES;
  window.MallPointInZone = pointInAnyZone;
})();
