/**
 * EventBus — Lightweight Publish/Subscribe pattern.
 * Decouples socket listeners from UI components.
 * Usage:
 *   EventBus.on('ROOM_DELETED', handler)
 *   EventBus.emit('ROOM_DELETED', { code })
 *   EventBus.off('ROOM_DELETED', handler)
 */
const EventBus = (() => {
  const _listeners = {};
  return {
    on(event, cb) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(cb);
    },
    off(event, cb) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(fn => fn !== cb);
    },
    emit(event, data) {
      (_listeners[event] || []).forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[EventBus] ${event}`, e); }
      });
    }
  };
})();

// Make globally available
window.EventBus = EventBus;
